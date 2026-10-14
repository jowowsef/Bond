package com.bond.usage

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager

/**
 * LIVE CURRENTLY USING (optional, off by default).
 *
 * An Android accessibility service that the phone's owner turns on themselves
 * in Settings > Accessibility > Bond. Android tells it the moment another app's
 * screen comes to the front (TYPE_WINDOW_STATE_CHANGED), so the partner sees
 * the switch within a second or two, instead of waiting for Android's usage
 * log (which some phones write late).
 *
 * What it reads: ONLY the package name of the app whose screen came to the
 * front. canRetrieveWindowContent is false (res/xml/bond_app_watch.xml), so it
 * can't read anything on the screen, what is typed, or anything inside apps.
 * It sends nothing itself: it hands the app to Bond's background service
 * (CurrentAppService), which reports it to JavaScript, where every rule is
 * checked again (signed in, paired, Currently Using sharing ON) before
 * anything is uploaded. With Currently Using off, nothing is sent.
 *
 * Counted: a real app screen (an Activity) of an app. Not counted: the
 * keyboard, the notification shade / system UI, dialogs and toasts (not
 * Activities). The home screen counts as "no app".
 * A switch is committed after it stays for 1 second (debounce), so quick
 * flicks between apps upload once.
 *
 * Android keeps an enabled accessibility service running and brings it back
 * after Bond's process is killed; some phones (for example Tecno/HiOS) can
 * still close it. Every start and stop is written to the diagnostics log.
 */
class BondAppWatchService : AccessibilityService() {

  private val main = Handler(Looper.getMainLooper())
  private var pending: String? = null
  private var pendingSet = false
  private val activityCache = HashMap<String, Boolean>()
  private var launchers: Set<String> = emptySet()
  private var keyboards: Set<String> = emptySet()

  private val commit = Runnable {
    if (!pendingSet) return@Runnable
    pendingSet = false
    LiveAppWatch.update(applicationContext, pending)
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    launchers = homePackages(this)
    keyboards = keyboardPackages()
    LiveAppWatch.setConnected(applicationContext, true)
    // Still marked as running from before = it never stopped cleanly: the
    // phone closed Bond's process and Android brought Live mode back by itself.
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    BackgroundDiagnostics.log(
      applicationContext,
      if (prefs.getBoolean(KEY_ALIVE, false)) "live: back on by itself (the phone had closed Bond)" else "live: on (Accessibility connected)",
    )
    prefs.edit().putBoolean(KEY_ALIVE, true).apply()
    // Bond's process may have just been started for this service: make sure
    // the background service that uploads is running too (if sharing is on).
    CurrentAppService.resumeIfWanted(applicationContext, "live mode connected")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == SYSTEM_UI || pkg == "android" || pkg in keyboards) return // shade, system dialogs, keyboard
    val next: String? = when {
      pkg in launchers -> null // home screen: no app
      isActivity(pkg, event.className?.toString()) -> pkg
      else -> return // a dialog, toast or other window that isn't an app screen
    }
    pending = next
    pendingSet = true
    main.removeCallbacks(commit)
    main.postDelayed(commit, DEBOUNCE_MS)
  }

  override fun onInterrupt() = Unit

  override fun onUnbind(intent: Intent?): Boolean {
    main.removeCallbacks(commit)
    LiveAppWatch.setConnected(applicationContext, false)
    markStopped()
    BackgroundDiagnostics.log(applicationContext, "live: off (Accessibility turned off or closed by the phone)")
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    main.removeCallbacks(commit)
    if (LiveAppWatch.connected) {
      LiveAppWatch.setConnected(applicationContext, false)
      BackgroundDiagnostics.log(applicationContext, "live: stopped")
    }
    markStopped()
    super.onDestroy()
  }

  private fun markStopped() {
    getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ALIVE, false).apply()
  }

  /** Is this window a real screen (Activity) of that app? Cached per screen. */
  private fun isActivity(pkg: String, cls: String?): Boolean {
    if (cls.isNullOrEmpty()) return false
    val key = "$pkg/$cls"
    return activityCache.getOrPut(key) {
      try {
        packageManager.getActivityInfo(ComponentName(pkg, cls), 0)
        true
      } catch (_: Exception) {
        false
      }
    }
  }

  private fun keyboardPackages(): Set<String> = try {
    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.inputMethodList.map { it.packageName }.toSet()
  } catch (_: Exception) {
    emptySet()
  }

  companion object {
    private const val DEBOUNCE_MS = 1_000L
    private const val PREFS = "bond_live_mode"
    /** True while connected; still true at the next connect = the process was killed. */
    private const val KEY_ALIVE = "alive"
    private const val SYSTEM_UI = "com.android.systemui"

    fun homePackages(context: Context): Set<String> = try {
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      context.packageManager
        .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        .mapNotNull { it.activityInfo?.packageName }
        .toSet()
    } catch (_: Exception) {
      emptySet()
    }

    /**
     * Is Live mode part of this build? Only the Live APK declares the service
     * (src/live/AndroidManifest.xml); the standard APK doesn't, so Android
     * never lists it in Accessibility.
     */
    fun isAvailable(context: Context): Boolean = try {
      context.packageManager.getServiceInfo(ComponentName(context, BondAppWatchService::class.java), 0)
      true
    } catch (_: Exception) {
      false
    }

    /** Has the phone's owner turned Bond's Live mode on in Android's Accessibility settings? */
    fun isEnabled(context: Context): Boolean {
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      val me = ComponentName(context, BondAppWatchService::class.java)
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }
}

/**
 * The latest app from Live mode, shared with CurrentAppService (same process).
 * `current` = package in front (null = home / no app). Only used while
 * `connected`; otherwise the service reads Android's usage log as before.
 */
object LiveAppWatch {
  @Volatile
  var connected = false
    private set

  @Volatile
  var current: String? = null
    private set

  @Volatile
  var changedAt = 0L
    private set

  fun setConnected(context: Context, on: Boolean) {
    connected = on
    if (!on) current = null
    CurrentAppService.onLiveChanged()
  }

  fun update(context: Context, pkg: String?) {
    if (pkg == current && changedAt > 0) return
    current = pkg
    changedAt = System.currentTimeMillis()
    // Wake the background service so the switch is reported right away; if it
    // isn't running (the phone closed it), try to bring it back.
    if (!CurrentAppService.onLiveChanged()) CurrentAppService.resumeIfWanted(context, "live app switch")
  }
}
