/* Zero-dependency server for the scraping-guards test page.
 *
 * Implements every guard that needs HTTP: honeypots, token gates, proof-of-work,
 * CAPTCHA interstitial, sessions/CSRF, header validation, cursor pagination,
 * SSE + WebSocket transports, advanced rate limiting, canary watermarks, and
 * the Tier-2 network-layer STUBS (see lib/netstub.js).
 *
 *   node server.js [port]   # default 8080
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  issueToken, verifyToken, signCursor, verifyCursor,
  issueChallenge, verifyPow, canaryFor,
} = require("./lib/tokens");
const { SlidingWindow, TokenBucket, Tarpit } = require("./lib/ratelimit");
const { inspectHeaders, checkReferer } = require("./lib/headers");
const session = require("./lib/session");
const netstub = require("./lib/netstub");
const ws = require("./lib/websocket");

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/* ---------------------------------------------------------------- *
 * Shared state
 * ---------------------------------------------------------------- */
const RATE = { windowMs: 10_000, max: 5, hits: new Map() }; // guard 25 (fixed window)
const sliding = new SlidingWindow({ windowMs: 10_000, max: 5 });   // guard 40a
const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1 });  // guard 40b
const tarpit = new Tarpit({ freeHits: 3, stepMs: 200, maxMs: 2000 }); // guard 40c
const connLimiter = new netstub.ConnectionLimiter(6);              // guard 46
const captchaStore = new Map(); // id -> {answer, exp}
const captchaPasses = new Set(); // issued pass tokens

function fixedWindowLimited(ip) {
  const now = Date.now();
  const rec = RATE.hits.get(ip) || { count: 0, reset: now + RATE.windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + RATE.windowMs; }
  rec.count++;
  RATE.hits.set(ip, rec);
  return rec.count > RATE.max;
}

/* ---------------------------------------------------------------- *
 * Guard 29: AES-GCM payload, decrypted in-browser via crypto.subtle.
 * Key is derived from a passphrase with PBKDF2 — the ciphertext alone is
 * useless to a scraper that does not run the page's JS.
 * ---------------------------------------------------------------- */
const AES = { pass: "scrape-guard-passphrase", salt: "sg-salt-v1", iters: 100_000 };
function encryptPayload(plaintext) {
  const key = crypto.pbkdf2Sync(AES.pass, AES.salt, AES.iters, 32, "sha256");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  // WebCrypto expects the GCM tag appended to the ciphertext.
  return { iv: iv.toString("base64"), data: Buffer.concat([body, c.getAuthTag()]).toString("base64") };
}

/* ---------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------- */
function send(res, status, body, type, extraHeaders) {
  res.writeHead(status, Object.assign({ "Content-Type": type || "text/plain; charset=utf-8" }, extraHeaders || {}));
  res.end(body);
}
const json = (res, status, obj, extra) =>
  send(res, status, JSON.stringify(obj, null, 2), MIME[".json"], extra);

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}
function parseJson(raw) { try { return JSON.parse(raw); } catch (_) { return null; } }

/* Guard 31: per-request DOM randomization.
 * Every __RND<n>__ placeholder becomes a fresh random identifier on each
 * response, so any scraper pinned to a CSS class or id breaks immediately. */
function randomizeDom(html, identity) {
  const cache = new Map();
  return html
    .replace(/__RND(\d+)__/g, (_, n) => {
      if (!cache.has(n)) cache.set(n, "x" + crypto.randomBytes(5).toString("hex"));
      return cache.get(n);
    })
    .replace(/__CANARY__/g, canaryFor(identity)); // guard 41
}

/* ---------------------------------------------------------------- *
 * Router
 * ---------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = decodeURIComponent(url.pathname);
  const identity = `${ip}|${req.headers["user-agent"] || ""}`;

  /* ===================== ORIGINAL GUARDS (1-25) ===================== */

  // Guard 14: honeypot trap.
  if (p === "/trap") return send(res, 403, "BOT DETECTED (honeypot). FLAG-TRAP-DONOTFOLLOW\n");

  // Guard 22: static token gate.
  if (p === "/api/protected") {
    if (req.headers["x-scrape-token"] !== "issued-by-js-42") return send(res, 401, "missing/invalid X-Scrape-Token\n");
    return send(res, 200, "FLAG-APITOKEN-8b04");
  }

  // Guard 25: fixed-window rate limit.
  if (p === "/api/rated") {
    if (fixedWindowLimited(ip)) {
      return send(res, 429, "429 Too Many Requests (FLAG-RATELIMIT-429)\n", null, { "Retry-After": "10" });
    }
    return send(res, 200, "ok");
  }

  // Guard 15: honeypot form field.
  if (p === "/submit" && req.method === "POST") {
    const filled = new URLSearchParams(await readBody(req)).get("website");
    if (filled) return send(res, 400, "BOT DETECTED (honeypot field). FLAG-HPFIELD-BOT\n");
    return send(res, 200, "accepted");
  }

  /* ===================== TIER 1 GUARDS (26-41) ===================== */

  /* --- Guard 26: CAPTCHA interstitial --- */
  if (p === "/api/captcha/new") {
    const id = crypto.randomBytes(8).toString("hex");
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    captchaStore.set(id, { answer: a + b, exp: Date.now() + 120_000 });
    // Operands are sent as data only; the page renders them to a canvas, so
    // solving requires OCR + arithmetic rather than reading a JSON field.
    return json(res, 200, { id, a, b });
  }
  if (p === "/api/captcha/solve" && req.method === "POST") {
    const body = parseJson(await readBody(req)) || {};
    const rec = captchaStore.get(body.id);
    if (!rec || Date.now() > rec.exp) return json(res, 400, { ok: false, reason: "unknown-or-expired" });
    if (Number(body.answer) !== rec.answer) return json(res, 403, { ok: false, reason: "wrong-answer" });
    captchaStore.delete(body.id);
    const pass = crypto.randomBytes(16).toString("hex");
    captchaPasses.add(pass);
    return json(res, 200, { ok: true, pass }, { "Set-Cookie": `sg_captcha=${pass}; Path=/; SameSite=Strict; Max-Age=600` });
  }
  if (p === "/gated") {
    const pass = session.parseCookies(req).sg_captcha;
    if (!pass || !captchaPasses.has(pass)) {
      return send(res, 403,
        "<!doctype html><meta charset=utf-8><title>Checking your browser…</title>" +
        "<p>Checking your browser before you access this page.</p>" +
        "<p>Solve the challenge on <a href='/advanced.html'>advanced.html</a> first.</p>",
        MIME[".html"]);
    }
    return send(res, 200, "FLAG-CAPTCHA-3a91");
  }

  /* --- Guard 27: proof-of-work --- */
  if (p === "/api/pow/challenge") return json(res, 200, issueChallenge(4));
  if (p === "/api/pow/verify" && req.method === "POST") {
    const body = parseJson(await readBody(req)) || {};
    const v = verifyPow(body.challenge, body.nonce);
    if (!v.ok) return json(res, 403, { ok: false, reason: v.reason });
    return json(res, 200, { ok: true, flag: "FLAG-POW-7c25", digest: v.digest });
  }

  /* --- Guard 30: HMAC-signed, expiring token --- */
  if (p === "/api/token/issue") return json(res, 200, { token: issueToken("content", 3000), ttlMs: 3000 });
  if (p === "/api/token/content") {
    const v = verifyToken(url.searchParams.get("token") || req.headers["x-signed-token"], "content");
    if (!v.ok) return json(res, 401, { ok: false, reason: v.reason });
    return json(res, 200, { ok: true, flag: "FLAG-SIGNEDTOKEN-b4f8" });
  }

  /* --- Guard 29: AES-GCM encrypted payload --- */
  if (p === "/api/aes") return json(res, 200, encryptPayload("FLAG-AESGCM-e60a"));

  /* --- Guard 32: header presence / ordering / Client Hints --- */
  if (p === "/api/headers/check") {
    const r = inspectHeaders(req);
    return json(res, r.bot ? 403 : 200,
      r.bot ? { bot: true, signals: r.signals, flag: "FLAG-HEADERS-BOT" }
            : { bot: false, flag: "FLAG-HEADERS-c1d7" });
  }

  /* --- Guard 33: Referer / Origin validation --- */
  if (p === "/api/referer/check") {
    const r = checkReferer(req, { host: req.headers.host });
    if (!r.ok) return json(res, 403, { ok: false, reason: r.reason, flag: "FLAG-REFERER-BOT" });
    return json(res, 200, { ok: true, flag: "FLAG-REFERER-90ce" });
  }

  /* --- Guard 34: cookie session + CSRF double-submit --- */
  if (p === "/api/session/new") {
    const { sid, csrf } = session.createSession();
    return json(res, 200, { csrf }, { "Set-Cookie": session.cookieHeader(sid) });
  }
  if (p === "/api/session/content" && req.method === "POST") {
    const s = session.getSession(req);
    if (!s) return json(res, 401, { ok: false, reason: "no-session" });
    const c = session.checkCsrf(req, s);
    if (!c.ok) return json(res, 403, { ok: false, reason: c.reason });
    return json(res, 200, { ok: true, flag: "FLAG-SESSION-5d13", requests: s.seen });
  }

  /* --- Guard 35/36 telemetry: behavioral scoring --- */
  if (p === "/api/behavior/score" && req.method === "POST") {
    const b = parseJson(await readBody(req)) || {};
    const moves = Array.isArray(b.moves) ? b.moves : [];
    const signals = [];

    // Real pointer paths are jittery curves sampled at irregular intervals.
    if (moves.length < 5) signals.push("too-few-samples");
    if (moves.length >= 3) {
      const dts = moves.slice(1).map((m, i) => m.t - moves[i].t);
      const uniqueDts = new Set(dts.map((d) => Math.round(d)));
      if (uniqueDts.size <= 2 && dts.length > 3) signals.push("uniform-timing"); // scripted
      // Perfectly straight paths mean a synthetic A->B jump.
      const collinear = moves.slice(2).every((m, i) => {
        const [p0, p1] = [moves[i], moves[i + 1]];
        return Math.abs((p1.x - p0.x) * (m.y - p0.y) - (p1.y - p0.y) * (m.x - p0.x)) < 1e-6;
      });
      if (collinear) signals.push("perfectly-linear-path");
    }
    // Humans cannot fill a form in under ~400ms.
    if (typeof b.formMs === "number" && b.formMs < 400) signals.push("form-filled-too-fast");
    // Keystroke cadence: identical gaps = injected text.
    if (Array.isArray(b.keys) && b.keys.length > 3) {
      const gaps = b.keys.slice(1).map((t, i) => t - b.keys[i]);
      if (new Set(gaps.map((g) => Math.round(g))).size === 1) signals.push("uniform-keystrokes");
    }
    const bot = signals.length > 0;
    return json(res, 200, bot
      ? { bot: true, signals, flag: "FLAG-BEHAVIORADV-BOT" }
      : { bot: false, flag: "FLAG-BEHAVIORADV-8ef2" });
  }

  /* --- Guard 37: stateful cursor pagination --- */
  // Pages are reachable only by walking signed cursors in order; you cannot
  // jump to ?page=500 and you cannot forge a cursor.
  if (p === "/api/items") {
    const PAGES = 3;
    const cursor = url.searchParams.get("cursor");
    let page = 0;
    if (cursor) {
      const v = verifyCursor(cursor);
      if (!v.ok) return json(res, 403, { ok: false, reason: v.reason, flag: "FLAG-CURSOR-BOT" });
      page = v.page;
    }
    const body = { page, items: [`item-${page}-a`, `item-${page}-b`] };
    if (page + 1 < PAGES) body.nextCursor = signCursor(page + 1);
    if (page === PAGES - 1) body.flag = "FLAG-CURSOR-4b7d"; // only on the last page
    return json(res, 200, body);
  }

  /* --- Guard 38: Server-Sent Events transport --- */
  if (p === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ seq: 1, msg: "warmup" })}\n\n`);
    // The flag arrives only on a later event — a scraper must hold the stream open.
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ seq: 2, flag: "FLAG-SSE-2d90" })}\n\n`);
      res.end();
    }, 300);
    return;
  }

  /* --- Guard 40: advanced rate limiting --- */
  if (p === "/api/rate/sliding") {
    const r = sliding.check(ip);
    if (r.limited) return json(res, 429, { limited: true, count: r.count, flag: "FLAG-SLIDING-429" },
      { "Retry-After": String(r.retryAfter) });
    return json(res, 200, { limited: false, count: r.count });
  }
  if (p === "/api/rate/bucket") {
    const r = bucket.check(ip);
    if (r.limited) return json(res, 429, { limited: true, tokens: Number(r.tokens.toFixed(2)), flag: "FLAG-BUCKET-429" },
      { "Retry-After": String(r.retryAfter) });
    return json(res, 200, { limited: false, tokens: Number(r.tokens.toFixed(2)) });
  }
  if (p === "/api/rate/tarpit") {
    const { delayMs, hits } = tarpit.delayFor(ip);
    // No 429 — just an increasingly slow 200. Scrapers burn wall-clock instead
    // of learning a retry schedule.
    setTimeout(() => json(res, 200, { hits, delayMs, flag: delayMs > 0 ? "FLAG-TARPIT-SLOWED" : "FLAG-TARPIT-ok" }), delayMs);
    return;
  }
  if (p === "/api/rate/reset") { // test helper
    RATE.hits.clear(); sliding.log.clear(); bucket.buckets.clear(); tarpit.hits.clear();
    return json(res, 200, { ok: true });
  }

  /* --- Guard 41: canary watermark --- */
  if (p === "/api/canary") {
    return json(res, 200, { content: "quarterly figures", canary: canaryFor(identity), flag: "FLAG-CANARY-c3b8" });
  }

  /* ===================== TIER 2 STUBS (42-46) ===================== */
  if (p === "/api/net/tls") {
    const r = netstub.tlsFingerprint(req);
    return json(res, r.bot ? 403 : 200, Object.assign(r, { flag: r.bot ? "FLAG-JA3-BOT" : "FLAG-JA3-ok" }));
  }
  if (p === "/api/net/h2") {
    const r = netstub.h2Fingerprint(req);
    return json(res, r.bot ? 403 : 200, Object.assign(r, { flag: r.bot ? "FLAG-H2FP-BOT" : "FLAG-H2FP-ok" }));
  }
  if (p === "/api/net/os") {
    const r = netstub.osFingerprint(req);
    return json(res, r.bot ? 403 : 200, Object.assign(r, { flag: r.bot ? "FLAG-OSFP-BOT" : "FLAG-OSFP-ok" }));
  }
  if (p === "/api/net/ip") {
    const r = netstub.ipReputation(req, ip);
    return json(res, r.bot ? 403 : 200, Object.assign(r, { flag: r.bot ? "FLAG-IPREP-BOT" : "FLAG-IPREP-ok" }));
  }
  if (p === "/api/net/conn") {
    const n = connLimiter.peek(ip);
    const exceeded = n > connLimiter.max;
    return json(res, exceeded ? 429 : 200, {
      concurrent: n, max: connLimiter.max, exceeded, simulated: true,
      flag: exceeded ? "FLAG-CONNLIMIT-BOT" : "FLAG-CONNLIMIT-ok",
    });
  }

  /* ===================== STATIC FILES ===================== */
  const rel = p === "/" ? "/index.html" : p;
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "forbidden");

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "not found");
    const ext = path.extname(filePath);
    // advanced.html is templated per request (guards 31 + 41).
    if (ext === ".html" && /advanced\.html$/.test(filePath)) {
      return send(res, 200, randomizeDom(data.toString("utf8"), identity), MIME[".html"]);
    }
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
});

/* Guard 46 (partly real): count concurrent sockets per IP. */
server.on("connection", (socket) => {
  const ip = socket.remoteAddress || "unknown";
  connLimiter.open(ip);
  socket.on("close", () => connLimiter.close(ip));
});

/* Guard 39: WebSocket transport. */
ws.attach(server, {
  path: "/ws",
  onMessage: (text, reply) => {
    // Content is only released to a client that speaks the protocol correctly.
    if (text === "give-me-the-flag") reply(JSON.stringify({ flag: "FLAG-WEBSOCKET-f719" }));
    else reply(JSON.stringify({ error: "unknown-command", got: text }));
  },
});

server.listen(PORT, () => console.log(`scraping-guards server on http://localhost:${PORT}`));
