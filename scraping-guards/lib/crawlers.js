/* Guard 75: verified crawler allowlisting — forward-confirmed reverse DNS.
 *
 * Every other guard in this repo blocks or degrades. This one lets the RIGHT
 * bots through, and it is the piece whose absence hurts most in production:
 * turn the other 74 up and you silently destroy your own search ranking.
 *
 * A `Googlebot` User-Agent is trivially forged, so the UA string is worthless
 * on its own. The standard verification is forward-confirmed reverse DNS:
 *
 *   1. reverse-lookup the connecting IP        -> hostname
 *   2. hostname must end with the operator's domain
 *   3. forward-lookup that hostname            -> must contain the original IP
 *
 * Step 3 is the one people skip, and it is what makes the check sound: an
 * attacker who controls their own rDNS can answer step 1 with
 * "crawl-1-2-3-4.googlebot.com", but cannot make Google's DNS resolve that
 * name back to their address.
 *
 * Fails CLOSED: any DNS error means "not verified".
 */
"use strict";
const dns = require("dns").promises;

/* UA pattern -> the domains whose rDNS the operator publishes. */
const KNOWN_CRAWLERS = [
  { name: "Googlebot", ua: /Googlebot|Google-InspectionTool/i, suffixes: [".googlebot.com", ".google.com"] },
  { name: "Bingbot", ua: /bingbot|BingPreview/i, suffixes: [".search.msn.com"] },
  { name: "DuckDuckBot", ua: /DuckDuckBot/i, suffixes: [".duckduckgo.com"] },
  { name: "Applebot", ua: /Applebot/i, suffixes: [".applebot.apple.com"] },
  { name: "YandexBot", ua: /YandexBot/i, suffixes: [".yandex.ru", ".yandex.net", ".yandex.com"] },
  { name: "archive.org", ua: /ia_archiver|archive\.org_bot/i, suffixes: [".archive.org"] },
  // Test-only entry so CI exercises the real DNS path against a name that
  // always resolves. Never matches a real crawler UA.
  { name: "SGTestBot", ua: /SGTestBot/, suffixes: ["localhost"] },
];

function claimedCrawler(userAgent) {
  return KNOWN_CRAWLERS.find((c) => c.ua.test(userAgent || "")) || null;
}

async function verify(ip, userAgent, { simHostname } = {}) {
  const claim = claimedCrawler(userAgent);
  if (!claim) return { claimed: null, verified: false, reason: "no-crawler-claim" };

  // Step 1: reverse DNS (or the injected hostname, for tests).
  let hostname = simHostname;
  if (!hostname) {
    try {
      const names = await dns.reverse(ip);
      hostname = names[0];
    } catch (err) {
      return { claimed: claim.name, verified: false, reason: "reverse-lookup-failed", hostname: null };
    }
  }
  if (!hostname) return { claimed: claim.name, verified: false, reason: "no-ptr-record" };

  // Step 2: does the hostname belong to the operator?
  const suffixOk = claim.suffixes.some((s) => hostname === s || hostname.endsWith(s));
  if (!suffixOk) {
    return { claimed: claim.name, verified: false, reason: "hostname-not-owned-by-operator", hostname };
  }

  // Step 3: forward-confirm. Skipping this is the classic mistake.
  let addresses = [];
  try {
    addresses = (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  } catch (err) {
    return { claimed: claim.name, verified: false, reason: "forward-lookup-failed", hostname };
  }
  const normalise = (a) => String(a).replace(/^::ffff:/, "");
  if (!addresses.map(normalise).includes(normalise(ip))) {
    return { claimed: claim.name, verified: false, reason: "forward-confirm-mismatch", hostname, addresses };
  }

  return { claimed: claim.name, verified: true, reason: "forward-confirmed", hostname, addresses };
}

module.exports = { verify, claimedCrawler, KNOWN_CRAWLERS };
