/* Guards 32 + 33: request-header validation.
 * Real browsers emit a predictable, ordered set of headers. HTTP libraries
 * (requests, axios, curl) omit most of them or send them in the wrong order. */
"use strict";

// Headers every modern browser sends on a top-level or fetch navigation.
const REQUIRED = ["accept", "accept-language", "accept-encoding", "user-agent"];
const SEC_FETCH = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"];

/* Header ORDER is a real fingerprint, but it is not one fixed list. Chrome
 * emits different orders for a navigation vs a fetch/XHR — measured:
 *
 *   navigation: host connection sec-ch-ua sec-ch-ua-mobile sec-ch-ua-platform
 *               upgrade-insecure-requests user-agent accept sec-fetch-site
 *               sec-fetch-mode sec-fetch-user sec-fetch-dest accept-encoding
 *               accept-language
 *   fetch/XHR:  host connection sec-ch-ua-platform user-agent sec-ch-ua
 *               sec-ch-ua-mobile accept sec-fetch-site sec-fetch-mode
 *               sec-fetch-dest referer accept-encoding accept-language
 *
 * The sec-ch-ua block and referer move; this core subset keeps the same
 * relative order in both, so it is what we validate. HTTP libraries get it
 * wrong (requests sends accept-encoding before accept, and no sec-fetch-* at all).
 */
const CHROME_ORDER = [
  "user-agent", "accept", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
  "accept-encoding", "accept-language",
];

/* Guard 32: presence + ordering + Client Hints. */
function inspectHeaders(req) {
  const h = req.headers;
  const signals = [];

  for (const name of REQUIRED) {
    if (!h[name]) signals.push(`missing:${name}`);
  }
  for (const name of SEC_FETCH) {
    if (!h[name]) signals.push(`missing:${name}`);
  }

  // Client Hints (Sec-CH-UA) — Chromium-only, and absent from every HTTP lib.
  if (/Chrome\/\d/.test(h["user-agent"] || "") && !h["sec-ch-ua"]) {
    signals.push("claims-chrome-without-sec-ch-ua");
  }

  // Ordering check over the headers we actually received.
  const present = (req.rawHeaders || [])
    .filter((_, i) => i % 2 === 0)
    .map((n) => n.toLowerCase())
    .filter((n) => CHROME_ORDER.includes(n));
  const expected = CHROME_ORDER.filter((n) => present.includes(n));
  if (present.join(",") !== expected.join(",")) signals.push("header-order-mismatch");

  // Dead giveaways in the UA itself.
  if (/python-requests|curl\/|Go-http-client|axios|Scrapy|libwww|Java\//i.test(h["user-agent"] || "")) {
    signals.push("http-library-user-agent");
  }

  return { bot: signals.length > 0, signals };
}

/* Guard 33: Referer / Origin validation for sub-resource requests. */
function checkReferer(req, { host }) {
  const ref = req.headers["referer"] || req.headers["origin"];
  if (!ref) return { ok: false, reason: "no-referer" };
  try {
    const u = new URL(ref);
    if (u.host !== host) return { ok: false, reason: `cross-origin:${u.host}` };
  } catch (_) {
    return { ok: false, reason: "malformed-referer" };
  }
  return { ok: true };
}

module.exports = { inspectHeaders, checkReferer, CHROME_ORDER };
