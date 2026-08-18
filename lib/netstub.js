/* ============================ TIER 2 STUBS ============================
 * Guards 42-46 live BELOW the HTTP body: TLS handshake bytes, HTTP/2 frames,
 * TCP/IP options, and IP reputation. A Node http server cannot authentically
 * observe any of them, so these are FIXTURES, not real detection.
 *
 * What each stub does:
 *   - Derives a deterministic pseudo-fingerprint from whatever weak signal IS
 *     reachable, so the endpoint behaves consistently in tests.
 *   - Lets a test force any verdict via a header (X-Sim-*), so CI can exercise
 *     both the allow and the block path.
 *   - Documents exactly what real infrastructure you'd need instead.
 *
 * DO NOT ship these as security controls. See docs/TIER3-COMMERCIAL.md.
 * ===================================================================== */
"use strict";
const crypto = require("crypto");

const shortHash = (s, n = 32) => crypto.createHash("md5").update(String(s)).digest("hex").slice(0, n);

/* --- Guard 42: TLS fingerprint (JA3/JA4) ------------------------------
 * REAL implementation needs the ClientHello: cipher suites, extensions,
 * elliptic curves, and their ORDER. Node's https server does not expose the
 * raw ClientHello; you need a TLS-terminating proxy (nginx+ssl_preread,
 * HAProxy, Envoy) or a library like `node-tls-fingerprint` / gopacket. */
const KNOWN_JA3 = {
  // Illustrative only — real JA3 hashes are environment-specific.
  "python-requests": { ja3: "e7d705a3286e19ea42f587b344ee6865", client: "python/urllib3", bot: true },
  "curl": { ja3: "456523fc94726331a4d5a2e1d40b2cd7", client: "curl", bot: true },
  "Go-http-client": { ja3: "b8b0e4e1d0c0a1e2f3a4b5c6d7e8f901", client: "go-stdlib", bot: true },
  "chrome": { ja3: "cd08e31494f9531f560d64c695473da9", client: "Chrome 120", bot: false },
};

function tlsFingerprint(req) {
  const forced = req.headers["x-sim-ja3"]; // test hook
  if (forced && KNOWN_JA3[forced]) return { ...KNOWN_JA3[forced], simulated: true, forced };

  const ua = req.headers["user-agent"] || "";
  for (const [key, val] of Object.entries(KNOWN_JA3)) {
    if (key !== "chrome" && ua.toLowerCase().includes(key.toLowerCase())) {
      return { ...val, simulated: true, inferredFrom: "user-agent" };
    }
  }
  // A real check compares the TLS fingerprint AGAINST the UA claim; a mismatch
  // (Chrome UA + python JA3) is the highest-signal bot tell there is.
  return { ja3: shortHash(ua), client: "unknown", bot: false, simulated: true, inferredFrom: "user-agent" };
}

/* --- Guard 43: HTTP/2 frame fingerprint (Akamai) ----------------------
 * REAL implementation reads SETTINGS frame values/order, WINDOW_UPDATE size,
 * PRIORITY tree, and pseudo-header order (:method :authority :scheme :path).
 * Needs an HTTP/2 server with frame-level hooks, or an edge proxy. */
function h2Fingerprint(req) {
  const forced = req.headers["x-sim-h2"];
  if (forced) return { akamaiFp: forced, bot: forced !== "browser", simulated: true, forced };
  const isH2 = req.httpVersionMajor === 2;
  return {
    akamaiFp: isH2 ? "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p" : "n/a (HTTP/1.1)",
    negotiated: `HTTP/${req.httpVersion}`,
    // Most scraping libs still speak HTTP/1.1 while claiming a modern browser UA.
    bot: !isH2 && /Chrome\/\d/.test(req.headers["user-agent"] || ""),
    simulated: true,
  };
}

/* --- Guard 44: TCP/IP stack (OS) fingerprint --------------------------
 * REAL implementation (p0f-style) needs raw packet capture: IP TTL, TCP window
 * size, MSS, and options order from the SYN. Requires libpcap/eBPF and root —
 * fundamentally out of reach for an application server. */
function osFingerprint(req) {
  const forced = req.headers["x-sim-os"];
  const claimed = /Windows/.test(req.headers["user-agent"] || "") ? "Windows"
    : /Mac OS X/.test(req.headers["user-agent"] || "") ? "macOS"
    : /Linux|X11/.test(req.headers["user-agent"] || "") ? "Linux" : "unknown";
  const observed = forced || "Linux"; // a container is always Linux on the wire
  return {
    observedStack: observed, ttl: 64, windowSize: 65535, mss: 1460,
    claimedByUA: claimed,
    // Claiming Windows from a Linux TCP stack = a datacenter scraper.
    bot: claimed !== "unknown" && claimed !== observed,
    simulated: true,
  };
}

/* --- Guard 45: IP reputation / ASN -----------------------------------
 * REAL implementation needs a maintained feed: MaxMind GeoIP2 / IP2Location
 * (ASN + usage type), Spur/IPQualityScore (VPN & proxy), and the Tor exit list. */
const SIM_RANGES = [
  { test: (ip) => /^(127\.|::1|::ffff:127\.)/.test(ip), type: "loopback", asn: "AS0", bot: false },
  { test: (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip), type: "private", asn: "AS0", bot: false },
];
function ipReputation(req, ip) {
  const forced = req.headers["x-sim-ip-type"];
  if (forced) {
    return { ip, usageType: forced, asn: "AS14061", org: "simulated",
             bot: ["datacenter", "vpn", "tor", "proxy"].includes(forced), simulated: true, forced };
  }
  for (const r of SIM_RANGES) {
    if (r.test(ip)) return { ip, usageType: r.type, asn: r.asn, org: "local", bot: r.bot, simulated: true };
  }
  return { ip, usageType: "unknown", asn: "AS?", org: "unknown", bot: false, simulated: true };
}

/* --- Guard 46: connection-level limits --------------------------------
 * This one is PARTLY real: we can count concurrent sockets. What we cannot do
 * is see TLS session resumption or per-connection request multiplexing, which
 * is what a real edge throttles on. */
class ConnectionLimiter {
  constructor(max = 6) { this.max = max; this.active = new Map(); }
  open(ip) {
    const n = (this.active.get(ip) || 0) + 1;
    this.active.set(ip, n);
    return { concurrent: n, exceeded: n > this.max };
  }
  close(ip) {
    const n = (this.active.get(ip) || 1) - 1;
    if (n <= 0) this.active.delete(ip); else this.active.set(ip, n);
  }
  peek(ip) { return this.active.get(ip) || 0; }
}

module.exports = { tlsFingerprint, h2Fingerprint, osFingerprint, ipReputation, ConnectionLimiter };
