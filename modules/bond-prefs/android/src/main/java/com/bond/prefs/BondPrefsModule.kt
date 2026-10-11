package com.bond.prefs

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Small on-phone preferences that must be readable INSTANTLY at startup
 * (before any screen is drawn), which the async JS storage can't do.
 * Currently only the theme choice: "system", "light" or "dark".
 */
class BondPrefsModule : Module() {

  private val prefs
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSharedPreferences("bond_prefs", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("BondPrefs")

    Function("getTheme") {
      when (val v = prefs.getString("theme", "system")) {
        "light", "dark" -> v
        else -> "system"
      }
    }

    Function("setTheme") { value: String ->
      val safe = if (value == "light" || value == "dark") value else "system"
      // commit() (not apply()) so the value is on disk before the app reloads.
      prefs.edit().putString("theme", safe).commit()
      safe
    }
  }
}
