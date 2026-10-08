package com.bond.nativebridge

import android.content.Context
import android.content.SharedPreferences

/**
 * ControlsStore = the phone's LOCAL copy of the controls that the owner
 * has approved.
 *
 * Why store it locally? The VPN (website protection) and the Accessibility
 * Service (app blocking) must keep working even when there is no internet
 * or the app is closed. So every time the app syncs with Supabase it writes
 * the approved controls here, and those services read from here.
 *
 * It uses SharedPreferences, a tiny key/value file private to this app.
 */
class ControlsStore(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** 'adult' | 'gambling' | 'malware' | 'phishing' */
  val webCategories: Set<String> get() = prefs.getStringSet(KEY_CATEGORIES, emptySet()) ?: emptySet()
  val blockedDomains: Set<String> get() = prefs.getStringSet(KEY_BLOCKED_DOMAINS, emptySet()) ?: emptySet()
  val allowedDomains: Set<String> get() = prefs.getStringSet(KEY_ALLOWED_DOMAINS, emptySet()) ?: emptySet()
  /** Apps whose launch is paused by the Accessibility Service */
  val blockedApps: Set<String> get() = prefs.getStringSet(KEY_BLOCKED_APPS, emptySet()) ?: emptySet()
  /** Apps whose DNS lookups get refused by the VPN (best effort internet block) */
  val internetBlockedApps: Set<String> get() = prefs.getStringSet(KEY_INTERNET_APPS, emptySet()) ?: emptySet()
  val partnerName: String get() = prefs.getString(KEY_PARTNER_NAME, "your partner") ?: "your partner"

  /** Human readable name for a package, e.g. "TikTok" */
  fun appLabel(packageName: String): String =
    prefs.getString(KEY_LABEL_PREFIX + packageName, null) ?: packageName

  /** True when website protection (the VPN) has something to do. */
  val needsVpn: Boolean
    get() = webCategories.isNotEmpty() || blockedDomains.isNotEmpty() || internetBlockedApps.isNotEmpty()

  fun save(
    categories: Collection<String>,
    blockedDomains: Collection<String>,
    allowedDomains: Collection<String>,
    blockedApps: Collection<String>,
    internetBlockedApps: Collection<String>,
    appLabels: Map<String, String>,
    partnerName: String,
  ) {
    val editor = prefs.edit()
      .putStringSet(KEY_CATEGORIES, categories.map { it.lowercase() }.toSet())
      .putStringSet(KEY_BLOCKED_DOMAINS, blockedDomains.map { normalizeDomain(it) }.filter { it.isNotEmpty() }.toSet())
      .putStringSet(KEY_ALLOWED_DOMAINS, allowedDomains.map { normalizeDomain(it) }.filter { it.isNotEmpty() }.toSet())
      .putStringSet(KEY_BLOCKED_APPS, blockedApps.toSet())
      .putStringSet(KEY_INTERNET_APPS, internetBlockedApps.toSet())
      .putString(KEY_PARTNER_NAME, partnerName)
    for ((pkg, label) in appLabels) editor.putString(KEY_LABEL_PREFIX + pkg, label)
    editor.apply()
  }

  companion object {
    private const val PREFS_NAME = "bond_controls"
    private const val KEY_CATEGORIES = "web_categories"
    private const val KEY_BLOCKED_DOMAINS = "blocked_domains"
    private const val KEY_ALLOWED_DOMAINS = "allowed_domains"
    private const val KEY_BLOCKED_APPS = "blocked_apps"
    private const val KEY_INTERNET_APPS = "internet_blocked_apps"
    private const val KEY_PARTNER_NAME = "partner_name"
    private const val KEY_LABEL_PREFIX = "label:"

    /** "https://www.Example.com/path" -> "example.com" */
    fun normalizeDomain(input: String): String {
      var d = input.trim().lowercase()
      d = d.removePrefix("http://").removePrefix("https://")
      d = d.substringBefore('/').substringBefore(':')
      d = d.removePrefix("*.").removePrefix("www.")
      return d.trimEnd('.')
    }
  }
}
