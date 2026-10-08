package com.bond.nativebridge

import android.content.Context
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Category blocklists (lists of website domains).
 *
 * Sources (free, open-source, community maintained):
 *  - Adult:    StevenBlack hosts "porn-only"     (~75,000 domains)
 *  - Gambling: StevenBlack hosts "gambling-only" (~6,500 domains)
 *  - Malware & phishing: no local list needed — those lookups are sent to
 *    Cloudflare's free filtering DNS (1.1.1.2 / 1.1.1.3), which blocks them.
 *
 * The lists are downloaded once and refreshed every 7 days. A small
 * built-in "seed" list makes protection work immediately, even before the
 * first download finishes or if the phone is offline.
 */
object Blocklists {
  private const val TAG = "BondBlocklists"
  private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

  private val SOURCES = mapOf(
    "adult" to "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts",
    "gambling" to "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-only/hosts",
  )

  private val SEEDS = mapOf(
    "adult" to setOf(
      "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com",
      "spankbang.com", "chaturbate.com", "stripchat.com", "brazzers.com", "onlyfans.com",
      "eporner.com", "tnaflix.com", "beeg.com", "cam4.com", "livejasmin.com", "bongacams.com",
      "rule34.xxx", "nhentai.net", "hentaihaven.xxx", "porn.com", "tube8.com", "motherless.com",
    ),
    "gambling" to setOf(
      "bet365.com", "pokerstars.com", "1xbet.com", "stake.com", "draftkings.com", "fanduel.com",
      "williamhill.com", "betway.com", "888casino.com", "888poker.com", "bovada.lv", "betfair.com",
      "unibet.com", "ladbrokes.com", "paddypower.com", "casumo.com", "leovegas.com", "bitstarz.com",
      "roobet.com", "pinnacle.com", "22bet.com", "melbet.com", "mostbet.com", "okbet.com", "bingoplus.com",
    ),
  )

  private fun fileFor(context: Context, category: String) =
    File(File(context.filesDir, "blocklists").apply { mkdirs() }, "$category.txt")

  /** Domains for a category (seed list + downloaded list). */
  fun load(context: Context, category: String): Set<String> {
    val result = HashSet<String>(SEEDS[category] ?: emptySet())
    val file = fileFor(context, category)
    if (file.exists()) {
      file.forEachLine { line -> if (line.isNotBlank()) result.add(line.trim()) }
    }
    return result
  }

  fun downloadedCount(context: Context, category: String): Int {
    val file = fileFor(context, category)
    return if (file.exists()) file.useLines { it.count() } else 0
  }

  /** Categories that have a downloadable list. */
  fun hasList(category: String) = SOURCES.containsKey(category)

  /**
   * Download/refresh lists that are missing or older than 7 days.
   * Must be called on a background thread. Returns true if anything changed.
   */
  fun refreshIfNeeded(context: Context, categories: Set<String>): Boolean {
    var changed = false
    for (category in categories) {
      val url = SOURCES[category] ?: continue
      val file = fileFor(context, category)
      val fresh = file.exists() && System.currentTimeMillis() - file.lastModified() < MAX_AGE_MS
      if (fresh) continue
      try {
        val domains = download(url)
        if (domains.size > 100) { // sanity check, never replace a list with garbage
          val tmp = File(file.parentFile, "$category.tmp")
          tmp.bufferedWriter().use { w -> domains.forEach { w.write(it); w.newLine() } }
          tmp.renameTo(file)
          changed = true
          Log.i(TAG, "Downloaded $category list: ${domains.size} domains")
        }
      } catch (e: Exception) {
        Log.w(TAG, "Could not download $category list (will retry later): ${e.message}")
      }
    }
    return changed
  }

  /** Parses a "hosts" file: lines like "0.0.0.0 example.com" */
  private fun download(url: String): List<String> {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    try {
      val out = ArrayList<String>()
      conn.inputStream.bufferedReader().useLines { lines ->
        for (raw in lines) {
          val line = raw.substringBefore('#').trim()
          if (line.isEmpty()) continue
          val parts = line.split(Regex("\\s+"))
          if (parts.size < 2) continue
          if (parts[0] != "0.0.0.0" && parts[0] != "127.0.0.1") continue
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
