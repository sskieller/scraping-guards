/* Guards 81 + 82: the "charge them" and "scope them" halves of crawler policy.
 *
 * Everything else in this repo treats a crawler as something to stop. These two
 * treat it as something to *price* and *scope* — which is where the industry is
 * actually heading, because blocking AI crawlers outright costs you the
 * referral traffic and gets you nothing in exchange.
 */
"use strict";
const crypto = require("crypto");

const SECRET = process.env.GUARD_SECRET || "scrape-guard-dev-secret";

/* --- Guard 81: pay-per-crawl (HTTP 402) --------------------------------
 * A crawler asking for priced content gets 402 Payment Required plus the terms.
 * It pays out of band, receives a signed receipt, and presents that receipt to
 * get the content. This is the shape Cloudflare's pay-per-crawl uses, and 402
 * is the status code the HTTP spec reserved for exactly this and never used.
 *
 * The receipt is HMAC-signed and scoped to one path + crawler, so it cannot be
 * shared across crawlers or replayed against other content.
 */
const PRICING = {
  "/api/premium-content": { amount: "0.002", currency: "USD", unit: "per request" },
  "/api/archive": { amount: "0.010", currency: "USD", unit: "per request" },
};

function priceFor(path) {
  return PRICING[path] || null;
}

function issueReceipt(path, crawler, ttlMs = 300_000) {
  const payload = `${path}|${crawler}|${Date.now() + ttlMs}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

function verifyReceipt(receipt, path, crawler) {
  if (typeof receipt !== "string" || !receipt.includes(".")) return { ok: false, reason: "malformed-receipt" };
  const idx = receipt.lastIndexOf(".");
  let payload;
  try {
    payload = Buffer.from(receipt.slice(0, idx), "base64url").toString();
  } catch (_) {
    return { ok: false, reason: "malformed-receipt" };
  }
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(receipt.slice(idx + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-receipt-signature" };

  const [rPath, rCrawler, expStr] = payload.split("|");
  // Scoped: a receipt bought for one path by one crawler works nowhere else.
  if (rPath !== path) return { ok: false, reason: "receipt-wrong-path" };
  if (rCrawler !== crawler) return { ok: false, reason: "receipt-wrong-crawler" };
  if (Date.now() > Number(expStr)) return { ok: false, reason: "receipt-expired" };
  return { ok: true };
}

/* --- Guard 82: per-path crawler policy ---------------------------------
 * "Block all bots" is the wrong granularity. Documentation and marketing pages
 * usually WANT to be crawled; the monetised pages do not. Policy is keyed on
 * the VERIFIED crawler identity (guard 75), never on the UA string, because an
 * unverified UA is worthless.
 */
const POLICY = [
  { path: "/docs", crawlers: ["*"], allow: true, reason: "public documentation — crawling is wanted" },
  { path: "/marketing", crawlers: ["*"], allow: true, reason: "public marketing content" },
  { path: "/api/premium-content", crawlers: [], allow: false, reason: "monetised — see pay-per-crawl" },
  { path: "/archive", crawlers: ["Googlebot", "Bingbot", "archive.org"], allow: true, reason: "search + preservation only" },
  { path: "/internal", crawlers: [], allow: false, reason: "never crawlable" },
];

function policyFor(path, verifiedCrawler) {
  const rule = POLICY.find((r) => path === r.path || path.startsWith(r.path + "/"));
  if (!rule) return { allow: true, reason: "no-rule-default-allow", matched: null };
  if (!rule.allow) return { allow: false, reason: rule.reason, matched: rule.path };
  const allowed = rule.crawlers.includes("*") || (verifiedCrawler && rule.crawlers.includes(verifiedCrawler));
  return {
    allow: Boolean(allowed),
    reason: allowed ? rule.reason : `path allows only: ${rule.crawlers.join(", ")}`,
    matched: rule.path,
  };
}

module.exports = { priceFor, issueReceipt, verifyReceipt, policyFor, PRICING, POLICY };
