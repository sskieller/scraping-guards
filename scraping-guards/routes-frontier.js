/* Routes for guards 47-71. Kept out of server.js to stop it becoming a monolith.
 * Returns true if the request was handled. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const risk = require("./lib/risk");
const labyrinth = require("./lib/labyrinth");
const apishape = require("./lib/apishape");
const accounts = require("./lib/accounts");
const pngtext = require("./lib/pngtext");

const ROOT = __dirname;

/* ---- shared state ---- */
const subresources = new Map(); // sid -> Set(asset)
const navPaths = new Map();     // sid -> [{path, t}]
const etagSeen = new Map();     // sid -> {served, conditional}
const cssFpSeen = new Map();    // sid -> Set(bucket)

const send = (res, status, body, type, extra) => {
  res.writeHead(status, Object.assign({ "Content-Type": type || "text/plain; charset=utf-8" }, extra || {}));
  res.end(body);
};
const json = (res, status, obj, extra) => send(res, status, JSON.stringify(obj, null, 2), "application/json; charset=utf-8", extra);
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const parseJson = (raw) => { try { return JSON.parse(raw); } catch (_) { return null; } };

const markAsset = (sid, asset) => {
  if (!sid) return;
  if (!subresources.has(sid)) subresources.set(sid, new Set());
  subresources.get(sid).add(asset);
};

/* Guard 48 helper: has this session fetched the subresources a browser would? */
function subresourceState(sid) {
  const seen = subresources.get(sid) || new Set();
  const required = ["css", "font", "beacon"];
  const missing = required.filter((r) => !seen.has(r));
  return { seen: [...seen], missing, complete: missing.length === 0 };
}

module.exports = async function frontierRoutes(req, res, ctx) {
  const { url, ip, identity } = ctx;
  const p = decodeURIComponent(url.pathname);
  const q = url.searchParams;

  /* ============ Guard 47: risk scoring + escalation ============ */
  if (p === "/api/risk/score" && req.method === "POST") {
    const body = parseJson(await readBody(req)) || {};
    return json(res, 200, risk.score(body.signals)), true;
  }

  if (p === "/api/risk/evaluate") {
    const sid = q.get("sid");
    const sub = sid ? subresourceState(sid) : { complete: true };
    const signals = risk.serverSignals(req, { ip, subresourcesSeen: sub.complete });
    // Let tests inject extra client-side signals.
    const extra = (q.get("signals") || "").split(",").filter(Boolean);
    return json(res, 200, Object.assign(risk.score([...signals, ...extra]), { observed: signals })), true;
  }

  // The escalation ladder actually applied to a resource.
  if (p === "/api/risk/gated") {
    const extra = (q.get("signals") || "").split(",").filter(Boolean);
    const verdict = risk.score([...risk.serverSignals(req, { ip }), ...extra]);
    switch (verdict.action) {
      case "allow":
        return json(res, 200, { action: "allow", score: verdict.score, flag: "FLAG-RISK-ALLOW-2b6d" }), true;
      case "challenge":
        return json(res, 401, { action: "challenge", score: verdict.score, flag: "FLAG-RISK-CHALLENGE",
          hint: "solve /api/pow/challenge or /api/captcha/new, then retry" }), true;
      case "tarpit":
        // Served, but slowly and with poisoned data — the scraper cannot tell.
        return new Promise((resolve) => setTimeout(() => {
          json(res, 200, { action: "tarpit", score: verdict.score, flag: "FLAG-RISK-TARPIT",
            records: labyrinth.poisonedRecords(identity, 3) });
          resolve(true);
        }, 400));
      default:
        return json(res, 403, { action: "block", score: verdict.score, flag: "FLAG-RISK-BLOCK",
          breakdown: verdict.breakdown }), true;
    }
  }

  /* ============ Guard 48: subresource verification ============ */
  if (p === "/assets/frontier.css") {
    const sid = q.get("sid");
    markAsset(sid, "css");
    // Guard 68: each media query pulls a DIFFERENT background image, so the
    // server learns the viewport/colour-scheme with no JS involved at all.
    // Each probe needs its OWN selector: a background-image that loses the
    // cascade is never fetched, so reusing one class would only ever report the
    // single winning bucket instead of every condition that matched.
    return send(res, 200,
      `.fp-base{background-image:url("/api/cssfp/base?sid=${sid}")}\n` +
      `@media (prefers-color-scheme: dark){.fp-dark{background-image:url("/api/cssfp/dark?sid=${sid}")}}\n` +
      `@media (min-width: 900px){.fp-wide{background-image:url("/api/cssfp/wide?sid=${sid}")}}\n` +
      `@media (pointer: coarse){.fp-touch{background-image:url("/api/cssfp/touch?sid=${sid}")}}\n` +
      `@font-face{font-family:"SGBeacon";src:url("/assets/beacon.woff2?sid=${sid}") format("woff2")}\n` +
      `.sg-beacon{font-family:"SGBeacon",monospace}\n`,
      "text/css; charset=utf-8"), true;
  }
  if (p === "/assets/beacon.woff2") {
    const sid = q.get("sid");
    markAsset(sid, "font");
    // Reuse the cipher font purely as a loadable font payload.
    try {
      return send(res, 200, fs.readFileSync(path.join(ROOT, "fonts", "cipher.woff2")), "font/woff2"), true;
    } catch (_) { return send(res, 404, "no font"), true; }
  }
  if (p === "/assets/beacon.png") {
    const sid = q.get("sid");
    markAsset(sid, "beacon");
    return send(res, 200, pngtext.beaconPng(), "image/png"), true;
  }
  if (p === "/api/subresource/verify") {
    const sid = q.get("sid") || "";
    const st = subresourceState(sid);
    return json(res, st.complete ? 200 : 403, Object.assign(st, {
      flag: st.complete ? "FLAG-SUBRESOURCE-7a15" : "FLAG-SUBRESOURCE-BOT",
      note: "A scraper that fetches only HTML never requests CSS, fonts or images.",
    })), true;
  }

  /* ============ Guards 55/56: sprite digits + pixel-only text ============ */
  if (p === "/assets/digits.png") {
    return send(res, 200, pngtext.digitSprite(4).png, "image/png"), true;
  }
  if (p === "/assets/pixels.png") {
    // The string exists ONLY as pixels — not in the DOM, not in the response text.
    return send(res, 200, pngtext.renderPng("FLAG-PIXELS-8D20", 4), "image/png"), true;
  }

  /* ============ Guard 50: script integrity manifest ============ */
  if (p === "/api/integrity") {
    try {
      return json(res, 200, JSON.parse(fs.readFileSync(path.join(ROOT, "integrity.json"), "utf8"))), true;
    } catch (_) {
      return json(res, 503, { error: "run: node tools/obfuscate.js" }), true;
    }
  }

  /* ============ Guard 52: labyrinth ============ */
  if (p.startsWith("/maze")) {
    const seed = p.slice("/maze/".length) || "root";
    const depth = Number(q.get("d") || 0);
    const page = labyrinth.mazePage(seed || "root", depth);
    // Deliberately slow: every maze page costs the crawler wall-clock too.
    return new Promise((resolve) => setTimeout(() => {
      send(res, 200, page.html, "text/html; charset=utf-8", { "X-Trap": "labyrinth" });
      resolve(true);
    }, 50));
  }

  /* ============ Guard 53: compression bomb ============ */
  if (p === "/api/bomb") {
    // Only ever served to a client already scored as a bot.
    const forced = req.headers["x-sim-bot"] === "true";
    const verdict = risk.score(risk.serverSignals(req, { ip }));
    if (!forced && verdict.action !== "block") {
      return json(res, 200, { served: "normal", score: verdict.score, note: "bomb is only served to blocked clients" }), true;
    }
    const bomb = labyrinth.compressionBomb(2);
    return send(res, 200, bomb.gzip, "text/html; charset=utf-8", {
      "Content-Encoding": "gzip",
      "X-Expanded-Bytes": String(bomb.expandedBytes),
      "X-Compression-Ratio": String(bomb.ratio),
      "X-Guard": "FLAG-BOMB-SERVED",
    }), true;
  }

  /* ============ Guard 54: content poisoning ============ */
  if (p === "/api/records") {
    const verdict = risk.score([...risk.serverSignals(req, { ip }), ...(q.get("signals") || "").split(",").filter(Boolean)]);
    if (verdict.action === "allow") {
      return json(res, 200, { poisoned: false, flag: "FLAG-RECORDS-REAL-5f81",
        records: [{ id: "REC-100001", name: "genuine-record", value: 42.5, quarter: "Q1" }] }), true;
    }
    // Plausible, deterministic, and completely false.
    return json(res, 200, { poisoned: false /* deliberately not advertised */,
      records: labyrinth.poisonedRecords(identity, 4) }), true;
  }

  /* ============ Guard 59: accounts, quota, device binding ============ */
  if (p === "/api/auth/login" && req.method === "POST") {
    const b = parseJson(await readBody(req)) || {};
    const r = accounts.login(b.username, b.password, b.device);
    return json(res, r.ok ? 200 : 401, r), true;
  }
  if (p === "/api/account/content") {
    const r = accounts.consume(req.headers["x-api-key"], req.headers["x-device"]);
    if (!r.ok) return json(res, r.status, r), true;
    return json(res, 200, Object.assign(r, { flag: "FLAG-ACCOUNT-3d0b" })), true;
  }

  /* ============ Guards 61/62: attestation + PAT (SIMULATED) ============ */
  if (p === "/api/attest" && req.method === "POST") {
    const b = parseJson(await readBody(req)) || {};
    const r = accounts.verifyAttestation(b.token, b.platform);
    return json(res, r.ok ? 200 : 403, Object.assign(r, { flag: r.ok ? "FLAG-ATTEST-ok" : "FLAG-ATTEST-BOT" })), true;
  }
  if (p === "/api/pat") {
    const r = accounts.verifyPrivateAccessToken(req.headers["authorization"]);
    return json(res, r.ok ? 200 : 401, Object.assign(r, { flag: r.ok ? "FLAG-PAT-ok" : "FLAG-PAT-BOT" })), true;
  }

  /* ============ Guard 63: persisted GraphQL queries ============ */
  if (p === "/api/graphql" && req.method === "POST") {
    const b = parseJson(await readBody(req)) || {};
    if (b.query) {
      // Arbitrary query text is never executed, whatever it says.
      return json(res, 403, { ok: false, reason: "ad-hoc-queries-disabled", flag: "FLAG-PERSISTEDQ-BOT" }), true;
    }
    const r = apishape.runPersisted(b.hash, b.variables);
    return json(res, r.ok ? 200 : 403, r), true;
  }
  if (p === "/api/graphql/hashes") {
    return json(res, 200, { summary: apishape.Q_SUMMARY, items: apishape.Q_ITEMS }), true;
  }

  /* ============ Guard 64: signed request bodies ============ */
  if (p === "/api/signed-request" && req.method === "POST") {
    const raw = await readBody(req);
    const r = apishape.verifyRequest({
      method: "POST", path: p, body: raw,
      timestamp: req.headers["x-timestamp"], nonce: req.headers["x-nonce"],
      signature: req.headers["x-signature"],
    });
    if (!r.ok) return json(res, 401, Object.assign(r, { flag: "FLAG-REQSIGN-BOT" })), true;
    return json(res, 200, { ok: true, flag: "FLAG-REQSIGN-c92e" }), true;
  }

  /* ============ Guard 65: binary protocol, rotating field names ============ */
  if (p === "/api/binary") {
    const seed = q.get("seed") || "default-seed";
    const buf = apishape.encodeBinary({ title: "quarterly", flag: "FLAG-BINPROTO-a4d6", count: 3 }, seed);
    return send(res, 200, buf, "application/octet-stream", { "X-Field-Seed": seed }), true;
  }

  /* ============ Guard 66: navigation-graph plausibility ============ */
  if (p === "/api/nav/visit") {
    const sid = q.get("sid") || "anon";
    const list = navPaths.get(sid) || [];
    list.push({ path: q.get("path") || "/", t: Date.now() });
    navPaths.set(sid, list);
    return json(res, 200, { recorded: list.length }), true;
  }
  if (p === "/api/nav/score") {
    const sid = q.get("sid") || "anon";
    const list = navPaths.get(sid) || [];
    const signals = [];
    if (list.length < 2) signals.push("single-page-session");
    const gaps = list.slice(1).map((v, i) => v.t - list[i].t);
    // Humans dwell; crawlers move on a metronome.
    if (gaps.length >= 2 && gaps.every((g) => g < 120)) signals.push("implausible-navigation");
    if (gaps.length >= 3 && new Set(gaps.map((g) => Math.round(g / 10))).size === 1) signals.push("implausible-navigation");
    const bot = signals.includes("implausible-navigation");
    return json(res, bot ? 403 : 200, {
      visits: list.length, gaps, signals,
      flag: bot ? "FLAG-NAVGRAPH-BOT" : "FLAG-NAVGRAPH-1c73",
    }), true;
  }

  /* ============ Guard 67: conditional-request behaviour ============ */
  if (p === "/api/etag-resource") {
    const sid = q.get("sid") || "anon";
    const etag = '"sg-etag-v1"';
    const rec = etagSeen.get(sid) || { served: 0, conditional: 0 };
    if (req.headers["if-none-match"] === etag) {
      rec.conditional++;
      etagSeen.set(sid, rec);
      return send(res, 304, "", null, { ETag: etag }), true;
    }
    rec.served++;
    etagSeen.set(sid, rec);
    return send(res, 200, "resource-body", "text/plain; charset=utf-8",
      { ETag: etag, "Cache-Control": "max-age=0, must-revalidate" }), true;
  }
  if (p === "/api/etag/verify") {
    const rec = etagSeen.get(q.get("sid") || "anon") || { served: 0, conditional: 0 };
    // A browser revalidates; a naive scraper re-downloads every time.
    const bot = rec.served > 1 && rec.conditional === 0;
    return json(res, bot ? 403 : 200, Object.assign(rec, {
      flag: bot ? "FLAG-ETAG-BOT" : "FLAG-ETAG-b508",
    })), true;
  }

  /* ============ Guard 68: no-JS CSS fingerprinting ============ */
  if (p.startsWith("/api/cssfp/")) {
    const bucket = p.slice("/api/cssfp/".length);
    const sid = q.get("sid") || "anon";
    if (bucket !== "report") {
      const set = cssFpSeen.get(sid) || new Set();
      set.add(bucket);
      cssFpSeen.set(sid, set);
      return send(res, 200, pngtext.beaconPng(), "image/png"), true;
    }
    const set = [...(cssFpSeen.get(q.get("sid") || "anon") || new Set())];
    return json(res, 200, {
      buckets: set,
      flag: set.length ? "FLAG-CSSFP-9e42" : "FLAG-CSSFP-NONE",
      note: "Derived with zero JavaScript — media queries alone reveal viewport, scheme and pointer type.",
    }), true;
  }

  /* ============ Guard 71: HTTP/3 QUIC fingerprint (SIMULATED) ============ */
  if (p === "/api/net/quic") {
    const forced = req.headers["x-sim-quic"];
    const isH3 = false; // this server speaks HTTP/1.1 only
    return json(res, forced === "bot" ? 403 : 200, {
      simulated: true,
      negotiated: `HTTP/${req.httpVersion}`,
      quicTransportParams: isH3 ? "initial_max_data,initial_max_streams_bidi,…" : "n/a",
      realRequirement: "QUIC transport parameters + Initial packet shape — needs an HTTP/3 terminator (nginx-quic, Caddy, Cloudflare)",
      bot: forced === "bot",
      flag: forced === "bot" ? "FLAG-QUICFP-BOT" : "FLAG-QUICFP-ok",
    }), true;
  }

  /* ============ Guard 70: AI / TDM declarative layer ============ */
  if (p === "/ai.txt" || p === "/llms.txt") {
    try {
      return send(res, 200, fs.readFileSync(path.join(ROOT, p.slice(1))), "text/plain; charset=utf-8",
        { "X-Robots-Tag": "noai, noimageai", "TDM-Reservation": "1" }), true;
    } catch (_) { return send(res, 404, "not found"), true; }
  }

  return false; // not ours
};

module.exports.state = { subresources, navPaths, etagSeen, cssFpSeen };
