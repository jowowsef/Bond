package com.bond.nativebridge

import android.content.Context
import java.net.InetAddress

/**
 * Decides, for one DNS lookup, whether it is allowed and which real DNS
 * server to forward it to.
 *
 * Order of decisions:
 *   1. Allowlist (owner's own "always allow" list) → allowed, plain DNS.
 *   2. Custom blocked websites                   → blocked.
 *   3. Category lists (adult, gambling)          → blocked.
 *   4. Everything else is forwarded to Cloudflare:
 *        adult on            → 1.1.1.3 (blocks malware + adult)
 *        malware/phishing on → 1.1.1.2 (blocks malware + phishing)
 *        nothing special     → 1.1.1.1 (normal, no filtering)
 *      Cloudflare answers blocked sites with 0.0.0.0, so they fail to load.
 *
 * A rule for "example.com" also covers "www.example.com", "m.example.com"...
 */
class DnsFilter(
  private val allowed: Set<String>,
  private val blocked: Set<String>,
  private val categorySets: List<Set<String>>,
  val internetBlockedApps: Set<String>,
  categories: Set<String>,
) {
  val upstreams: List<InetAddress> = when {
    "adult" in categories -> listOf(ip(1, 1, 1, 3), ip(1, 0, 0, 3))
    "malware" in categories || "phishing" in categories -> listOf(ip(1, 1, 1, 2), ip(1, 0, 0, 2))
    else -> listOf(ip(1, 1, 1, 1), ip(1, 0, 0, 1))
  }
  val plainUpstreams: List<InetAddress> = listOf(ip(1, 1, 1, 1), ip(1, 0, 0, 1))

  enum class Verdict { ALLOW_PLAIN, FORWARD_FILTERED, BLOCK }

  fun check(domain: String): Verdict {
    if (matches(domain, allowed)) return Verdict.ALLOW_PLAIN
    if (matches(domain, blocked)) return Verdict.BLOCK
    for (set in categorySets) if (matches(domain, set)) return Verdict.BLOCK
    return Verdict.FORWARD_FILTERED
  }

  /** True if domain or any parent domain is in the set. */
  private fun matches(domain: String, set: Set<String>): Boolean {
    if (set.isEmpty()) return false
    var d = domain
    while (true) {
      if (d in set) return true
      val dot = d.indexOf('.')
      if (dot < 0) return false
      d = d.substring(dot + 1)
    }
  }

  companion object {
    private fun ip(a: Int, b: Int, c: Int, d: Int): InetAddress =
      InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))

    fun fromStore(context: Context): DnsFilter {
      val store = ControlsStore(context)
      val categories = store.webCategories
      val lists = categories.filter { Blocklists.hasList(it) }.map { Blocklists.load(context, it) }
      return DnsFilter(
        allowed = store.allowedDomains,
        blocked = store.blockedDomains,
        categorySets = lists,
        internetBlockedApps = store.internetBlockedApps,
        categories = categories,
      )
    }
  }
}
