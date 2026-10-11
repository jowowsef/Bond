package com.bond.web

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService

/**
 * After a restart (or an app update), turn Web Protection back on if the
 * owner left it on and the VPN permission is still granted. Nothing else.
 */
class WebFilterBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!WebFilterPrefs(context).enabled) return
    if (VpnService.prepare(context) != null) return
    try {
      WebFilterVpnService.start(context)
    } catch (_: Exception) {
      // Android refused a background start; Bond restarts it when opened.
    }
  }
}
