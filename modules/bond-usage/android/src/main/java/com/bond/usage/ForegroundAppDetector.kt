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
 * Rolling window (UsageQueryWindow): the first call reads the last 3 hours
 * (to know an app that was opened long ago and is still in front); later calls
 * read from the end of the last SUCCESSFUL read minus 2 minutes, because some
 * phones log events late. Replaying events changes nothing, so a check every
 * 2 seconds stays cheap. Only ACTIVITY_RESUMED sets the app; an empty read
 * keeps it (see ForegroundState).
 *
 * Returns null when no app is in front: screen off, lock screen, or the home
 * screen (launchers and the system UI are not "an app").
 */
class ForegroundAppDetector(private val context: Context) {

  private val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
  private val excluded: Set<String> by lazy { launcherPackages() + "com.android.systemui" }
  private val labels = HashMap<String, String>()

  private val state by lazy { ForegroundState(excluded) }
  private val window = UsageQueryWindow(THREE_HOURS_MS, LATE_EVENTS_MS)

  /** How long after it happened the last app change was seen (ms, for diagnostics). */
  var lastChangeLagMs = 0L
    private set

  data class App(val packageName: String, val appName: String)

  /** Forget what was seen (for example after the screen was off for a while). */
  fun reset() {
    state.reset()
    window.reset()
  }

  fun current(now: Long = System.currentTimeMillis()): App? {
    val before = state.current
    // Throws if the log can't be read: the window then stays where it was.
    val events = usm.queryEvents(window.start(now), now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val pkg = event.packageName ?: continue
      state.apply(event.eventType, pkg, event.timeStamp)
    }
    window.advance(now)
    if (state.current != before && state.changedAt > 0) lastChangeLagMs = (now - state.changedAt).coerceAtLeast(0)
    val pkg = state.current ?: return null
    return App(pkg, labelFor(pkg))
  }

  /** The app's name as the phone shows it (cached). */
  fun label(pkg: String): String = labelFor(pkg)

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
    /** Events logged up to this late are still caught. */
    private const val LATE_EVENTS_MS = 2 * 60_000L
  }
}
