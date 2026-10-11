package com.bond.web

import android.content.Context
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The on-phone list of adult website domains.
 *
 * - A small built-in list works immediately, even offline.
 * - A larger community list (StevenBlack "porn-only" hosts, open source) is
 *   downloaded and refreshed about once a week, and kept only on this phone.
 * Everything not on the list is still checked by Cloudflare's family DNS
 * (see WebFilterVpnService), which blocks many more adult sites.
 */
object AdultBlocklist {
  private const val TAG = "BondWebList"
  private const val SOURCE = "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts"
  private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

  private val SEED = setOf(
    "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com",
    "spankbang.com", "chaturbate.com", "stripchat.com", "brazzers.com", "onlyfans.com",
    "eporner.com", "tnaflix.com", "beeg.com", "cam4.com", "livejasmin.com", "bongacams.com",
    "rule34.xxx", "nhentai.net", "hentaihaven.xxx", "porn.com", "tube8.com", "motherless.com",
  )

  private fun file(context: Context) = File(File(context.filesDir, "bond-web").apply { mkdirs() }, "adult.txt")

  fun load(context: Context): Set<String> {
    val result = HashSet<String>(SEED)
    val f = file(context)
    if (f.exists()) f.forEachLine { line -> if (line.isNotBlank()) result.add(line.trim()) }
    return result
  }

  /** Domains in the downloaded list (0 = only the built-in list so far). */
  fun downloadedCount(context: Context): Int {
    val f = file(context)
    return if (f.exists()) f.useLines { it.count() } else 0
  }

  fun lastUpdatedMs(context: Context): Long = file(context).let { if (it.exists()) it.lastModified() else 0L }

  /** Download when missing or older than a week. Background thread only. Returns true if updated. */
  fun refreshIfNeeded(context: Context): Boolean {
    val f = file(context)
    if (f.exists() && System.currentTimeMillis() - f.lastModified() < MAX_AGE_MS) return false
    return try {
      val domains = download()
      if (domains.size < 1000) return false // never replace a good list with a broken download
      val tmp = File(f.parentFile, "adult.tmp")
      tmp.bufferedWriter().use { w -> domains.forEach { w.write(it); w.newLine() } }
      tmp.renameTo(f)
    } catch (e: Exception) {
      Log.w(TAG, "List download failed, will retry later")
      false
    }
  }

  /** Parses a hosts file: lines like "0.0.0.0 example.com". */
  private fun download(): List<String> {
    val conn = URL(SOURCE).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    try {
      val out = ArrayList<String>()
      conn.inputStream.bufferedReader().useLines { lines ->
        for (raw in lines) {
          val line = raw.substringBefore('#').trim()
          if (line.isEmpty()) continue
          val parts = line.split(Regex("\\s+"))
          if (parts.size < 2 || (parts[0] != "0.0.0.0" && parts[0] != "127.0.0.1")) continue
          val domain = parts[1].lowercase()
          if (domain == "0.0.0.0" || domain == "localhost" || !domain.contains('.')) continue
          out.add(domain)
        }
      }
      return out
    } finally {
      conn.disconnect()
    }
  }
}
