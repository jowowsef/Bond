package com.bond.usage

/**
 * Pure decision logic for the background service (no Android classes, so it
 * is covered by plain JVM unit tests in src/test).
 */

/**
 * Which app is in front, worked out from Android's usage events in order.
 * Feed it the events since the last call; it keeps the state between calls.
 * Replaying a few already-seen events (the overlap) changes nothing.
 */
class ForegroundState(private val excluded: Set<String>) {
  var current: String? = null
    private set

  fun apply(type: Int, pkg: String) {
    when (type) {
      ACTIVITY_RESUMED -> current = if (pkg in excluded) null else pkg
      // (Not ACTIVITY_STOPPED: inside one app the old screen stops AFTER the
      // new one appears, which would wrongly clear the app.)
      ACTIVITY_PAUSED -> if (pkg == current) current = null
      SCREEN_NON_INTERACTIVE, KEYGUARD_SHOWN, DEVICE_SHUTDOWN -> current = null
    }
  }

  fun reset() {
    current = null
  }

  companion object {
    // android.app.usage.UsageEvents.Event types
    const val ACTIVITY_RESUMED = 1
    const val ACTIVITY_PAUSED = 2
    const val SCREEN_NON_INTERACTIVE = 16
    const val KEYGUARD_SHOWN = 17
    const val DEVICE_SHUTDOWN = 26
  }
}

/**
 * When a battery reading is worth sending to the partner: the first one,
 * any change of charging state, a change of at least 2 points, every point
 * at 25 % or below (the low-battery alert range), or a refresh every
 * [refreshMs] so the "Updated" time stays honest. Repeated identical
 * readings (Android sends many) are ignored.
 */
object BatteryReportPolicy {
  data class Reading(val level: Int, val charging: Boolean, val at: Long)

  fun shouldReport(last: Reading?, now: Reading, refreshMs: Long): Boolean {
    if (now.level !in 1..100) return false
    if (last == null) return true
    if (now.charging != last.charging) return true
    val diff = kotlin.math.abs(now.level - last.level)
    if (diff >= 2) return true
    if (diff >= 1 && now.level <= 25) return true
    return now.at - last.at >= refreshMs
  }
}

/** Growing pause before re-sending something that couldn't be uploaded. */
object RetryPolicy {
  fun delayMs(baseMs: Long, failures: Int, maxMs: Long): Long {
    val n = failures.coerceIn(1, 6)
    return (baseMs shl (n - 1)).coerceAtMost(maxMs)
  }
}
