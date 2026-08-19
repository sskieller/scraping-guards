/* Guard 83: sensor data — signals as an opaque, server-validated blob.
 *
 * Guard 36 posts behavioural telemetry as readable JSON. That is honest about
 * what it measures, and completely forgeable: anyone can hand-write a plausible
 * mouse path and post it.
 *
 * Every commercial system instead has the client collect signals into an
 * ENCRYPTED, single-use blob that the server decrypts and validates —
 * Akamai's `_abck`, PerimeterX's `_px`, Imperva's `reese84` (reportedly 180+
 * values), Kasada's kas.js payload, AWS WAF's `aws-waf-token`, F5's TS cookies.
 * The structural difference matters: the scraper cannot author the payload
 * without first reverse-engineering the collector, and the collector can be
 * re-obfuscated and rotated whenever it is broken.
 *
 * What is real here: AES-GCM encryption, a server-issued single-use nonce, a
 * freshness window, replay rejection, and consistency checks between the
 * blob's claims and what the server independently observes.
 *
 * What is NOT real, stated plainly: in production the collector would be
 * obfuscated and rotated (guard 50 is only packing), and the encryption key
 * would be derived inside it from baked-in constants. Ours is handed to the
 * client alongside the nonce — see `issueNonce` — because our collector is
 * readable either way and hiding the key in it would be theatre. This models
 * the *shape* of sensor data and its server-side validation, not the arms race
 * around hiding the collector.
 */
"use strict";
const crypto = require("crypto");

const SECRET = process.env.GUARD_SECRET || "scrape-guard-dev-secret";
const WINDOW_MS = 60_000;

const issued = new Map(); // nonce -> { exp, ip }
const consumed = new Set();

/* The key is derived from the server-issued nonce, so a blob captured from one
 * session cannot be replayed into another even before the nonce check. */
function keyFor(nonce) {
  return crypto.pbkdf2Sync(SECRET, "sensor:" + nonce, 20_000, 32, "sha256");
}

function issueNonce(ip) {
  const nonce = crypto.randomBytes(16).toString("hex");
  issued.set(nonce, { exp: Date.now() + WINDOW_MS, ip });
  return {
    nonce,
    algorithm: "AES-GCM",
    iterations: 20_000,
    expiresInMs: WINDOW_MS,
    // Handed over so the in-page collector can actually seal a blob. A real
    // system does NOT do this: the key is derived inside the obfuscated
    // collector from constants baked into the bundle. We do not pretend
    // otherwise, because our collector is readable (guard 50 is packing, not
    // obfuscation) and hiding the key in it would be theatre, not security.
    // What the guard still enforces regardless: the nonce is single-use, the
    // window is 60s, and the sealed claims must match what the server sees.
    key: keyFor(nonce).toString("hex"),
  };
}

/* Server-side: decrypt and validate. Mirrors what the client does in reverse. */
function verify(blob, { ip, userAgent } = {}) {
  // Replay is checked FIRST. A consumed nonce is removed from `issued`, so
  // checking that map first would report a replay as "unknown-nonce" — true in
  // a narrow sense, but it hides the more interesting fact from anyone reading
  // this fixture to learn the pattern.
  if (blob && consumed.has(blob.nonce)) return { ok: false, reason: "nonce-replayed" };
  const rec = issued.get(blob && blob.nonce);
  if (!rec) return { ok: false, reason: "unknown-nonce" };
  if (Date.now() > rec.exp) { issued.delete(blob.nonce); return { ok: false, reason: "nonce-expired" }; }

  let payload;
  try {
    const data = Buffer.from(blob.data, "base64");
    const iv = Buffer.from(blob.iv, "base64");
    const tag = data.subarray(data.length - 16);
    const body = data.subarray(0, data.length - 16);
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(blob.nonce), iv);
    d.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
  } catch (err) {
    // A hand-written or tampered blob dies here — the GCM tag will not verify.
    return { ok: false, reason: "decrypt-failed" };
  }

  consumed.add(blob.nonce);
  issued.delete(blob.nonce);

  const signals = [];

  // The blob must agree with what we can see for ourselves. A scraper that
  // forges a plausible payload still has to match its own request.
  if (payload.ua !== userAgent) signals.push("sensor-ua-mismatch");
  if (typeof payload.collectedAt !== "number" || Math.abs(Date.now() - payload.collectedAt) > WINDOW_MS) {
    signals.push("sensor-stale");
  }

  // Shape checks: a real collector always produces these.
  if (!Array.isArray(payload.signals) || payload.signals.length < 5) signals.push("sensor-too-few-signals");
  if (!payload.screen || !payload.screen.w || !payload.screen.h) signals.push("sensor-no-screen");
  if (payload.webdriver === true) signals.push("navigator.webdriver");
  if (payload.hardwareConcurrency === 0) signals.push("odd-hardware");

  return {
    ok: true,
    signals,
    trusted: signals.length === 0,
    signalCount: Array.isArray(payload.signals) ? payload.signals.length : 0,
  };
}

/* Exposed for the test suite: build a valid blob the way the client does. */
function seal(nonce, payload) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(nonce), iv);
  const body = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return {
    nonce,
    iv: iv.toString("base64"),
    data: Buffer.concat([body, c.getAuthTag()]).toString("base64"),
  };
}

function reset() { issued.clear(); consumed.clear(); }

module.exports = { issueNonce, verify, seal, reset, WINDOW_MS };
