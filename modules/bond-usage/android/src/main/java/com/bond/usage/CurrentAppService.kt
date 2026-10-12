package com.bond.usage

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Bond's ONE background foreground service (Android), for two consented
 * features. It runs only while JavaScript registered it (paired, setup
 * finished) and at least one of them is on; see src/lib/currentAppService.ts.
 * Android shows its quiet notification ("Bond" / "Background activity is
 * running") the whole time. There is never a second Bond service.
 *
 *  - Currently Using ("apps" mode; Currently Using sharing on + Usage
 *    access): while the screen is on, about every 20 seconds, it reads
 *    Android's usage log, works out which app is in front, and reports when it
 *    changes (plus a 10-minute refresh). Screen off: reports "no app" once and
 *    stops checking until the screen is on again.
 *  - Battery ("battery" mode; battery sharing on): Android tells it when the
 *    battery changes (no polling); it reports a meaningful change (see
 *    BatteryReportPolicy) or every 15 minutes.
 *
 * Each report runs the JavaScript task, which checks every rule again
 * (sign-in, pairing, setup, that feature's consent) and uploads. If an upload
 * can't happen (offline), the latest value is sent again with a growing pause.
 * Every step is written to BackgroundDiagnostics (local only).
 *
 * If Android kills Bond, this stops; it starts again when Bond is opened.
 */
class CurrentAppService : Service() {

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var detector: ForegroundAppDetector? = null
  private var intervalMs = DEFAULT_INTERVAL_MS
  private var heartbeatMs = DEFAULT_HEARTBEAT_MS
  private var watchApps = false
  private var watchBattery = false
  private var watchScreenTime = false
  private var screenTimeFailures = 0

  // Currently Using state
  private var lastKey: String? = null
  private var lastReportAt = 0L
  private var appRetryAt = 0L
  private var appFailures = 0
  private var lastLoggedApp: String? = "(unset)"

  // Battery state
  private var lastBattery: BatteryReportPolicy.Reading? = null
  private var latestBattery: BatteryReportPolicy.Reading? = null
  private var batteryFailures = 0

  private var screenReceiver: BroadcastReceiver? = null
  private var batteryReceiver: BroadcastReceiver? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private val tick = object : Runnable {
    override fun run() = check()
  }
  private val batteryRetry = object : Runnable {
    override fun run() {
      latestBattery?.let { reportBattery(it, "retry") }
    }
  }
  private val batteryRefresh = object : Runnable {
    override fun run() {
      readBatteryNow()?.let { onBattery(it, force = true) }
      handler?.postDelayed(this, BATTERY_REFRESH_MS)
    }
  }
  /**
   * Screen time: ask JavaScript to send today's summary about every 15
   * minutes. Skipped while the screen is off (usage can't grow then), so the
   * phone is not woken up for it.
   */
  private val screenTimeTick = object : Runnable {
    override fun run() {
      if (!watchScreenTime) return
      handler?.removeCallbacks(this)
      if (!isScreenOn()) {
        handler?.postDelayed(this, SCREEN_TIME_MS)
        return
      }
      report(Bundle().apply { putString("kind", "screen_time"); putString("reason", "refresh") }) { retry ->
        if (!watchScreenTime) return@report
        screenTimeFailures = if (retry) screenTimeFailures + 1 else 0
        val next = if (retry) RetryPolicy.delayMs(SCREEN_TIME_RETRY_BASE_MS, screenTimeFailures, SCREEN_TIME_MS) else SCREEN_TIME_MS
        handler?.removeCallbacks(this)
        handler?.postDelayed(this, next)
      }
    }
  }

  private fun isScreenOn(): Boolean =
    (getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager)?.isInteractive ?: true

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val body = intent?.getStringExtra(EXTRA_BODY) ?: DEFAULT_BODY
    intervalMs = (intent?.getLongExtra(EXTRA_INTERVAL, DEFAULT_INTERVAL_MS) ?: DEFAULT_INTERVAL_MS)
      .coerceIn(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
    heartbeatMs = (intent?.getLongExtra(EXTRA_HEARTBEAT, DEFAULT_HEARTBEAT_MS) ?: DEFAULT_HEARTBEAT_MS)
      .coerceIn(MIN_HEARTBEAT_MS, MAX_HEARTBEAT_MS)
    val apps = intent?.getBooleanExtra(EXTRA_WATCH_APPS, true) ?: true
    val battery = intent?.getBooleanExtra(EXTRA_WATCH_BATTERY, false) ?: false
    val screenTime = intent?.getBooleanExtra(EXTRA_WATCH_SCREEN_TIME, false) ?: false

    // Must become a foreground service right away (Android rule).
    try {
      val notification = buildNotification(title, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      BackgroundDiagnostics.log(applicationContext, "service: could not start in the foreground (${e.javaClass.simpleName})")
      stopSelf()
      return START_NOT_STICKY
    }

    if (thread == null) {
      thread = HandlerThread("bond-background").also { it.start() }
      handler = Handler(thread!!.looper)
      detector = ForegroundAppDetector(applicationContext)
      BackgroundDiagnostics.log(applicationContext, "service: started")
    }
    instance = this
    running = true
    handler?.post { applyModes(apps, battery, screenTime) }
    // Not restarted by Android after it kills Bond: it starts again when Bond
    // is opened, and the JavaScript side checks every rule again first.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    if (instance === this) instance = null
    handler?.removeCallbacksAndMessages(null)
    screenReceiver?.let { runCatching { unregisterReceiver(it) } }
    batteryReceiver?.let { runCatching { unregisterReceiver(it) } }
    screenReceiver = null
    batteryReceiver = null
    thread?.quitSafely()
    thread = null
    handler = null
    detector = null
    watchApps = false
    watchBattery = false
    watchScreenTime = false
    BackgroundDiagnostics.log(applicationContext, "service: stopped")
    super.onDestroy()
  }

  /** Turn each part on or off (on the service thread). Nothing left on = stop. */
  private fun applyModes(apps: Boolean, battery: Boolean, screenTime: Boolean) {
    if (apps != watchApps || battery != watchBattery || screenTime != watchScreenTime) {
      BackgroundDiagnostics.log(applicationContext, "service: modes apps=$apps battery=$battery screenTime=$screenTime")
    }
    if (!apps && !battery && !screenTime) {
      stopSelf()
      return
    }
    if (apps && !watchApps) {
      watchApps = true
      lastKey = null
      registerScreenReceiver()
    } else if (!apps && watchApps) {
      watchApps = false
      handler?.removeCallbacks(tick)
      screenReceiver?.let { runCatching { unregisterReceiver(it) } }
      screenReceiver = null
    }
    if (watchApps) reschedule(0)

    if (battery && !watchBattery) {
      watchBattery = true
      lastBattery = null
      registerBatteryReceiver()
      handler?.removeCallbacks(batteryRefresh)
      handler?.postDelayed(batteryRefresh, BATTERY_REFRESH_MS)
    } else if (!battery && watchBattery) {
      watchBattery = false
      batteryReceiver?.let { runCatching { unregisterReceiver(it) } }
      batteryReceiver = null
      handler?.removeCallbacks(batteryRefresh)
      handler?.removeCallbacks(batteryRetry)
    }

    if (screenTime && !watchScreenTime) {
      watchScreenTime = true
      screenTimeFailures = 0
      handler?.removeCallbacks(screenTimeTick)
      handler?.postDelayed(screenTimeTick, SCREEN_TIME_FIRST_MS) // one soon after starting
    } else if (!screenTime && watchScreenTime) {
      watchScreenTime = false
      handler?.removeCallbacks(screenTimeTick)
    }
  }

  // ---------------- Currently Using ----------------

  private fun check() {
    if (!watchApps) return
    val ctx = applicationContext
    if (!UsageStatsReader.hasUsageAccess(ctx)) {
      // Usage access was turned off: nothing can be read any more. Battery
      // (if on) keeps running.
      BackgroundDiagnostics.log(ctx, "apps: Usage access is off; stopping app checks")
      report(Bundle().apply { putString("kind", "app"); putString("reason", REASON_NO_ACCESS) }) { }
      applyModes(false, watchBattery, watchScreenTime)
      return
    }
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    val screenOn = power.isInteractive
    val app = if (screenOn) {
      try {
        detector?.current()
      } catch (e: Exception) {
        BackgroundDiagnostics.log(ctx, "apps: usage log not readable (${e.javaClass.simpleName}); nothing reported")
        reschedule(intervalMs)
        return // unavailable this time: report nothing rather than guess
      }
    } else {
      null
    }
    val key = app?.packageName ?: NO_APP
    if (key != lastLoggedApp) {
      BackgroundDiagnostics.log(ctx, "apps: detected ${app?.packageName ?: if (screenOn) "no app (home/lock screen)" else "no app (screen off)"}")
      lastLoggedApp = key
    }
    val now = System.currentTimeMillis()
    val retryDue = appRetryAt in 1..now
    if (key != lastKey || now - lastReportAt >= heartbeatMs || retryDue) {
      appRetryAt = 0L
      val reason = if (key != lastKey) REASON_CHANGE else if (retryDue) "retry" else REASON_HEARTBEAT
      val data = Bundle().apply {
        putString("kind", "app")
        putString("packageName", app?.packageName)
        putString("appName", app?.appName)
        putDouble("observedAt", now.toDouble())
        putString("reason", reason)
      }
      report(data) { retry ->
        if (retry) {
          appFailures += 1
          appRetryAt = System.currentTimeMillis() + RetryPolicy.delayMs(intervalMs, appFailures, MAX_RETRY_MS)
        } else {
          appFailures = 0
          appRetryAt = 0L
        }
      }
      lastKey = key
      lastReportAt = now
    }
    // Screen off: no checks until it is on again (the receiver wakes us),
    // only the occasional refresh.
    reschedule(if (screenOn) intervalMs else heartbeatMs)
  }

  private fun reschedule(delayMs: Long) {
    val h = handler ?: return
    h.removeCallbacks(tick)
    if (watchApps) h.postDelayed(tick, delayMs)
  }

  private fun registerScreenReceiver() {
    if (screenReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          Intent.ACTION_SCREEN_OFF -> reschedule(0) // report "no app" now
          Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> reschedule(500)
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(receiver, filter, null, handler)
    }
    screenReceiver = receiver
  }

  // ---------------- Battery ----------------

  private fun registerBatteryReceiver() {
    if (batteryReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        readingFrom(intent)?.let { onBattery(it, force = false) }
      }
    }
    // ACTION_BATTERY_CHANGED is sticky: registering also delivers the current value.
    val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(receiver, filter, null, handler)
    }
    batteryReceiver = receiver
  }

  private fun readingFrom(intent: Intent?): BatteryReportPolicy.Reading? {
    if (intent == null) return null
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level < 0 || scale <= 0) return null
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    return BatteryReportPolicy.Reading(Math.round(level * 100f / scale), charging, System.currentTimeMillis())
  }

  private fun readBatteryNow(): BatteryReportPolicy.Reading? =
    readingFrom(registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)))

  private fun onBattery(reading: BatteryReportPolicy.Reading, force: Boolean) {
    if (!watchBattery) return
    latestBattery = reading
    if (!force && !BatteryReportPolicy.shouldReport(lastBattery, reading, BATTERY_REFRESH_MS)) return
    lastBattery = reading
    reportBattery(reading, if (force) "refresh" else "change")
  }

  private fun reportBattery(reading: BatteryReportPolicy.Reading, reason: String) {
    handler?.removeCallbacks(batteryRetry)
    val data = Bundle().apply {
      putString("kind", "battery")
      putInt("level", reading.level)
      putBoolean("charging", reading.charging)
      putDouble("observedAt", reading.at.toDouble())
      putString("reason", reason)
    }
    report(data) { retry ->
      if (retry && watchBattery) {
        batteryFailures += 1
        handler?.postDelayed(batteryRetry, RetryPolicy.delayMs(BATTERY_RETRY_BASE_MS, batteryFailures, MAX_RETRY_MS))
      } else {
        batteryFailures = 0
      }
    }
  }

  // ---------------- Reporting to JavaScript ----------------

  /** Hand one observation to the JavaScript task; `onDone(retry)` runs on the service thread. */
  private fun report(data: Bundle, onDone: (retry: Boolean) -> Unit) {
    val consumer = CurrentAppTaskConsumer.active
    val what = describe(data)
    if (consumer == null) {
      // The task was unregistered (sharing stopped / signed out): nothing to report to.
      BackgroundDiagnostics.log(applicationContext, "report: no task registered; stopping ($what)")
      stopSelf()
      return
    }
    // expo-task-manager is used from the main thread (as expo-location does).
    mainHandler.post {
      consumer.report(data) { retry ->
        BackgroundDiagnostics.log(applicationContext, "report: $what -> ${if (retry) "not uploaded, will retry" else "done"}")
        handler?.post { onDone(retry) }
      }
    }
  }

  private fun describe(data: Bundle): String = when (data.getString("kind")) {
    "battery" -> "battery ${data.getInt("level")}%${if (data.getBoolean("charging")) " charging" else ""} (${data.getString("reason")})"
    "screen_time" -> "screen time (${data.getString("reason")})"
    else -> "app ${data.getString("packageName") ?: "none"} (${data.getString("reason")})"
  }

  private fun buildNotification(title: String, body: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Android requires a visible notification while a foreground service
      // runs; Bond keeps it as quiet as Android allows: "minimum" importance
      // (no sound, no vibration, no pop-up, no status-bar icon, collapsed at
      // the bottom of the notification shade). A channel's importance can't
      // be changed after it was created, so this uses a new channel id and
      // removes the older, louder one.
      runCatching { manager.deleteNotificationChannel(OLD_CHANNEL_ID) }
      // Re-creating an existing channel only updates its name and description;
      // Android keeps its importance, sound and vibration as first created (or
      // as the person set them). This channel was created at MIN with no sound
      // or vibration, so nothing louder can come back.
      val channel = NotificationChannel(CHANNEL_ID, "Background activity", NotificationManager.IMPORTANCE_MIN).apply {
        description = "Shown while Bond runs in the background for Currently Using or battery sharing (you turned them on). Silent."
        setShowBadge(false)
        enableVibration(false)
        enableLights(false)
        setSound(null, null)
        lockscreenVisibility = Notification.VISIBILITY_SECRET
      }
      manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val iconRes = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(iconRes)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_SECRET)
      .setLocalOnly(true) // not copied to watches
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      // Android 7 has no channels: the lowest priority does the same job there.
      @Suppress("DEPRECATION")
      builder.setPriority(Notification.PRIORITY_MIN).setSound(null).setVibrate(null)
    }
    if (contentIntent != null) builder.setContentIntent(contentIntent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Default behaviour: Android 12+ waits about 10 seconds before showing
      // it, so a service that stops quickly never shows a notification.
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_DEFAULT)
    }
    return builder.build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_INTERVAL = "intervalMs"
    const val EXTRA_HEARTBEAT = "heartbeatMs"
    const val EXTRA_WATCH_APPS = "watchApps"
    const val EXTRA_WATCH_BATTERY = "watchBattery"
    const val EXTRA_WATCH_SCREEN_TIME = "watchScreenTime"
    private const val CHANNEL_ID = "bond-current-app-quiet"
    private const val OLD_CHANNEL_ID = "bond-current-app"
    private const val NOTIFICATION_ID = 42017
    private const val NO_APP = "(none)"
    const val REASON_CHANGE = "change"
    const val REASON_HEARTBEAT = "heartbeat"
    const val REASON_NO_ACCESS = "no-access"
    private const val DEFAULT_TITLE = "Bond"
    private const val DEFAULT_BODY = "Background activity is running"
    const val DEFAULT_INTERVAL_MS = 20_000L
    private const val MIN_INTERVAL_MS = 15_000L
    private const val MAX_INTERVAL_MS = 60_000L
    const val DEFAULT_HEARTBEAT_MS = 10 * 60_000L
    private const val MAX_RETRY_MS = 5 * 60_000L
    private const val MIN_HEARTBEAT_MS = 2 * 60_000L
    private const val MAX_HEARTBEAT_MS = 30 * 60_000L
    /** Battery: send at least this often while sharing, even without a change. */
    private const val BATTERY_REFRESH_MS = 15 * 60_000L
    private const val BATTERY_RETRY_BASE_MS = 30_000L
    /** Screen time: about every 15 minutes while the screen is on. */
    private const val SCREEN_TIME_MS = 15 * 60_000L
    private const val SCREEN_TIME_FIRST_MS = 5_000L
    private const val SCREEN_TIME_RETRY_BASE_MS = 60_000L

    @Volatile
    var running = false
      private set

    @Volatile
    private var instance: CurrentAppService? = null

    /** Which parts are on right now (for the diagnostics screen). */
    fun modes(): Triple<Boolean, Boolean, Boolean> =
      instance?.let { Triple(it.watchApps, it.watchBattery, it.watchScreenTime) } ?: Triple(false, false, false)

    /**
     * Change which parts run, without starting the service again (allowed
     * from the background, unlike starting a foreground service). Returns
     * false when the service isn't running.
     */
    fun updateModes(apps: Boolean, battery: Boolean, screenTime: Boolean): Boolean {
      val svc = instance ?: return false
      val h = svc.handler ?: return false
      h.post { svc.applyModes(apps, battery, screenTime) }
      return true
    }
  }
}
