package com.bond.web

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * WEB PROTECTION: a local, on-phone "VPN" that only looks at DNS lookups.
 *
 * In plain words:
 *  - Android lets an app create a VPN. Bond's never sends your traffic to a
 *    server. It tells Android "use 10.111.222.1 as the DNS server, and only
 *    send traffic for that one address into the VPN". So only the question
 *    "what is the address of example.com?" reaches Bond; pages, videos and
 *    messages go straight to the internet as usual.
 *  - A lookup for a domain on the adult list is answered "does not exist",
 *    so the site can't load.
 *  - Every other lookup is passed to Cloudflare's free family DNS
 *    (1.1.1.3), which itself blocks many more adult and malware sites.
 *  - Nothing is logged or saved: no list of visited sites exists anywhere.
 *
 * Android shows a key icon while it runs, and the owner can always turn it
 * off in Bond or in Android Settings, VPN.
 *
 * Known limits (also shown in the app): apps or browsers that use their own
 * encrypted DNS, Android "Private DNS" set to a specific provider, a
 * different VPN, or typing a site's IP address can get around it.
 */
class WebFilterVpnService : VpnService() {

  companion object {
    private const val TAG = "BondWeb"
    const val ACTION_STOP = "com.bond.web.STOP"
    private const val VPN_ADDRESS = "10.111.222.2"
    private const val VPN_DNS = "10.111.222.1"

    @Volatile
    var running: Boolean = false
      private set

    fun start(context: Context) {
      context.startService(Intent(context, WebFilterVpnService::class.java))
    }

    fun stop(context: Context) {
      try {
        context.startService(Intent(context, WebFilterVpnService::class.java).setAction(ACTION_STOP))
      } catch (_: Exception) {
        // Service not running and app in the background: nothing to stop.
      }
    }

    // Cloudflare for Families: blocks malware + adult content. IPv4 first, IPv6 fallback.
    private val UPSTREAMS: List<InetAddress> by lazy {
      listOf("1.1.1.3", "1.0.0.3", "2606:4700:4700::1113", "2606:4700:4700::1003").mapNotNull {
        try { InetAddress.getByName(it) } catch (_: Exception) { null }
      }
    }
  }

  @Volatile private var tun: ParcelFileDescriptor? = null
  @Volatile private var blocked: Set<String> = emptySet()
  private var reader: Thread? = null
  private var pool: ExecutorService? = null
  private var output: FileOutputStream? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = WebFilterPrefs(this)
    if (intent?.action == ACTION_STOP) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    // Started by Android's "Always-on VPN" for Bond: the owner chose that, so honor it.
    if (intent?.action == SERVICE_INTERFACE) prefs.enabled = true
    if (!prefs.enabled) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    if (tun == null) establish(prefs)
    return START_STICKY
  }

  private fun establish(prefs: WebFilterPrefs) {
    if (prepare(this) != null) {
      // VPN permission not granted (or taken by another VPN app).
      prefs.stopReason = "permission"
      stopSelf()
      return
    }
    blocked = AdultBlocklist.load(this)
    Thread {
      if (AdultBlocklist.refreshIfNeeded(this)) blocked = AdultBlocklist.load(this)
    }.start()

    val configure = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = Builder()
      .setSession("Bond Web Protection")
      .addAddress(VPN_ADDRESS, 32)
      .addDnsServer(VPN_DNS)
      .addRoute(VPN_DNS, 32) // ONLY DNS lookups enter the VPN
      .setBlocking(true)
    // Bond's own traffic (sync, list download) is not filtered.
    try { builder.addDisallowedApplication(packageName) } catch (_: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
    configure?.let { builder.setConfigureIntent(it) }

    val iface = try { builder.establish() } catch (_: Exception) { null }
    if (iface == null) {
      prefs.stopReason = "failed"
      stopSelf()
      return
    }
    tun = iface
    output = FileOutputStream(iface.fileDescriptor)
    pool = Executors.newFixedThreadPool(4)
    reader = Thread({ readLoop(iface) }, "BondWebReader").also { it.start() }
    prefs.stopReason = null
    running = true
    Log.i(TAG, "Web Protection started")
  }

  private fun readLoop(iface: ParcelFileDescriptor) {
    val input = FileInputStream(iface.fileDescriptor)
    val buffer = ByteArray(32767)
    try {
      while (!Thread.currentThread().isInterrupted) {
        val length = input.read(buffer)
        if (length <= 0) continue
        val query = DnsPackets.parse(buffer, length) ?: continue
        pool?.execute { handle(query) }
      }
    } catch (_: Exception) {
      // Normal when the VPN closes.
    }
  }

  private fun handle(q: DnsPackets.Query) {
    try {
      if (isBlocked(q.domain)) {
        reply(q, DnsPackets.blockedResponse(q))
        return
      }
      reply(q, forward(q) ?: DnsPackets.failureResponse(q))
    } catch (_: Exception) {
      // Never log the domain: Bond keeps no browsing history.
    }
  }

  /** True if the domain or any parent domain (m.example.com -> example.com) is listed. */
  private fun isBlocked(domain: String): Boolean {
    val set = blocked
    var d = domain
    while (true) {
      if (d in set) return true
      val dot = d.indexOf('.')
      if (dot < 0) return false
      d = d.substring(dot + 1)
    }
  }

  private fun forward(q: DnsPackets.Query): ByteArray? {
    for (server in UPSTREAMS) {
      try {
        DatagramSocket().use { socket ->
          protect(socket) // this socket must not loop back into the VPN
          socket.soTimeout = 4000
          socket.send(DatagramPacket(q.dns, q.dns.size, server, 53))
          val buf = ByteArray(4096)
          val response = DatagramPacket(buf, buf.size)
          socket.receive(response)
          return buf.copyOf(response.length)
        }
      } catch (_: Exception) {
        // try the next server
      }
    }
    return null
  }

  private fun reply(q: DnsPackets.Query, dns: ByteArray) {
    val out = output ?: return
    val packet = DnsPackets.buildResponsePacket(q, dns)
    synchronized(out) { out.write(packet) }
  }

  private fun shutdown() {
    running = false
    reader?.interrupt()
    reader = null
    pool?.shutdownNow()
    pool = null
    try { tun?.close() } catch (_: Exception) {}
    tun = null
    output = null
  }

  /** The owner turned the VPN off in Android Settings, or another VPN app took over. */
  override fun onRevoke() {
    WebFilterPrefs(this).stopReason = "revoked"
    shutdown()
    stopSelf()
    super.onRevoke()
  }

  override fun onDestroy() {
    shutdown()
    super.onDestroy()
  }
}
