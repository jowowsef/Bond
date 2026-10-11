package com.bond.usage

import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A small, local diagnostics log for the background service (what it
 * detected, what it reported, what JavaScript answered, and why it stopped),
 * so a detection problem can be told apart from an upload problem.
 *
 * Kept only on this phone (never uploaded): the last 80 lines, in Bond's own
 * private storage. Shown in Bond's hidden Diagnostics screen and in logcat
 * (tag "BondBackground"). App package names appear here because that is what
 * is being diagnosed; nothing else about the person is written.
 */
object BackgroundDiagnostics {
  private const val TAG = "BondBackground"
  private const val PREFS = "bond_background_diagnostics"
  private const val KEY = "lines"
  private const val MAX = 80
  private val lines = ArrayDeque<String>()
  private var loaded = false
  private val time = SimpleDateFormat("HH:mm:ss", Locale.US)

  @Synchronized
  fun log(context: Context?, message: String) {
    Log.i(TAG, message)
    if (context == null) return
    load(context)
    lines.addLast("${time.format(Date())} $message")
    while (lines.size > MAX) lines.removeFirst()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, lines.joinToString("\n")).apply()
  }

  @Synchronized
  fun read(context: Context): List<String> {
    load(context)
    return lines.toList()
  }

  @Synchronized
  fun clear(context: Context) {
    lines.clear()
    loaded = true
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
  }

  private fun load(context: Context) {
    if (loaded) return
    loaded = true
    val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
    saved.split("\n").filter { it.isNotBlank() }.takeLast(MAX).forEach { lines.addLast(it) }
  }
}
