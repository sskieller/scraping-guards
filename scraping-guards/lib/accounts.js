/* Guards 59-62: identity as the gate.
 *
 * In practice this is the single most effective anti-scraping control: content
 * behind an authenticated account with a per-account quota. It converts an
 * anonymous, parallelisable scrape into an attributable, rate-limited one that
 * costs the scraper real accounts.
 *
 * Guards 61-62 (platform attestation, Private Access Tokens) CANNOT be real
 * here — they need Google/Apple/Cloudflare as the attesting party — so they are
 * Tier-2-style stubs that declare themselves simulated.
 */
"use strict";
const crypto = require("crypto");

/* --- Guard 59: accounts, quota, device binding ------------------------- */
const USERS = new Map([
  ["demo", { password: "demo-password", plan: "free", dailyQuota: 5 }],
  ["pro", { password: "pro-password", plan: "pro", dailyQuota: 100 }],
]);
const apiKeys = new Map();  // key -> {user, used, device, issued}

function login(username, password, deviceFingerprint) {
  const u = USERS.get(username);
  if (!u || u.password !== password) return { ok: false, reason: "bad-credentials" };
  const key = crypto.randomBytes(16).toString("hex");
  apiKeys.set(key, {
    user: username, plan: u.plan, quota: u.dailyQuota, used: 0,
    // Device binding: the key is only valid from the fingerprint that minted it,
    // so a leaked/shared key cannot be fanned out across a scraping fleet.
    device: deviceFingerprint || null,
    issued: Date.now(),
  });
  return { ok: true, apiKey: key, plan: u.plan, quota: u.dailyQuota };
}

function consume(apiKey, deviceFingerprint) {
  const rec = apiKeys.get(apiKey);
  if (!rec) return { ok: false, reason: "unknown-api-key", status: 401 };
  if (rec.device && deviceFingerprint && rec.device !== deviceFingerprint) {
    return { ok: false, reason: "device-mismatch", status: 403 };
  }
  if (rec.used >= rec.quota) {
    return { ok: false, reason: "quota-exhausted", status: 429, used: rec.used, quota: rec.quota };
  }
  rec.used++;
  return { ok: true, used: rec.used, quota: rec.quota, remaining: rec.quota - rec.used };
}

function quotaFor(apiKey) {
  const rec = apiKeys.get(apiKey);
  return rec ? { used: rec.used, quota: rec.quota } : null;
}

/* --- Guard 61: mobile platform attestation (SIMULATED) -----------------
 * REAL implementation: Android sends a Play Integrity token, iOS an App Attest
 * assertion; your server verifies it against Google's / Apple's servers. There
 * is no way to genuinely produce or verify one without those platforms, so this
 * checks a fixed shape and declares itself simulated. */
function verifyAttestation(token, platform) {
  const shapeOk = typeof token === "string" && /^(play|appattest)\.[A-Za-z0-9_-]{8,}$/.test(token);
  return {
    simulated: true,
    platform: platform || "unknown",
    verdict: shapeOk ? "MEETS_DEVICE_INTEGRITY" : "FAILS_BASIC_INTEGRITY",
    ok: shapeOk,
    realRequirement: "Play Integrity API / Apple App Attest — server-to-server verification with the platform vendor",
  };
}

/* --- Guard 62: Private Access Tokens / Privacy Pass (SIMULATED) ---------
 * REAL implementation: the client presents a blind-signed token from an issuer
 * (Apple/Cloudflare) attesting "a real device on a real account", with no
 * identity attached. Requires being an integrated origin with an issuer
 * relationship. */
function verifyPrivateAccessToken(header) {
  const ok = typeof header === "string" && header.startsWith("PrivateToken token=");
  return {
    simulated: true,
    ok,
    scheme: "PrivateToken",
    realRequirement: "RFC 9577 Privacy Pass issuance — requires an issuer relationship (Apple/Cloudflare)",
  };
}

module.exports = { login, consume, quotaFor, verifyAttestation, verifyPrivateAccessToken, USERS, apiKeys };
