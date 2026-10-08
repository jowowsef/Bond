package com.bond.nativebridge

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process

/**
 * Real screen-time numbers from Android's UsageStatsManager.
 *
 * HOW IT WORKS (simple version):
 * Android keeps a log of events like "TikTok came to the front at 10:02"
 * and "TikTok went to the background at 10:15". We walk through those
 * events in order and add up how long each app was in front.
 *
 * We do NOT use the pre-made "daily buckets" from Android because they are
 * known to be inaccurate (they can overlap days and double count).
 */
object UsageStatsHelper {

  // Event type numbers from android.app.usage.UsageEvents.Event
  private const val ACTIVITY_RESUMED = 1         // app came to the front
  private const val ACTIVITY_PAUSED = 2          // app left the front
  private const val SCREEN_NON_INTERACTIVE = 16  // screen turned off
  private const val KEYGUARD_SHOWN = 17          // lock screen shown
  private const val DEVICE_SHUTDOWN = 26

  /** Has the owner granted "Usage access" to Bond in Settings? */
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

  data class AppUsage(val packageName: String, val appName: String, val foregroundMs: Long, val launches: Int)
  data class UsageResult(val totalMs: Long, val launches: Int, val apps: List<AppUsage>)

  /**
   * Screen time between [startMs] and [endMs] (milliseconds since 1970).
   */
  fun getUsage(context: Context, startMs: Long, endMs: Long): UsageResult {
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val realEnd = minOf(endMs, now)
    if (realEnd <= startMs) return UsageResult(0, 0, emptyList())

    // Home screens don't count as "screen time on an app".
    val excluded = SafePackages.launcherPackages(context) + "com.android.systemui"

    // Look 3 hours before the start so an app that was ALREADY open at
    // midnight is still counted from midnight onwards.
    val events = usm.queryEvents(startMs - 3 * 60 * 60 * 1000L, realEnd)
    val event = UsageEvents.Event()

    val foreground = HashMap<String, Long>()
    val launches = HashMap<String, Int>()

    var currentPkg: String? = null   // app currently in front
    var currentStart = 0L
    var lastPkg: String? = null      // last app that was in front (used to count launches)

    fun closeCurrent(at: Long) {
      val pkg = currentPkg ?: return
      val s = maxOf(currentStart, startMs)
      val e = minOf(at, realEnd)
      if (e > s) foreground[pkg] = (foreground[pkg] ?: 0L) + (e - s)
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
              // Moving between screens inside the same app is NOT a launch.
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
      .map { pkg ->
        AppUsage(pkg, labelFor(pm, pkg), foreground[pkg] ?: 0L, launches[pkg] ?: 0)
      }
      .filter { it.foregroundMs >= 1000L }
      .sortedByDescending { it.foregroundMs }

    return UsageResult(apps.sumOf { it.foregroundMs }, apps.sumOf { it.launches }, apps)
  }

  /** Apps that have an icon in the launcher (what a person thinks of as "my apps"). */
  fun getLaunchableApps(context: Context): List<Pair<String, String>> {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(intent, 0)
      .mapNotNull { it.activityInfo?.packageName }
      .toSet()
      .filter { it != context.packageName }
      .map { it to labelFor(pm, it) }
      .sortedBy { it.second.lowercase() }
  }

  fun labelFor(pm: PackageManager, pkg: String): String = try {
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }
}
