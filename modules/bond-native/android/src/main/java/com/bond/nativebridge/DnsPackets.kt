package com.bond.nativebridge

/**
 * Tiny helpers to read and build the raw network packets that arrive on the
 * VPN interface.
 *
 * What is a DNS lookup? Before your phone opens "example.com" it asks a DNS
 * server "what is the IP address of example.com?". That question is a small
 * UDP packet sent to port 53. Our VPN catches ONLY these questions. If the
 * website is blocked we answer "that name doesn't exist", so the browser or
 * app can't connect. Otherwise we pass the question on to a real DNS server
 * and hand back its answer.
 *
 * Only IPv4 is handled because the VPN only gives Android an IPv4 DNS
 * server address, so Android only sends us IPv4 DNS packets.
 */
object DnsPackets {

  /** The parts of an incoming IPv4/UDP DNS query that we care about. */
  class Query(
    val srcIp: ByteArray,   // the phone's address (who asked)
    val dstIp: ByteArray,   // our fake DNS server address
    val srcPort: Int,
    val dstPort: Int,
    val dns: ByteArray,     // the DNS message itself
    val domain: String,     // e.g. "www.example.com"
    val questionEnd: Int,   // where the question section ends inside [dns]
  )

  private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xFF
  private fun u16(b: ByteArray, i: Int) = (u8(b, i) shl 8) or u8(b, i + 1)

  /** Returns null for anything that is not a normal IPv4 UDP DNS query. */
  fun parse(packet: ByteArray, length: Int): Query? {
    if (length < 20) return null
    val version = u8(packet, 0) shr 4
    if (version != 4) return null
    val ihl = (u8(packet, 0) and 0x0F) * 4
    if (u8(packet, 9) != 17) return null // 17 = UDP
    if (length < ihl + 8 + 12) return null
    val srcPort = u16(packet, ihl)
    val dstPort = u16(packet, ihl + 2)
    if (dstPort != 53) return null

    val dnsStart = ihl + 8
    val dns = packet.copyOfRange(dnsStart, length)
    // Must be a query (QR bit = 0) with at least one question
    if ((u8(dns, 2) and 0x80) != 0) return null
    if (u16(dns, 4) < 1) return null

    // Read the question name: a list of labels like [3]www[7]example[3]com[0]
    val name = StringBuilder()
    var i = 12
    while (true) {
      if (i >= dns.size) return null
      val len = u8(dns, i)
      if (len == 0) { i += 1; break }
      if (len and 0xC0 != 0) return null // compression isn't used in questions
      if (i + 1 + len > dns.size) return null
      if (name.isNotEmpty()) name.append('.')
      name.append(String(dns, i + 1, len, Charsets.US_ASCII))
      i += 1 + len
    }
    val questionEnd = i + 4 // QTYPE (2 bytes) + QCLASS (2 bytes)
    if (questionEnd > dns.size) return null

    return Query(
      srcIp = packet.copyOfRange(12, 16),
      dstIp = packet.copyOfRange(16, 20),
      srcPort = srcPort,
      dstPort = dstPort,
      dns = dns,
      domain = name.toString().lowercase().trimEnd('.'),
      questionEnd = questionEnd,
    )
  }

  /**
   * Build the "this name does not exist" (NXDOMAIN) answer for a blocked
   * query. We keep the original question and set the response flags.
   */
  fun blockedResponse(q: Query): ByteArray {
    val r = q.dns.copyOfRange(0, q.questionEnd)
    val rd = r[2].toInt() and 0x01               // keep "recursion desired"
    val opcode = r[2].toInt() and 0x78
    r[2] = (0x80 or opcode or rd).toByte()       // QR=1 (this is a response)
    r[3] = (0x80 or 3).toByte()                  // RA=1, RCODE=3 (NXDOMAIN)
    // 1 question, 0 answers, 0 authority, 0 additional
    r[4] = 0; r[5] = 1
    for (k in 6 until 12) r[k] = 0
    return r
  }

  /**
   * Wrap a DNS answer in IPv4 + UDP headers, addressed back to whoever asked.
   */
  fun buildResponsePacket(q: Query, dnsPayload: ByteArray): ByteArray {
    val udpLength = 8 + dnsPayload.size
    val total = 20 + udpLength
    val p = ByteArray(total)
    // --- IPv4 header ---
    p[0] = 0x45                       // version 4, header length 20 bytes
    p[1] = 0
    p[2] = (total shr 8).toByte(); p[3] = total.toByte()
    p[4] = 0; p[5] = 0                // identification
    p[6] = 0x40; p[7] = 0             // "don't fragment"
    p[8] = 64                         // time to live
    p[9] = 17                         // UDP
    System.arraycopy(q.dstIp, 0, p, 12, 4) // from: our fake DNS server
    System.arraycopy(q.srcIp, 0, p, 16, 4) // to: the phone
    val checksum = ipChecksum(p, 0, 20)
    p[10] = (checksum shr 8).toByte(); p[11] = checksum.toByte()
    // --- UDP header ---
    p[20] = (q.dstPort shr 8).toByte(); p[21] = q.dstPort.toByte()
    p[22] = (q.srcPort shr 8).toByte(); p[23] = q.srcPort.toByte()
    p[24] = (udpLength shr 8).toByte(); p[25] = udpLength.toByte()
    p[26] = 0; p[27] = 0              // UDP checksum is optional for IPv4
    System.arraycopy(dnsPayload, 0, p, 28, dnsPayload.size)
    return p
  }

  private fun ipChecksum(b: ByteArray, offset: Int, length: Int): Int {
    var sum = 0L
    var i = offset
    while (i < offset + length) {
      sum += u16(b, i)
      i += 2
    }
    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    return (sum.inv() and 0xFFFF).toInt()
  }
}
