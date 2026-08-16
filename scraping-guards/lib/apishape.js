/* Guards 63-65: make the API itself hostile to ad-hoc clients.
 * The token gates gave a scraper a stable URL to hammer once it had a token.
 * These make the request SHAPE the credential. */
"use strict";
const crypto = require("crypto");

const SECRET = process.env.GUARD_SECRET || "scrape-guard-dev-secret";

/* --- Guard 63: persisted / allowlisted queries -------------------------
 * Only queries whose SHA-256 the server already knows are executable. An
 * attacker cannot craft `{ users { email } }` because arbitrary query text is
 * simply not accepted — this is how production GraphQL APIs shut down
 * exfiltration-by-query. */
const PERSISTED = new Map();
function registerQuery(text) {
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  PERSISTED.set(hash, text);
  return hash;
}
// The only two operations this API can ever run.
const Q_SUMMARY = registerQuery("query Summary { summary { title flag } }");
const Q_ITEMS = registerQuery("query Items { items { id name } }");

function runPersisted(hash, vars) {
  const text = PERSISTED.get(hash);
  if (!text) return { ok: false, reason: "unknown-query-hash" };
  if (hash === Q_SUMMARY) {
    return { ok: true, data: { summary: { title: "quarterly", flag: "FLAG-PERSISTEDQ-11ac" } } };
  }
  return { ok: true, data: { items: [{ id: 1, name: "alpha" }, { id: 2, name: "beta" }] } };
}

/* --- Guard 64: request-body signing ------------------------------------
 * Guard 30 signed a TOKEN; a scraper that stole it could send any body. Here
 * the signature covers method + path + timestamp + body hash, so a captured
 * request cannot be modified or replayed outside its window. */
const seenNonces = new Map(); // nonce -> expiry, for replay rejection

function signRequest({ method, path, body, timestamp, nonce }) {
  const bodyHash = crypto.createHash("sha256").update(body || "").digest("hex");
  const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
  return crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");
}

function verifyRequest({ method, path, body, timestamp, nonce, signature }, { windowMs = 30_000 } = {}) {
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "missing-signature-fields" };
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > windowMs) return { ok: false, reason: "timestamp-outside-window" };

  // Replay protection: a nonce is good exactly once.
  const now = Date.now();
  for (const [n, exp] of seenNonces) if (exp < now) seenNonces.delete(n);
  if (seenNonces.has(nonce)) return { ok: false, reason: "nonce-replayed" };

  const expected = signRequest({ method, path, body, timestamp, nonce });
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };

  seenNonces.set(nonce, now + windowMs);
  return { ok: true };
}

/* --- Guard 65: binary protocol with rotating field names ---------------
 * JSON with stable keys is trivially machine-readable. A compact binary
 * encoding whose field names are re-keyed per session means a scraper must
 * re-derive the schema every time instead of writing one parser forever. */
function fieldKeyFor(sessionSeed, logicalName) {
  return crypto.createHmac("sha256", sessionSeed).update(logicalName).digest("hex").slice(0, 6);
}

// Minimal TLV: [1B keyLen][key][2B valLen][value]
function encodeBinary(obj, sessionSeed) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = Buffer.from(fieldKeyFor(sessionSeed, k), "utf8");
    const val = Buffer.from(String(v), "utf8");
    const head = Buffer.alloc(3);
    head.writeUInt8(key.length, 0);
    head.writeUInt16BE(val.length, 1);
    parts.push(head, key, val);
  }
  return Buffer.concat(parts);
}

function decodeBinary(buf, sessionSeed, logicalNames) {
  const byKey = new Map(logicalNames.map((n) => [fieldKeyFor(sessionSeed, n), n]));
  const out = {};
  let off = 0;
  while (off + 3 <= buf.length) {
    const keyLen = buf.readUInt8(off);
    const valLen = buf.readUInt16BE(off + 1);
    const key = buf.slice(off + 3, off + 3 + keyLen).toString();
    const val = buf.slice(off + 3 + keyLen, off + 3 + keyLen + valLen).toString();
    out[byKey.get(key) || key] = val;
    off += 3 + keyLen + valLen;
  }
  return out;
}

module.exports = {
  runPersisted, registerQuery, Q_SUMMARY, Q_ITEMS, PERSISTED,
  signRequest, verifyRequest,
  encodeBinary, decodeBinary, fieldKeyFor,
};
