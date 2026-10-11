package com.bond.usage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundLogicTest {
  private val R = ForegroundState.ACTIVITY_RESUMED
  private val P = ForegroundState.ACTIVITY_PAUSED
  private val launcher = "com.sec.android.app.launcher"
  private fun state() = ForegroundState(setOf(launcher, "com.android.systemui"))

  @Test fun messengerThenTikTokThenYouTube() {
    val s = state()
    s.apply(R, "com.bond.couple"); s.apply(P, "com.bond.couple")
    s.apply(R, "com.facebook.orca")
    assertEquals("com.facebook.orca", s.current)
    // Switch Messenger -> TikTok (old one pauses, new one resumes)
    s.apply(P, "com.facebook.orca"); s.apply(R, "com.zhiliaoapp.musically")
    assertEquals("com.zhiliaoapp.musically", s.current)
    // ...and on to YouTube through the Recents screen (the launcher)
    s.apply(P, "com.zhiliaoapp.musically"); s.apply(R, launcher); s.apply(P, launcher); s.apply(R, "com.google.android.youtube")
    assertEquals("com.google.android.youtube", s.current)
  }

  @Test fun newAppResumedBeforeOldPausedStillCounts() {
    val s = state()
    s.apply(R, "com.facebook.orca")
    s.apply(R, "com.zhiliaoapp.musically"); s.apply(P, "com.facebook.orca")
    assertEquals("com.zhiliaoapp.musically", s.current)
  }

  @Test fun replayingTheOverlapChangesNothing() {
    val events = listOf(R to "com.facebook.orca", P to "com.facebook.orca", R to "com.zhiliaoapp.musically")
    val s = state()
    events.forEach { (t, p) -> s.apply(t, p) }
    // The next read starts 10 s earlier and sees the same events again.
    events.forEach { (t, p) -> s.apply(t, p) }
    assertEquals("com.zhiliaoapp.musically", s.current)
  }

  @Test fun movingBetweenScreensOfOneAppKeepsIt() {
    val s = state()
    s.apply(R, "com.zhiliaoapp.musically")
    s.apply(P, "com.zhiliaoapp.musically"); s.apply(R, "com.zhiliaoapp.musically")
    s.apply(23 /* ACTIVITY_STOPPED of the old screen */, "com.zhiliaoapp.musically")
    assertEquals("com.zhiliaoapp.musically", s.current)
  }

  @Test fun homeScreenAndScreenOffMeanNoApp() {
    val s = state()
    s.apply(R, "com.zhiliaoapp.musically"); s.apply(P, "com.zhiliaoapp.musically"); s.apply(R, launcher)
    assertNull(s.current)
    s.apply(R, "com.zhiliaoapp.musically"); s.apply(ForegroundState.SCREEN_NON_INTERACTIVE, "android")
    assertNull(s.current)
    // Screen on again: the app in front resumes
    s.apply(R, "com.zhiliaoapp.musically")
    assertEquals("com.zhiliaoapp.musically", s.current)
  }

  private fun r(level: Int, charging: Boolean = false, min: Long = 0) = BatteryReportPolicy.Reading(level, charging, min * 60_000)
  private val refresh = 15 * 60_000L

  @Test fun batteryFirstReadingAndMeaningfulChanges() {
    assertTrue(BatteryReportPolicy.shouldReport(null, r(80), refresh))
    assertFalse("same level again", BatteryReportPolicy.shouldReport(r(80), r(80, min = 1), refresh))
    assertFalse("1 point above 25 %", BatteryReportPolicy.shouldReport(r(80), r(79, min = 2), refresh))
    assertTrue("2 points", BatteryReportPolicy.shouldReport(r(80), r(78, min = 3), refresh))
    assertTrue("every point at 25 % or below", BatteryReportPolicy.shouldReport(r(21), r(20, min = 1), refresh))
    assertTrue("charger plugged in", BatteryReportPolicy.shouldReport(r(50), r(50, charging = true), refresh))
    assertTrue("15-minute refresh", BatteryReportPolicy.shouldReport(r(50, min = 0), r(50, min = 15), refresh))
    assertFalse("invalid reading", BatteryReportPolicy.shouldReport(r(50), r(0, min = 30), refresh))
  }

  @Test fun retryPauseGrowsAndIsCapped() {
    assertEquals(20_000L, RetryPolicy.delayMs(20_000, 1, 300_000))
    assertEquals(40_000L, RetryPolicy.delayMs(20_000, 2, 300_000))
    assertEquals(300_000L, RetryPolicy.delayMs(20_000, 9, 300_000))
  }
}
