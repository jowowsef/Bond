package com.bond.nativebridge

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * APP BLOCKING — via a clearly disclosed Accessibility Service.
 *
 * Why Accessibility? On a normal (non-company-managed) Android phone, the
 * ONLY ways for an app to stop another app from opening are:
 *   (a) Device Owner mode — needs a factory reset + computer setup, and
 *       gives the app far more power than we want. Not used.
 *   (b) An Accessibility Service that notices "app X just opened" and
 *       sends the user back to the home screen. ← what we do.
 *
 * This service:
 *   - only receives "window changed" events and reads the PACKAGE NAME,
 *   - cannot read screen content (canRetrieveWindowContent=false),
 *   - never blocks Bond, Settings, the dialer or the home screen,
 *   - can be turned off by the owner any time in Settings → Accessibility.
 */
class BondAccessibilityService : AccessibilityService() {

  private var lastBlockedPackage: String? = null
  private var lastBlockedAt = 0L
  private var safeCache: Set<String> = emptySet()
  private var safeCacheAt = 0L

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == packageName) return

    val store = ControlsStore(this)
    if (pkg !in store.blockedApps) return
    if (pkg in safePackages()) return

    // Don't spam: ignore repeat events for the same app within 1.5 seconds.
    val now = System.currentTimeMillis()
    if (pkg == lastBlockedPackage && now - lastBlockedAt < 1500) return
    lastBlockedPackage = pkg
    lastBlockedAt = now

    // 1) Leave the blocked app.  2) Show a friendly explanation screen.
    performGlobalAction(GLOBAL_ACTION_HOME)
    val intent = Intent(this, BlockedActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      .putExtra(BlockedActivity.EXTRA_APP_NAME, store.appLabel(pkg))
      .putExtra(BlockedActivity.EXTRA_PARTNER_NAME, store.partnerName)
    try { startActivity(intent) } catch (_: Exception) {}
  }

  private fun safePackages(): Set<String> {
    val now = System.currentTimeMillis()
    if (now - safeCacheAt > 60_000) {
      safeCache = SafePackages.all(this)
      safeCacheAt = now
    }
    return safeCache
  }

  override fun onInterrupt() {}

  companion object {
    /** Is the service switched on in Settings → Accessibility? */
    fun isEnabled(context: Context): Boolean {
      val expected = ComponentName(context, BondAccessibilityService::class.java)
      val enabled = Settings.Secure.getString(
        context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return false
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == expected }
    }
  }
}
