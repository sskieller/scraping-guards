/* Guard 30 + 27 + 41: signed expiring tokens, proof-of-work, canary watermarks.
 * All HMAC-based, no dependencies. */
"use strict";
const crypto = require("crypto");

// In a real deployment this comes from the environment / a KMS.
const SECRET = process.env.GUARD_SECRET || "scrape-guard-dev-secret";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => crypto.createHmac("sha256", SECRET).update(data).digest();

/* ---------- Guard 30: HMAC-signed, short-TTL tokens ---------- */
// Unlike a static header value, these cannot be lifted from source and replayed
// forever — they expire, and the signature can't be forged without the secret.
function issueToken(subject, ttlMs = 3000) {
  const payload = `${subject}.${Date.now() + ttlMs}`;
  return `${b64u(payload)}.${b64u(hmac(payload))}`;
}

function verifyToken(token, subject) {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const idx = token.lastIndexOf(".");
  const payloadB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch (_) {
    return { ok: false, reason: "malformed" };
  }
  const expected = b64u(hmac(payload));
  // Constant-time compare, guarding against length-mismatch throw.
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }
  const [sub, expStr] = payload.split(".");
  if (sub !== subject) return { ok: false, reason: "wrong-subject" };
  if (Date.now() > Number(expStr)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ---------- Guard 37: signed pagination cursors ---------- */
// The page number is inside a signed, expiring blob. A scraper cannot forge
// ?page=500 to skip ahead — it must walk the pages in order, in a live session.
function signCursor(page, ttlMs = 60_000) {
  const payload = `cursor|${page}|${Date.now() + ttlMs}`;
  return `${b64u(payload)}.${b64u(hmac(payload))}`;
}

function verifyCursor(token) {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const idx = token.lastIndexOf(".");
  let payload;
  try {
    payload = Buffer.from(token.slice(0, idx), "base64url").toString();
  } catch (_) {
    return { ok: false, reason: "malformed" };
  }
  const a = Buffer.from(token.slice(idx + 1));
  const b = Buffer.from(b64u(hmac(payload)));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  const [, pageStr, expStr] = payload.split("|");
  if (Date.now() > Number(expStr)) return { ok: false, reason: "expired" };
  return { ok: true, page: Number(pageStr) };
}

/* ---------- Guard 27: proof-of-work ---------- */
// The client must brute-force a nonce whose hash has `difficulty` leading zero
// hex chars. Cheap for one page view, expensive at scraping volume.
const powIssued = new Map(); // challenge -> {exp, difficulty}

function issueChallenge(difficulty = 4, ttlMs = 60_000) {
  const challenge = crypto.randomBytes(12).toString("hex");
  powIssued.set(challenge, { exp: Date.now() + ttlMs, difficulty });
  return { challenge, difficulty };
}

function verifyPow(challenge, nonce) {
  const rec = powIssued.get(challenge);
  if (!rec) return { ok: false, reason: "unknown-challenge" };
  if (Date.now() > rec.exp) { powIssued.delete(challenge); return { ok: false, reason: "expired" }; }
  const digest = crypto.createHash("sha256").update(`${challenge}:${nonce}`).digest("hex");
  if (!digest.startsWith("0".repeat(rec.difficulty))) return { ok: false, reason: "insufficient-work", digest };
  powIssued.delete(challenge); // single use — no replay
  return { ok: true, digest };
}

/* ---------- Guard 41: per-client canary tokens ---------- */
// Every response is watermarked with an identifier derived from the requester.
// If the content shows up elsewhere, the canary says exactly who leaked it.
function canaryFor(identity) {
  return "CANARY-" + hmac(`canary.${identity}`).toString("hex").slice(0, 12);
}

module.exports = {
  issueToken, verifyToken, signCursor, verifyCursor,
  issueChallenge, verifyPow, canaryFor,
};
