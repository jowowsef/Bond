package com.bond.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService

/**
 * After the phone restarts (or Bond is updated), turn website protection
 * back on — but ONLY if the owner had already approved controls that need
 * it and had already granted the VPN permission. Nothing new is enabled here.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!ControlsStore(context).needsVpn) return
    if (VpnService.prepare(context) != null) return // permission not granted
    try {
      BondVpnService.start(context)
    } catch (_: Exception) {
      // Android may refuse in rare cases; it will start next time Bond opens.
    }
  }
}
