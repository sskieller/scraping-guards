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
const crawlers = require("./lib/crawlers");
const enumeration = require("./lib/enumeration");
const watermark = require("./lib/watermark");
const crawlpolicy = require("./lib/crawlpolicy");
const recipeData = require("./lib/recipe-data");
const recipePage = require("./lib/recipe-page");
const recipeimg = require("./lib/recipeimg");
const tokens = require("./lib/tokens");

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
    // Guard 75 first: an allowlisted crawler skips the ladder. Without this,
    // turning the other guards up quietly blocks Googlebot.
    const crawler = await crawlers.verify(ip, req.headers["user-agent"], {
      simHostname: req.headers["x-sim-rdns"],
    });
    if (crawler.verified) {
      return json(res, 200, { action: "allow", allowlisted: crawler.claimed,
        reason: "forward-confirmed-crawler", flag: "FLAG-RISK-ALLOWLIST-7e02" }), true;
    }
    const verdict = risk.score([...risk.serverSignals(req, { ip }), ...extra]);
    switch (verdict.action) {
      case "allow":
        return json(res, 200, { action: "allow", score: verdict.score, flag: "FLAG-RISK-ALLOW-2b6d" }), true;
      case "monitor":
        // Greylist: the client sees an ordinary response and learns nothing.
        // Only our sampling changes, which is the whole point of the rung.
        return json(res, 200, { action: "monitor", score: verdict.score,
          flag: "FLAG-RISK-MONITOR-5a83", greylisted: true }), true;
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

  /* ============ Recipe fixture: a semi-real scraping target ============ */
  if (p === "/recipes") {
    return send(res, 200, recipePage.renderIndex({
      page: Number(q.get("page") || 1),
      category: q.get("category"),
      canary: tokens.canaryFor(identity),
      baseUrl: `http://${req.headers.host || "localhost"}`,
    }), "text/html; charset=utf-8"), true;
  }
  if (p === "/recipe" || p === "/recipe.html" || p.startsWith("/recipe/")) {
    // Bare /recipe keeps working as an alias for the first recipe.
    const slug = p.startsWith("/recipe/") ? p.slice("/recipe/".length) : recipeData.RECIPE.slug;
    const recipe = recipeData.bySlug(slug);
    if (!recipe) {
      return send(res, 404,
        `<!doctype html><meta charset=utf-8><title>Not found</title>` +
        `<h1>No such recipe</h1><p><a href="/recipes">Back to all recipes</a></p>`,
        "text/html; charset=utf-8"), true;
    }
    return send(res, 200, recipePage.render(recipe, {
      sid: crypto.randomBytes(8).toString("hex"),
      canary: tokens.canaryFor(identity),
      account: (req.headers["x-api-key"] || "anonymous"),
      baseUrl: `http://${req.headers.host || "localhost"}`,
    }), "text/html; charset=utf-8"), true;
  }
  if (p === "/sitemap.xml") {
    return send(res, 200, recipePage.sitemap(`http://${req.headers.host || "localhost"}`),
      "application/xml; charset=utf-8"), true;
  }
  if (p === "/assets/recipe.css") {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "assets", "recipe.css")), "text/css; charset=utf-8"), true;
  }
  if (p === "/assets/recipe.js") {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "assets", "recipe.js")), "text/javascript; charset=utf-8"), true;
  }
  if (p === "/assets/recipe/hero.svg") {
    // Seeded per recipe and drawn per category, so each card looks like the
    // distinct page it links to rather than twelve copies of the same bun.
    const forRecipe = recipeData.bySlug(q.get("r") || "");
    return send(res, 200, recipeimg.hero({
      seed: q.get("r") || "hero",
      category: forRecipe ? forRecipe.category : "Baking",
    }), "image/svg+xml; charset=utf-8"), true;
  }
  if (p === "/assets/recipe/knot.svg") {
    return send(res, 200, recipeimg.knotDiagram(), "image/svg+xml; charset=utf-8"), true;
  }
  // The catalogue as JSON, and the page-by-page feed the index lazy-loads.
  if (p === "/api/recipes") {
    const perPage = recipePage.PER_PAGE;
    const all = recipeData.catalogue();
    const pageNum = Number(q.get("page") || 0);
    if (!pageNum) return json(res, 200, { total: all.length, recipes: all }), true;
    const pages = Math.max(1, Math.ceil(all.length / perPage));
    return json(res, 200, {
      page: pageNum, pages, total: all.length,
      recipes: all.slice((pageNum - 1) * perPage, pageNum * perPage),
      nextPage: pageNum < pages ? pageNum + 1 : null,
    }), true;
  }
  if (p === "/api/recipe") {
    const recipe = recipeData.bySlug(q.get("slug") || recipeData.RECIPE.slug);
    if (!recipe) return json(res, 404, { error: "unknown-slug" }), true;
    const target = Number(q.get("yield") || recipe.yieldBase);
    if (!Number.isFinite(target) || target < 1 || target > 500) {
      return json(res, 400, { error: "yield must be between 1 and 500" }), true;
    }
    return json(res, 200, {
      ...recipe, requestedYield: target,
      ingredientGroups: recipeData.scaled(target, recipe),
    }), true;
  }
  // Guard 6 backing endpoint: the steps the page loads on scroll.
  if (p === "/api/recipe/steps") {
    const recipe = recipeData.bySlug(q.get("slug") || recipeData.RECIPE.slug);
    if (!recipe) return json(res, 404, { error: "unknown-slug" }), true;
    const from = Number(q.get("from") || 1);
    return json(res, 200, { steps: recipe.steps.filter((s) => s.n >= from) }), true;
  }
  if (p === "/api/recipe/nutrition") {
    const recipe = recipeData.bySlug(q.get("slug") || recipeData.RECIPE.slug);
    if (!recipe) return json(res, 404, { error: "unknown-slug" }), true;
    return json(res, 200, recipe.nutrition), true;
  }

  /* ============ Guard 79: degradation response modes ============ */
  // Beyond 403. A plain refusal tells the scraper exactly what to fix; these
  // cost far more debugging time, and `hangup` is genuinely hard to tell apart
  // from ordinary network trouble.
  if (p === "/api/degrade") {
    const mode = q.get("mode") || "block";
    const spec = risk.RESPONSE_MODES[mode];
    if (!spec) return json(res, 400, { error: "unknown-mode", modes: Object.keys(risk.RESPONSE_MODES) }), true;
    switch (mode) {
      case "redirect":
        return send(res, 302, "", null, { Location: "/", "X-Guard": "FLAG-DEGRADE-REDIRECT" }), true;
      case "empty":
        // 200 with a structurally valid but empty payload — a scraper needs
        // manual testing to notice it is being fed nothing.
        return json(res, 200, { results: [], total: 0, page: 1 }), true;
      case "hangup":
        // No response at all. Cheapest possible defense.
        req.socket.destroy();
        return true;
      case "slow":
        return new Promise((resolve) => setTimeout(() => {
          json(res, 200, { results: [], slowed: true, flag: "FLAG-DEGRADE-SLOW" });
          resolve(true);
        }, 400));
      case "poison":
        return json(res, 200, { records: labyrinth.poisonedRecords(identity, 3) }), true;
      default:
        return json(res, 403, { error: "Access denied", flag: "FLAG-DEGRADE-BLOCK" }), true;
    }
  }
  if (p === "/api/degrade/modes") {
    return json(res, 200, { modes: risk.RESPONSE_MODES, ladder: risk.LADDER }), true;
  }

  /* ============ Guard 80: API honeypot (poisoned JSON field) ============ */
  // The HTML honeypots (14/15) only catch crawlers that parse pages. This one
  // catches API clients: a decoy field no legitimate consumer has any reason to
  // dereference, because it is not in any published schema.
  if (p === "/api/listing") {
    return json(res, 200, {
      items: [{ id: 1, title: "alpha" }, { id: 2, title: "beta" }],
      // Documented nowhere. Only a client that walks every field finds it.
      _internal_export: "/api/internal/bulk-export?token=decoy",
    }), true;
  }
  if (p === "/api/internal/bulk-export") {
    risk.recordOutcome(risk.serverSignals(req, { ip }), true); // ground truth, like guard 14
    return json(res, 403, {
      error: "Access denied",
      flag: "FLAG-APIHONEYPOT-BOT",
      note: "This path is referenced only by an undocumented decoy field. No legitimate client reaches it.",
    }), true;
  }

  /* ============ Guard 81: pay-per-crawl (HTTP 402) ============ */
  if (p === "/api/premium-content" || p === "/api/archive") {
    const price = crawlpolicy.priceFor(p);
    const crawler = (await crawlers.verify(ip, req.headers["user-agent"], {
      simHostname: req.headers["x-sim-rdns"],
    })).claimed || "anonymous";
    const receipt = req.headers["x-crawler-receipt"];
    if (receipt) {
      const v = crawlpolicy.verifyReceipt(receipt, p, crawler);
      if (!v.ok) return json(res, 402, Object.assign(v, { flag: "FLAG-PAYCRAWL-INVALID", price })), true;
      return json(res, 200, { content: "premium article body", flag: "FLAG-PAYCRAWL-PAID-1c4e" }), true;
    }
    // 402 is the status HTTP reserved for exactly this and never used.
    return json(res, 402, {
      error: "Payment Required",
      price, crawler,
      purchase: `/api/crawl-receipt?path=${encodeURIComponent(p)}`,
      flag: "FLAG-PAYCRAWL-402",
      note: "Charging crawlers is the alternative to blocking them: you keep the content and get paid for the access.",
    }), true;
  }
  if (p === "/api/crawl-receipt") {
    // Stands in for the out-of-band payment step.
    const target = q.get("path") || "/api/premium-content";
    const crawler = (await crawlers.verify(ip, req.headers["user-agent"], {
      simHostname: req.headers["x-sim-rdns"],
    })).claimed || "anonymous";
    return json(res, 200, { receipt: crawlpolicy.issueReceipt(target, crawler), path: target, crawler }), true;
  }

  /* ============ Guard 82: per-path crawler policy ============ */
  if (p === "/api/policy") {
    const target = q.get("path") || "/docs";
    const v = await crawlers.verify(ip, req.headers["user-agent"], { simHostname: req.headers["x-sim-rdns"] });
    // Policy keys on the VERIFIED identity — an unverified UA is worthless.
    const decision = crawlpolicy.policyFor(target, v.verified ? v.claimed : null);
    return json(res, decision.allow ? 200 : 403, Object.assign(decision, {
      path: target,
      verifiedAs: v.verified ? v.claimed : null,
      flag: decision.allow ? "FLAG-CRAWLPOLICY-ALLOW-3f21" : "FLAG-CRAWLPOLICY-DENY",
    })), true;
  }

  /* ============ Guard 75: verified crawler allowlisting ============ */
  if (p === "/api/crawler/verify") {
    const r = await crawlers.verify(ip, req.headers["user-agent"], {
      simHostname: req.headers["x-sim-rdns"], // test hook for the rDNS step
    });
    if (!r.claimed) return json(res, 200, Object.assign(r, { flag: "FLAG-CRAWLER-NOCLAIM" })), true;
    return json(res, r.verified ? 200 : 403, Object.assign(r, {
      flag: r.verified ? "FLAG-VERIFIEDBOT-9d14" : "FLAG-CRAWLER-SPOOFED",
      note: r.verified
        ? "Allowlisted: bypasses the risk ladder entirely."
        : "UA claims a crawler the DNS does not back up.",
    })), true;
  }

  /* ============ Guard 76: adaptive weights ============ */
  if (p === "/api/risk/feedback" && req.method === "POST") {
    const b = parseJson(await readBody(req)) || {};
    risk.recordOutcome(b.signals, Boolean(b.confirmedBot));
    return json(res, 200, { recorded: (b.signals || []).length, confirmedBot: Boolean(b.confirmedBot) }), true;
  }
  if (p === "/api/risk/weights") {
    return json(res, 200, {
      minObservations: risk.MIN_OBSERVATIONS, clamp: risk.CLAMP, weights: risk.weightTable(),
    }), true;
  }
  if (p === "/api/risk/adaptive") {
    const extra = (q.get("signals") || "").split(",").filter(Boolean);
    return json(res, 200, risk.adaptiveScore([...risk.serverSignals(req, { ip }), ...extra])), true;
  }
  if (p === "/api/risk/reset-learning") {
    risk.resetLearning();
    return json(res, 200, { ok: true }), true;
  }

  /* ============ Guard 77: enumeration detection ============ */
  if (p === "/api/item") {
    const sid = q.get("sid") || "anon";
    enumeration.record(sid, q.get("id") || "0");
    return json(res, 200, { id: q.get("id"), name: `item-${q.get("id")}` }), true;
  }
  if (p === "/api/enumeration/score") {
    const r = enumeration.analyse(q.get("sid") || "anon", { keyspaceSize: Number(q.get("keyspace") || 1000) });
    return json(res, r.enumerating ? 403 : 200, Object.assign(r, {
      flag: r.enumerating ? "FLAG-ENUMERATION-BOT" : "FLAG-ENUMERATION-8c31",
      note: "Shape of what was requested, not the timing — survives perfect jitter and proxy rotation.",
    })), true;
  }
  if (p === "/api/enumeration/reset") {
    enumeration.reset(q.get("sid"));
    return json(res, 200, { ok: true }), true;
  }

  /* ============ Guard 78: steganographic text watermarking ============ */
  const ARTICLE =
    "Quarterly revenue rose across every regional segment this period. " +
    "Margin expansion outpaced the forecast, and inventory turned faster than in prior quarters.";
  if (p === "/api/article") {
    const account = req.headers["x-api-key"] || q.get("key") || "anonymous";
    const marked = watermark.embed(ARTICLE, "acct:" + account.slice(0, 12));
    return json(res, 200, {
      text: marked,
      flag: "FLAG-WATERMARK-4b90",
      note: "The visible text is unchanged; the recipient id rides in zero-width characters.",
    }), true;
  }
  if (p === "/api/watermark/extract" && req.method === "POST") {
    const body = parseJson(await readBody(req)) || {};
    const found = watermark.extract(body.text || "");
    return json(res, found ? 200 : 404, {
      recipient: found,
      visibleText: watermark.strip(body.text || ""),
      flag: found ? "FLAG-WATERMARK-TRACED" : "FLAG-WATERMARK-NONE",
    }), true;
  }

  /* ============ Guard 72: subtle perturbation ============ */
  // The catalogue a competitor would actually want to scrape.
  const CATALOGUE = [
    { sku: "A-100", name: "widget-standard", price: 249.0, stockLevel: 120, inStock: true },
    { sku: "A-220", name: "widget-pro", price: 899.5, stockLevel: 14, inStock: true },
    { sku: "B-040", name: "gasket-set", price: 39.95, stockLevel: 0, inStock: false },
  ];
  if (p === "/api/prices") {
    const extra = (q.get("signals") || "").split(",").filter(Boolean);
    const verdict = risk.score([...risk.serverSignals(req, { ip }), ...extra]);
    if (verdict.action === "allow") {
      return json(res, 200, { records: CATALOGUE, flag: "FLAG-PRICES-REAL-c40f" }), true;
    }
    // Same shape, same magnitudes, quietly wrong — and no marker to notice.
    return json(res, 200, { records: labyrinth.perturbRecords(CATALOGUE, identity) }), true;
  }

  /* ============ Guard 73: per-character rendering ============ */
  // Facebook's approach: every CHARACTER is its own drawn element, and the DOM
  // order is shuffled. Even an OCR pass over individual elements yields the
  // characters out of order unless CSS `order` is applied.
  if (p === "/api/perchar") {
    const PLAIN = "FLAG-PERCHAR-5e88";
    const slots = [...PLAIN].map((ch, i) => ({ order: i, code: ch.charCodeAt(0) ^ 0x5a }));
    // Shuffle the delivery order deterministically per request.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = crypto.randomBytes(1)[0] % (i + 1);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    return json(res, 200, { slots, note: "codes are XOR 0x5A; `order` restores reading order" }), true;
  }

  /* ============ Guard 74: tiered field-level access ============ */
  if (p === "/api/tiered") {
    const key = req.headers["x-api-key"];
    const plan = accounts.planFor(key);
    const records = [
      { id: "R-1", name: "alpha", quarter: "Q1", value: 1200.5, margin: 0.32, forecast: 1450.0 },
      { id: "R-2", name: "beta", quarter: "Q2", value: 980.25, margin: 0.28, forecast: 1100.0 },
    ];
    const projected = accounts.project(records, plan);
    return json(res, 200, {
      plan,
      fields: accounts.PLAN_FIELDS[plan] || accounts.PLAN_FIELDS.anonymous,
      records: projected,
      // The premium fields are never in the response at any tier below pro.
      flag: plan === "pro" ? "FLAG-TIERED-b7c2" : `FLAG-TIERED-LIMITED-${plan}`,
    }), true;
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
