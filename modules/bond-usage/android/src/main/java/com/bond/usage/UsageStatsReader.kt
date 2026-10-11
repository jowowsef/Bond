package com.bond.usage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Process
import java.io.File
import java.io.FileOutputStream
import java.util.Calendar

/**
 * Real screen-time numbers from Android's UsageStatsManager (read-only).
 *
 * How it works: Android keeps a log of events like "App X came to the front
 * at 10:02" and "App X left the front at 10:15". We walk those events in
 * order and add up how long each app was in front. We do NOT use Android's
 * pre-made daily buckets because they are known to overlap days and double
 * count.
 *
 * Same logic as modules/bond-native UsageStatsHelper, kept here as a small,
 * separate module so Screen Time can ship without the (not yet built) VPN and
 * Accessibility code that lives in bond-native.
 */
object UsageStatsReader {

  // Event type numbers from android.app.usage.UsageEvents.Event
  private const val ACTIVITY_RESUMED = 1         // app came to the front
  private const val ACTIVITY_PAUSED = 2          // app left the front
  private const val SCREEN_NON_INTERACTIVE = 16  // screen turned off
  private const val KEYGUARD_SHOWN = 17          // lock screen shown
  private const val DEVICE_SHUTDOWN = 26

  /** Has the phone's owner turned on "Usage access" for Bond? */
  @Suppress("DEPRECATION") // unsafeCheckOpNoThrow: still the documented check for this AppOp
  fun hasUsageAccess(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /** [lastUsedMs]: the last moment in the period the app was on screen (0 if unknown). */
  data class AppUsage(
    val packageName: String,
    val appName: String,
    val foregroundMs: Long,
    val launches: Int,
    val lastUsedMs: Long,
  )

  /** Time on screen within one clock hour that starts at [startMs]. */
  data class HourBucket(val startMs: Long, val ms: Long)

  data class UsageResult(val totalMs: Long, val launches: Int, val apps: List<AppUsage>, val hourly: List<HourBucket>)

  /** Home-screen apps; time spent there is not "app use". */
  private fun launcherPackages(context: Context): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return context.packageManager
      .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      .mapNotNull { it.activityInfo?.packageName }
      .toSet()
  }

  /** Screen time between [startMs] and [endMs] (milliseconds since 1970). */
  fun getUsage(context: Context, startMs: Long, endMs: Long): UsageResult {
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val realEnd = minOf(endMs, now)

    // One bucket per real hour of the period (a daylight-saving day simply
    // has 23 or 25). Hours still in the future stay at 0.
    val bounds = ArrayList<Long>()
    val cal = Calendar.getInstance().apply { timeInMillis = startMs }
    while (cal.timeInMillis < endMs) {
      bounds.add(cal.timeInMillis)
      cal.add(Calendar.HOUR_OF_DAY, 1)
    }
    bounds.add(endMs)
    val hourMs = LongArray(bounds.size - 1)
    fun hourly() = hourMs.indices.map { HourBucket(bounds[it], hourMs[it]) }

    if (realEnd <= startMs) return UsageResult(0, 0, emptyList(), hourly())

    val excluded = launcherPackages(context) + "com.android.systemui"

    // Look 3 hours before the start so an app that was ALREADY open at
    // midnight is still counted from midnight onwards.
    val events = usm.queryEvents(startMs - 3 * 60 * 60 * 1000L, realEnd)
    val event = UsageEvents.Event()

    val foreground = HashMap<String, Long>()
    val launches = HashMap<String, Int>()
    val lastUsed = HashMap<String, Long>()

    var currentPkg: String? = null   // app currently in front
    var currentStart = 0L
    var lastPkg: String? = null      // last app in front (to count launches)

    fun closeCurrent(at: Long) {
      val pkg = currentPkg ?: return
      val s = maxOf(currentStart, startMs)
      val e = minOf(at, realEnd)
      if (e > s) {
        foreground[pkg] = (foreground[pkg] ?: 0L) + (e - s)
        lastUsed[pkg] = maxOf(lastUsed[pkg] ?: 0L, e)
        for (i in hourMs.indices) {
          val a = maxOf(s, bounds[i])
          val b = minOf(e, bounds[i + 1])
          if (b > a) hourMs[i] += b - a
        }
      }
      currentPkg = null
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val t = event.timeStamp
      val pkg = event.packageName ?: continue
      when (event.eventType) {
        ACTIVITY_RESUMED -> {
          if (pkg != currentPkg) {
            closeCurrent(t)
            if (pkg !in excluded) {
              currentPkg = pkg
              currentStart = t
              // Switching from a different app (or home / screen off) = a launch.
              if (pkg != lastPkg && t >= startMs) launches[pkg] = (launches[pkg] ?: 0) + 1
            }
            lastPkg = pkg
          }
        }
        ACTIVITY_PAUSED -> if (pkg == currentPkg) closeCurrent(t)
        SCREEN_NON_INTERACTIVE, KEYGUARD_SHOWN, DEVICE_SHUTDOWN -> {
          closeCurrent(t)
          lastPkg = null
        }
      }
    }
    closeCurrent(realEnd) // app still open right now

    val pm = context.packageManager
    val apps = (foreground.keys + launches.keys).toSet()
      .map { pkg -> AppUsage(pkg, labelFor(pm, pkg), foreground[pkg] ?: 0L, launches[pkg] ?: 0, lastUsed[pkg] ?: 0L) }
      .filter { it.foregroundMs >= 1000L }
      .sortedByDescending { it.foregroundMs }

    return UsageResult(apps.sumOf { it.foregroundMs }, apps.sumOf { it.launches }, apps, hourly())
  }

  /**
   * The app's real launcher icon as a PNG file in Bond's cache folder, drawn
   * once per app version and size and reused after that. Returns null when
   * the app is not installed / not visible to Bond, or has no icon of its own,
   * so the screen can show a neutral placeholder instead.
   */
  fun iconFile(context: Context, pkg: String, sizePx: Int): File? {
    val pm = context.packageManager
    val info = try {
      pm.getPackageInfo(pkg, 0)
    } catch (_: Exception) {
      return null
    }
    val version = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
    val dir = File(context.cacheDir, "bond-app-icons").apply { mkdirs() }
    val safe = pkg.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val file = File(dir, "$safe-$version-$sizePx.png")
    if (file.exists()) return file

    // Prefer the icon shown in the launcher; fall back to the app's own icon.
    val launch = pm.getLaunchIntentForPackage(pkg)
    val drawable = launch?.let { pm.resolveActivity(it, 0)?.loadIcon(pm) }
      ?: info.applicationInfo?.takeIf { it.icon != 0 }?.loadIcon(pm)
      ?: return null

    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    return try {
      drawable.setBounds(0, 0, sizePx, sizePx)
      drawable.draw(Canvas(bitmap))
      val tmp = File(dir, "${file.name}.tmp")
      FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
      if (tmp.renameTo(file)) file else null
    } catch (_: Exception) {
      null
    } finally {
      bitmap.recycle()
    }
  }

  private fun labelFor(pm: PackageManager, pkg: String): String = try {
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }
}
