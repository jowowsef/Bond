package com.bond.usage

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Which app is in front right now, from Android's usage event log (the same
 * log Screen Time uses; needs "Usage access"). Read-only.
 *
 * Incremental: the first call reads the last 3 hours (to know an app that was
 * opened long ago and is still in front); later calls read only the events
 * since the previous call (plus a 10-second overlap, in case Android logs an
 * event slightly late; replaying it changes nothing), so
 * a check every 20 seconds stays cheap.
 *
 * Returns null when no app is in front: screen off, lock screen, or the home
 * screen (launchers and the system UI are not "an app").
 */
class ForegroundAppDetector(private val context: Context) {

  private val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
  private val excluded: Set<String> by lazy { launcherPackages() + "com.android.systemui" }
  private val labels = HashMap<String, String>()

  private val state by lazy { ForegroundState(excluded) }
  private var lastQueryEnd = 0L

  data class App(val packageName: String, val appName: String)

  /** Forget what was seen (for example after the screen was off for a while). */
  fun reset() {
    state.reset()
    lastQueryEnd = 0L
  }

  fun current(now: Long = System.currentTimeMillis()): App? {
    val start = if (lastQueryEnd == 0L) now - THREE_HOURS_MS else lastQueryEnd - OVERLAP_MS
    val events = usm.queryEvents(start, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val pkg = event.packageName ?: continue
      state.apply(event.eventType, pkg)
    }
    lastQueryEnd = now
    val pkg = state.current ?: return null
    return App(pkg, labelFor(pkg))
  }

  private fun labelFor(pkg: String): String = labels.getOrPut(pkg) {
    val pm = context.packageManager
    try {
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }
  }

  private fun launcherPackages(): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return context.packageManager
      .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      .mapNotNull { it.activityInfo?.packageName }
      .toSet()
  }

  companion object {
    private const val THREE_HOURS_MS = 3 * 60 * 60 * 1000L
    private const val OVERLAP_MS = 10_000L
  }
}
