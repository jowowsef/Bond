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

  /** Time (ms) of the event that last changed [current] (0 = none yet). */
  var changedAt = 0L
    private set

  /**
   * Only real events change the app: a query with no events leaves it as it
   * is. ACTIVITY_RESUMED (the same value as the old MOVE_TO_FOREGROUND) sets
   * it; the app's own ACTIVITY_PAUSED, screen off, lock screen or shutdown
   * clear it ("no app").
   */
  fun apply(type: Int, pkg: String, at: Long = 0L) {
    val before = current
    when (type) {
      ACTIVITY_RESUMED -> current = if (pkg in excluded) null else pkg
      // (Not ACTIVITY_STOPPED: inside one app the old screen stops AFTER the
      // new one appears, which would wrongly clear the app.)
      ACTIVITY_PAUSED -> if (pkg == current) current = null
      SCREEN_NON_INTERACTIVE, KEYGUARD_SHOWN, DEVICE_SHUTDOWN -> current = null
    }
    if (current != before) changedAt = at
  }

  fun reset() {
    current = null
    changedAt = 0L
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
 * Which part of Android's usage log to read next. Rolling: each read starts
 * where the last SUCCESSFUL read ended, minus [lateMs], because some phones
 * write an event into the log a while after it happened (with its real, older
 * time). Without that margin a quick switch (Messenger -> TikTok) logged late
 * would fall before the next window and be missed for good, leaving the old
 * app. Reading an event twice is harmless: events are replayed in order and
 * the last one wins. A failed read never moves the window.
 */
class UsageQueryWindow(private val firstMs: Long, private val lateMs: Long) {
  private var lastEnd = 0L

  fun start(now: Long): Long = if (lastEnd == 0L) now - firstMs else minOf(lastEnd, now) - lateMs

  /** Call only after the read up to [end] succeeded. */
  fun advance(end: Long) {
    if (end > lastEnd) lastEnd = end
  }

  fun reset() {
    lastEnd = 0L
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
