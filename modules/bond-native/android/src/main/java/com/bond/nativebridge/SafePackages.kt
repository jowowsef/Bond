package com.bond.nativebridge

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.telecom.TelecomManager

/**
 * Apps that Bond will NEVER block, no matter what was requested.
 * This guarantees nobody can be locked out of their own phone:
 *   - Bond itself (so you can always turn a control off)
 *   - Android Settings (so you can always disable Bond's permissions)
 *   - The home screen / launcher
 *   - The phone dialer + emergency apps
 *   - System UI and the permission dialogs
 */
object SafePackages {
  private val ALWAYS_SAFE = setOf(
    "com.android.settings",
    "com.android.systemui",
    "com.android.phone",
    "com.android.server.telecom",
    "com.android.emergency",
    "com.google.android.dialer",
    "com.android.dialer",
    "com.google.android.permissioncontroller",
    "com.android.permissioncontroller",
    "com.google.android.packageinstaller",
    "com.android.packageinstaller",
  )

  fun launcherPackages(context: Context): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return context.packageManager
      .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      .mapNotNull { it.activityInfo?.packageName }
      .toSet()
  }

  fun all(context: Context): Set<String> {
    val result = HashSet(ALWAYS_SAFE)
    result.add(context.packageName)
    result.addAll(launcherPackages(context))
    try {
      val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      telecom?.defaultDialerPackage?.let { result.add(it) }
    } catch (_: Exception) {
    }
    return result
  }

  fun isSafe(context: Context, packageName: String): Boolean = packageName in all(context)
}
