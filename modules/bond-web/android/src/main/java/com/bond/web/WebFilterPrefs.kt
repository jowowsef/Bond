package com.bond.web

import android.content.Context

/** The owner's choice (on/off) and why the filter last stopped. Stored only on this phone. */
class WebFilterPrefs(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("bond_web_protection", Context.MODE_PRIVATE)

  /** The phone's owner wants protection on. */
  var enabled: Boolean
    get() = prefs.getBoolean("enabled", false)
    set(value) = prefs.edit().putBoolean("enabled", value).apply()

  /** "revoked" = turned off from Android settings or replaced by another VPN; "failed" = could not start. */
  var stopReason: String?
    get() = prefs.getString("stop_reason", null)
    set(value) = prefs.edit().putString("stop_reason", value).apply()
}
