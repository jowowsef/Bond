package com.bond.prefs

import android.app.Application
import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Applies Bond's saved theme ("system", "light" or "dark") as Android's
 * night mode when the app starts, BEFORE the first screen (the splash) is
 * drawn. Without this, the splash and the window behind each screen follow
 * the phone's theme, which flashes white when Bond is set to dark (or the
 * other way round).
 */
class BondPrefsPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        applyNightMode(application)
      }
    })

  companion object {
    fun nightModeFor(theme: String?): Int = when (theme) {
      "light" -> AppCompatDelegate.MODE_NIGHT_NO
      "dark" -> AppCompatDelegate.MODE_NIGHT_YES
      else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }

    fun applyNightMode(context: Context) {
      val theme = context.getSharedPreferences("bond_prefs", Context.MODE_PRIVATE).getString("theme", "system")
      runCatching { AppCompatDelegate.setDefaultNightMode(nightModeFor(theme)) }
    }
  }
}
