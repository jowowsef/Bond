package com.bond.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge for Web Protection. Exposed to JavaScript as "BondWeb".
 * Only the phone's owner can allow the VPN (Android shows its own dialog);
 * Bond can't do it for them and can't do it for anyone else's phone.
 */
class BondWebModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingPermission: Promise? = null
  private val requestCode = 0x0B0D

  override fun definition() = ModuleDefinition {
    Name("BondWeb")

    /** The real current state, read from Android every time. */
    Function("getStatus") { status(context) }

    /**
     * Show Android's "Connection request" (VPN) dialog if needed.
     * Resolves true when allowed, false when the owner said no.
     */
    AsyncFunction("requestPermission") { promise: Promise ->
      val ctx = context
      val intent = VpnService.prepare(ctx)
      if (intent == null) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      pendingPermission?.resolve(false)
      pendingPermission = promise
      activity.startActivityForResult(intent, requestCode)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != requestCode) return@OnActivityResult
      val promise = pendingPermission ?: return@OnActivityResult
      pendingPermission = null
      promise.resolve(payload.resultCode == Activity.RESULT_OK)
    }

    /** Turn protection on (permission must already be granted). */
    Function("enable") {
      val ctx = context
      if (VpnService.prepare(ctx) != null) return@Function false
      WebFilterPrefs(ctx).apply { enabled = true; stopReason = null }
      WebFilterVpnService.start(ctx)
      true
    }

    /** Turn protection off. Always allowed: nobody is locked in. */
    Function("disable") {
      val ctx = context
      WebFilterPrefs(ctx).apply { enabled = false; stopReason = null }
      WebFilterVpnService.stop(ctx)
      true
    }

    Function("openVpnSettings") { openSettings(context, Settings.ACTION_VPN_SETTINGS) }

    /** Private DNS lives under Network & internet; there is no direct public screen for it. */
    Function("openNetworkSettings") { openSettings(context, Settings.ACTION_WIRELESS_SETTINGS) }
  }

  private fun openSettings(ctx: Context, action: String) {
    try {
      ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun status(ctx: Context): Map<String, Any?> {
    val prefs = WebFilterPrefs(ctx)
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    var anyVpn = false
    var privateDnsHost: String? = null
    try {
      @Suppress("DEPRECATION")
      for (network in cm.allNetworks) {
        val caps = cm.getNetworkCapabilities(network)
        if (caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true) anyVpn = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          val lp = cm.getLinkProperties(network)
          // A named Private DNS provider ("strict" mode) bypasses Bond's filter.
          if (lp?.isPrivateDnsActive == true && lp.privateDnsServerName != null) privateDnsHost = lp.privateDnsServerName
        }
      }
    } catch (_: Exception) {
      // Status is best-effort; missing info just means no warning.
    }
    val running = WebFilterVpnService.running
    return mapOf(
      "enabled" to prefs.enabled,
      "running" to running,
      "permissionGranted" to (VpnService.prepare(ctx) == null),
      "otherVpnActive" to (anyVpn && !running),
      "privateDnsHost" to privateDnsHost,
      "stopReason" to prefs.stopReason,
      "listDomains" to AdultBlocklist.downloadedCount(ctx),
      "listUpdatedAt" to AdultBlocklist.lastUpdatedMs(ctx).toDouble(),
    )
  }
}
