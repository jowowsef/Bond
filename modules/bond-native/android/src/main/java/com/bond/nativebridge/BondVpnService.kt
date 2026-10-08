package com.bond.nativebridge

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * WEBSITE PROTECTION — a local, on-device "VPN" that only filters DNS.
 *
 * Plain-language explanation:
 *  - Android lets an app create a VPN. Normally a VPN sends ALL traffic to a
 *    remote server. Ours does NOT. We tell Android: "use 10.111.222.1 as the
 *    DNS server, and only send traffic for that one address into the VPN".
 *  - So only DNS lookups ("what is the address of example.com?") come to us.
 *    Everything else (videos, messages...) goes straight to the internet
 *    as usual — faster, and nothing private passes through Bond.
 *  - For each lookup, DnsFilter decides: block it, or forward it to a real
 *    DNS server (Cloudflare) and pass the answer back.
 *
 * Android shows a key 🔑 icon in the status bar while this runs, and the
 * owner can always turn it off in Settings → Network → VPN. If they do,
 * Bond reports "Website protection paused" to the partner — honestly.
 *
 * Known limits (shown in the app too):
 *  - Apps/browsers that use their own encrypted DNS (e.g. Firefox "DNS over
 *    HTTPS", or Android "Private DNS" set to a specific provider) can skip
 *    this filter.
 *  - Only one VPN can be on at a time on Android.
 */
class BondVpnService : VpnService() {

  companion object {
    private const val TAG = "BondVpn"
    const val ACTION_START = "com.bond.nativebridge.START"
    const val ACTION_STOP = "com.bond.nativebridge.STOP"
    private const val VPN_ADDRESS = "10.111.222.2"
    private const val VPN_DNS = "10.111.222.1"

    /** The running service (same process), so we can reload rules directly. */
    @Volatile
    var instance: BondVpnService? = null
      private set

    val isRunning: Boolean get() = instance?.tun != null

    fun start(context: Context) {
      val intent = Intent(context, BondVpnService::class.java).setAction(ACTION_START)
      context.startService(intent)
    }

    fun stop(context: Context) {
      instance?.shutdown()
      try {
        context.startService(Intent(context, BondVpnService::class.java).setAction(ACTION_STOP))
      } catch (_: Exception) {
        // App in background and service already gone — nothing to stop.
      }
    }
  }

  @Volatile private var tun: ParcelFileDescriptor? = null
  @Volatile private var filter: DnsFilter? = null
  private var readerThread: Thread? = null
  private var forwarders: ExecutorService? = null
  private var output: FileOutputStream? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    // ACTION_START, or Android restarting us after the process was killed
    // (intent == null). Only run if there is still something to protect.
    if (!ControlsStore(this).needsVpn) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    reloadRules()
    if (tun == null) establish()
    return START_STICKY
  }

  /** Re-read the approved controls (called after every sync). */
  fun reloadRules() {
    filter = DnsFilter.fromStore(this)
    // Download/refresh category lists in the background, then reload again.
    Thread {
      val categories = ControlsStore(this).webCategories
      if (Blocklists.refreshIfNeeded(this, categories)) {
        filter = DnsFilter.fromStore(this)
      }
    }.start()
  }

  private fun establish() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val configure = launchIntent?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = Builder()
      .setSession("Bond website protection")
      .addAddress(VPN_ADDRESS, 32)
      .addDnsServer(VPN_DNS)
      .addRoute(VPN_DNS, 32)   // ONLY DNS traffic enters the VPN
      .setBlocking(true)
    // Bond's own traffic (Supabase sync, list downloads) bypasses the filter.
    try { builder.addDisallowedApplication(packageName) } catch (_: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
    configure?.let { builder.setConfigureIntent(it) }

    val iface = try { builder.establish() } catch (e: Exception) {
      Log.e(TAG, "Could not start VPN: ${e.message}"); null
    }
    if (iface == null) {
      // VPN permission not granted (or revoked). Nothing we can do here —
      // the app shows "Website protection needs permission".
      stopSelf()
      return
    }
    tun = iface
    output = FileOutputStream(iface.fileDescriptor)
    forwarders = Executors.newFixedThreadPool(4)
    readerThread = Thread({ readLoop(iface) }, "BondVpnReader").also { it.start() }
    Log.i(TAG, "Website protection started")
  }

  /** Reads packets from the VPN until it is closed. */
  private fun readLoop(iface: ParcelFileDescriptor) {
    val input = FileInputStream(iface.fileDescriptor)
    val buffer = ByteArray(32767)
    try {
      while (!Thread.currentThread().isInterrupted) {
        val length = input.read(buffer)
        if (length <= 0) continue
        val query = DnsPackets.parse(buffer, length) ?: continue
        forwarders?.execute { handle(query) }
      }
    } catch (e: Exception) {
      // Normal when the VPN is closed.
    }
  }

  private fun handle(q: DnsPackets.Query) {
    val f = filter ?: return
    try {
      // App internet restriction: refuse ALL lookups made by those apps.
      if (f.internetBlockedApps.isNotEmpty() && isFromInternetBlockedApp(q, f.internetBlockedApps)) {
        reply(q, DnsPackets.blockedResponse(q))
        return
      }
      when (f.check(q.domain)) {
        DnsFilter.Verdict.BLOCK -> reply(q, DnsPackets.blockedResponse(q))
        DnsFilter.Verdict.ALLOW_PLAIN -> forward(q, f.plainUpstreams)?.let { reply(q, it) }
        DnsFilter.Verdict.FORWARD_FILTERED -> forward(q, f.upstreams)?.let { reply(q, it) }
      }
    } catch (e: Exception) {
      Log.w(TAG, "DNS handling failed: ${e.message}")
    }
  }

  /**
   * Which app sent this lookup? Android 10+ lets the VPN app ask
   * (getConnectionOwnerUid). On older Android we can't tell, so the app
   * internet restriction is not applied there (the UI says so).
   */
  private fun isFromInternetBlockedApp(q: DnsPackets.Query, blockedApps: Set<String>): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    return try {
      val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val uid = cm.getConnectionOwnerUid(
        OsConstants.IPPROTO_UDP,
        InetSocketAddress(InetAddress.getByAddress(q.srcIp), q.srcPort),
        InetSocketAddress(InetAddress.getByAddress(q.dstIp), q.dstPort),
      )
      if (uid < 0) return false
      val packages = packageManager.getPackagesForUid(uid) ?: return false
      packages.any { it in blockedApps }
    } catch (_: Exception) {
      false
    }
  }

  /** Send the lookup to a real DNS server and wait for the answer. */
  private fun forward(q: DnsPackets.Query, servers: List<InetAddress>): ByteArray? {
    for (server in servers) {
      try {
        DatagramSocket().use { socket ->
          protect(socket) // make sure this socket itself doesn't loop into the VPN
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
    val packet = DnsPackets.buildResponsePacket(q, dns)
    val out = output ?: return
    synchronized(out) { out.write(packet) }
  }

  fun shutdown() {
    readerThread?.interrupt()
    readerThread = null
    forwarders?.shutdownNow()
    forwarders = null
    try { tun?.close() } catch (_: Exception) {}
    tun = null
    output = null
  }

  /** Called when the owner turns the VPN off in Android Settings, or another VPN starts. */
  override fun onRevoke() {
    Log.i(TAG, "Website protection was turned off from Android settings")
    shutdown()
    stopSelf()
    super.onRevoke()
  }

  override fun onDestroy() {
    shutdown()
    if (instance === this) instance = null
    super.onDestroy()
  }
}
