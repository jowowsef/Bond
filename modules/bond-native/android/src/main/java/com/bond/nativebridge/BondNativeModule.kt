package com.bond.nativebridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** The controls approved for THIS phone, sent from TypeScript after each sync. */
class ControlsConfig : Record {
  @Field val webCategories: List<String> = emptyList()
  @Field val blockedDomains: List<String> = emptyList()
  @Field val allowedDomains: List<String> = emptyList()
  @Field val blockedApps: List<String> = emptyList()
  @Field val internetBlockedApps: List<String> = emptyList()
  @Field val appLabels: Map<String, String> = emptyMap()
  @Field val partnerName: String = "your partner"
}

/**
 * The bridge between TypeScript (React Native) and Android.
 * Every function listed here can be called from modules/bond-native/index.ts.
 */
class BondNativeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Opens an Android settings screen. */
  private fun openSettings(action: String, data: Uri? = null) {
    val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (data != null) intent.data = data
    try {
      context.startActivity(intent)
    } catch (_: Exception) {
      // Some phone brands don't have every screen — fall back to main Settings.
      context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun protectionStatus(): Map<String, Any?> {
    val ctx = context
    val store = ControlsStore(ctx)
    return mapOf(
      "vpnPermission" to (VpnService.prepare(ctx) == null),
      "vpnRunning" to BondVpnService.isRunning,
      "vpnNeeded" to store.needsVpn,
      "accessibilityEnabled" to BondAccessibilityService.isEnabled(ctx),
      "adultListSize" to Blocklists.downloadedCount(ctx, "adult"),
      "gamblingListSize" to Blocklists.downloadedCount(ctx, "gambling"),
    )
  }

  override fun definition() = ModuleDefinition {
    Name("BondNative")

    // ---------------- Device info ----------------
    Function("getDeviceInfo") {
      mapOf(
        "sdkInt" to Build.VERSION.SDK_INT,
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "packageName" to context.packageName,
      )
    }

    // ---------------- Screen time ----------------
    Function("hasUsageAccess") { UsageStatsHelper.hasUsageAccess(context) }

    Function("openUsageAccessSettings") { openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS) }

    AsyncFunction("getUsage") { startMs: Double, endMs: Double ->
      if (!UsageStatsHelper.hasUsageAccess(context)) {
        throw Exceptions.MissingPermissions("Usage access")
      }
      val r = UsageStatsHelper.getUsage(context, startMs.toLong(), endMs.toLong())
      mapOf(
        "totalMs" to r.totalMs.toDouble(),
        "launches" to r.launches,
        "apps" to r.apps.map {
          mapOf(
            "packageName" to it.packageName,
            "appName" to it.appName,
            "foregroundMs" to it.foregroundMs.toDouble(),
            "launches" to it.launches,
          )
        },
      )
    }

    AsyncFunction("getInstalledApps") {
      UsageStatsHelper.getLaunchableApps(context).map {
        mapOf("packageName" to it.first, "appName" to it.second)
      }
    }

    Function("getProtectedPackages") { SafePackages.all(context).toList() }

    // ---------------- Website protection (VPN) ----------------
    Function("isVpnPermissionGranted") { VpnService.prepare(context) == null }

    /**
     * Shows Android's "Bond wants to set up a VPN connection" dialog.
     * Returns true if permission was ALREADY granted (no dialog shown).
     * After the dialog, the app re-checks when it comes back to the front.
     */
    Function("requestVpnPermission") {
      val intent = VpnService.prepare(context) ?: return@Function true
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      activity.startActivityForResult(intent, 4242)
      false
    }

    Function("openVpnSettings") { openSettings(Settings.ACTION_VPN_SETTINGS) }

    /**
     * Save the approved controls on the phone and start/stop/reload the
     * local filter to match. Returns the protection status afterwards.
     */
    AsyncFunction("applyControls") { config: ControlsConfig ->
      val ctx = context
      val store = ControlsStore(ctx)
      store.save(
        categories = config.webCategories,
        blockedDomains = config.blockedDomains,
        allowedDomains = config.allowedDomains,
        blockedApps = config.blockedApps,
        internetBlockedApps = config.internetBlockedApps,
        appLabels = config.appLabels,
        partnerName = config.partnerName,
      )
      var startError: String? = null
      if (store.needsVpn) {
        if (VpnService.prepare(ctx) == null) {
          val running = BondVpnService.instance
          if (running != null && BondVpnService.isRunning) {
            running.reloadRules()
          } else {
            try { BondVpnService.start(ctx) } catch (e: Exception) { startError = e.message }
          }
        }
      } else if (BondVpnService.isRunning) {
        BondVpnService.stop(ctx)
      }
      protectionStatus() + mapOf("startError" to startError)
    }

    Function("getProtectionStatus") { protectionStatus() }

    // ---------------- App blocking (Accessibility) ----------------
    Function("isAccessibilityEnabled") { BondAccessibilityService.isEnabled(context) }

    Function("openAccessibilitySettings") { openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS) }

    /** Bond's "App info" page — needed on Android 13+ for "Allow restricted settings". */
    Function("openAppDetails") {
      openSettings(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
    }

    // ---------------- Battery optimisation ----------------
    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("openBatteryOptimizationSettings") {
      openSettings(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    }
  }
}
