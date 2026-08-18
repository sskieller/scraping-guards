// @ts-check
/* Guards 47-71: risk engine, adversarial responses, identity, API shape,
 * passive signals, and the declarative layer. */
const { test, expect, request } = require("@playwright/test");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const MTLS_PORT = Number(new URL(BASE).port || 8080) + 1;

const risk = require("../lib/risk");
const apishape = require("../lib/apishape");

const getJson = async (p, headers) => {
  const ctx = await request.newContext({ extraHTTPHeaders: headers || {} });
  const r = await ctx.get(BASE + p);
  const body = await r.json();
  await ctx.dispose();
  return { status: r.status(), body };
};

/* ================= 47. Risk engine ================= */
test.describe("47. Weighted risk scoring", () => {
  test("weights accumulate and map onto the escalation ladder", () => {
    expect(risk.score([]).action).toBe("allow");
    expect(risk.score(["no-plugins"]).action).toBe("allow");                    // 8
    expect(risk.score(["header-order-mismatch"]).action).toBe("challenge");     // 25
    expect(risk.score(["http-library-ua", "no-referer"]).action).toBe("tarpit"); // 55
    expect(risk.score(["honeypot-link-followed"]).action).toBe("block");        // 100
  });

  test("a single weak signal can never block a real user", () => {
    for (const weak of ["no-plugins", "no-languages", "no-referer", "odd-hardware", "no-conditional-requests"]) {
      expect(risk.score([weak]).action, weak).toBe("allow");
    }
  });

  test("repeated signals are not double-counted", () => {
    const once = risk.score(["navigator.webdriver"]).score;
    const thrice = risk.score(["navigator.webdriver", "navigator.webdriver", "navigator.webdriver"]).score;
    expect(thrice).toBe(once);
  });

  test("score is capped at 100 and unknown signals contribute a small default", () => {
    expect(risk.score(Array(20).fill("honeypot-link-followed")).score).toBeLessThanOrEqual(100);
    const r = risk.score(["some-brand-new-detector"]);
    expect(r.score).toBe(5);
    expect(r.breakdown[0].known).toBe(false);
  });

  test("the endpoint escalates proportionally rather than all-or-nothing", async () => {
    // Clean browser-shaped request → allow.
    const allow = await getJson("/api/risk/gated", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
      Referer: BASE + "/frontier.html", "Accept-Language": "en-US",
    });
    expect(allow.status).toBe(200);
    expect(allow.body.action).toBe("allow");

    // Mid-score → a challenge the client can actually pass, not a hard block.
    const challenge = await getJson("/api/risk/gated?signals=header-order-mismatch", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
      Referer: BASE + "/frontier.html", "Accept-Language": "en-US",
    });
    expect(challenge.status).toBe(401);
    expect(challenge.body.action).toBe("challenge");

    // Conclusive → block.
    const blocked = await getJson("/api/risk/gated?signals=honeypot-link-followed");
    expect(blocked.status).toBe(403);
    expect(blocked.body.action).toBe("block");
  });

  test("tarpit tier serves poisoned data slowly instead of refusing", async () => {
    const t0 = Date.now();
    const r = await getJson("/api/risk/gated?signals=http-library-ua,no-referer", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "Accept-Language": "en",
      Referer: BASE + "/x",
    });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe("tarpit");
    expect(Date.now() - t0).toBeGreaterThan(300);
    expect(r.body.records.length).toBeGreaterThan(0);
  });
});

/* ================= 48. Subresource verification ================= */
test.describe("48. Subresource verification", () => {
  test("an HTML-only scraper is caught", async () => {
    const r = await getJson("/api/subresource/verify?sid=html-only-scraper");
    expect(r.status).toBe(403);
    expect(r.body.flag).toBe("FLAG-SUBRESOURCE-BOT");
    expect(r.body.missing).toEqual(expect.arrayContaining(["css", "font", "beacon"]));
  });

  test("a real browser fetches all of them", async ({ page }) => {
    await page.goto(BASE + "/frontier.html");
    await expect(page.locator("#subresource-out")).toContainText("FLAG-SUBRESOURCE-7a15", { timeout: 15_000 });
  });
});

/* ================= 49/50. Anti-debug + integrity ================= */
test.describe("49/50. Anti-debugging and delivery integrity", () => {
  test("the packed bundle matches its manifest hash", () => {
    const root = path.join(__dirname, "..");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "integrity.json"), "utf8"));
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "antidebug.js"))).digest("hex");
    expect(actual).toBe(manifest["antidebug.js"].sha256);
  });

  test("the shipped bundle does not contain readable source", () => {
    const packed = fs.readFileSync(path.join(__dirname, "..", "antidebug.js"), "utf8");
    expect(packed).not.toContain("debugger-detected");
    expect(packed).not.toContain("devtools-viewport-gap");
    expect(packed).not.toContain("FLAG-ANTIDEBUG");
  });

  test("the page verifies its own script integrity at runtime", async ({ page }) => {
    await page.goto(BASE + "/frontier.html");
    await expect(page.locator("#integrity-out")).toContainText("FLAG-INTEGRITY-0f5c", { timeout: 15_000 });
    await expect(page.locator("#antidebug-out")).toContainText("FLAG-ANTIDEBUG", { timeout: 15_000 });
  });
});

/* ================= 51. WASM challenge ================= */
test.describe("51. WebAssembly challenge", () => {
  test("plaintext is absent from the page and the module runs", async ({ page }) => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/frontier.html")).text();
    expect(html).not.toContain("FLAG-WASM-9b31");
    await ctx.dispose();

    await page.goto(BASE + "/frontier.html");
    await expect(page.locator("#wasm-out")).toHaveText("FLAG-WASM-9b31", { timeout: 15_000 });
  });

  test("the module is valid wasm, not a stub", () => {
    const bytes = fs.readFileSync(path.join(__dirname, "..", "wasm", "challenge.wasm"));
    expect([...bytes.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // "\0asm"
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes));
    expect(inst.exports.solve(0x41)).toBe(0x41 ^ 0x5a);
  });
});

/* ================= 52-54. Adversarial responses ================= */
test.describe("52-54. Trap, cost and poison", () => {
  test("the labyrinth never terminates and is robots-disallowed", async () => {
    const ctx = await request.newContext();
    const robots = await (await ctx.get(BASE + "/robots.txt")).text();
    expect(robots).toContain("Disallow: /maze");

    // Walk three levels; every page yields more pages.
    let url = "/maze/seed0";
    for (let i = 0; i < 3; i++) {
      const html = await (await ctx.get(BASE + url)).text();
      expect(html).toContain("FLAG-LABYRINTH-TRAPPED");
      const links = [...html.matchAll(/href="(\/maze\/[a-f0-9]+)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      url = links[0];
    }
    await ctx.dispose();
  });

  test("maze pages are deterministic for a given seed", async () => {
    const ctx = await request.newContext();
    const a = await (await ctx.get(BASE + "/maze/fixed")).text();
    const b = await (await ctx.get(BASE + "/maze/fixed")).text();
    expect(a).toBe(b);
    await ctx.dispose();
  });

  test("the compression bomb is withheld from normal clients", async () => {
    const clean = await getJson("/api/bomb", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
      Referer: BASE + "/", "Accept-Language": "en-US",
    });
    expect(clean.status).toBe(200);
    expect(clean.body.served).toBe("normal");
  });

  test("the bomb expands far beyond its transfer size, and is capped", async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: { "X-Sim-Bot": "true" } });
    const r = await ctx.get(BASE + "/api/bomb");
    const expanded = Number(r.headers()["x-expanded-bytes"]);
    const ratio = Number(r.headers()["x-compression-ratio"]);
    expect(expanded).toBe(2 * 1024 * 1024);
    expect(expanded).toBeLessThanOrEqual(10 * 1024 * 1024); // documented hard cap
    expect(ratio).toBeGreaterThan(100);
    await ctx.dispose();
  });

  test("poisoned records are plausible, deterministic, and marked", async () => {
    const ua = { "User-Agent": "python-requests/2.31.0" };
    const a = await getJson("/api/records", ua);
    const b = await getJson("/api/records", ua);
    expect(a.body.records).toEqual(b.body.records);      // same scraper, same lies
    expect(a.body.flag).toBeUndefined();                  // not advertised as poison
    expect(a.body.records[0]._poison).toMatch(/^FLAG-POISON-[0-9a-f]{8}$/);

    const clean = await getJson("/api/records", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
      Referer: BASE + "/", "Accept-Language": "en-US",
    });
    expect(clean.body.flag).toBe("FLAG-RECORDS-REAL-5f81");
  });
});

/* ================= 55-58. Content-shape defenses ================= */
test.describe("55-58. Content shape", () => {
  test("sprite digits and pixel text contain no readable strings", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/frontier.html")).text();
    expect(html).not.toContain("FLAG-PIXELS");
    expect(html).not.toContain("4291"); // the sprite value

    const png = await (await ctx.get(BASE + "/assets/pixels.png")).body();
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(png.includes(Buffer.from("FLAG"))).toBe(false);
    await ctx.dispose();
  });

  test("fragmentation interleaves decoys and changes per request", async () => {
    const ctx = await request.newContext();
    const grab = async () => (await (await ctx.get(BASE + "/frontier.html")).text())
      .match(/<p data-fragment>([\s\S]*?)<\/p>/)[1];
    const a = await grab(), b = await grab();
    expect(a).not.toBe(b); // split points and decoys are regenerated

    // Naive "concatenate all text" yields decoy noise; honouring CSS gives the flag.
    const all = a.replace(/<[^>]+>/g, "");
    const visible = [...a.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]).join("");
    expect(visible).toBe("FLAG-FRAGMENT-d71a");
    expect(all).not.toBe(visible);
    await ctx.dispose();
  });

  test("SSR structural variance changes nesting between responses", async () => {
    const ctx = await request.newContext();
    const depth = async () => {
      const html = await (await ctx.get(BASE + "/frontier.html")).text();
      const m = html.match(/((?:<div [^>]*>)+)\s*<section class="arch"|((?:<div [^>]*>)+)[\s\S]{0,80}?ssr-variance/);
      return (html.match(/data-layer="\d"/g) || []).length;
    };
    const seen = new Set();
    for (let i = 0; i < 8; i++) seen.add(await depth());
    expect(seen.size).toBeGreaterThan(1); // nesting depth genuinely varies
    await ctx.dispose();
  });
});

/* ================= 59-62. Identity ================= */
test.describe("59-62. Identity and attestation", () => {
  test("quota is enforced per account and keys are device-bound", async () => {
    const ctx = await request.newContext();
    const login = await (await ctx.post(BASE + "/api/auth/login", {
      data: { username: "demo", password: "demo-password", device: "device-A" },
    })).json();
    expect(login.ok).toBe(true);

    const hdr = { "X-API-Key": login.apiKey, "X-Device": "device-A" };
    for (let i = 0; i < login.quota; i++) {
      const r = await ctx.get(BASE + "/api/account/content", { headers: hdr });
      expect(r.status()).toBe(200);
    }
    const over = await ctx.get(BASE + "/api/account/content", { headers: hdr });
    expect(over.status()).toBe(429);
    expect((await over.json()).reason).toBe("quota-exhausted");

    // A leaked key cannot be fanned out across a scraping fleet.
    const elsewhere = await ctx.get(BASE + "/api/account/content", {
      headers: { "X-API-Key": login.apiKey, "X-Device": "device-B" },
    });
    expect(elsewhere.status()).toBe(403);
    expect((await elsewhere.json()).reason).toBe("device-mismatch");

    const badCreds = await ctx.post(BASE + "/api/auth/login", { data: { username: "demo", password: "wrong" } });
    expect(badCreds.status()).toBe(401);
    await ctx.dispose();
  });

  test("mutual TLS accepts only a client cert signed by our CA", async () => {
    const certDir = path.join(__dirname, "..", "certs");
    test.skip(!fs.existsSync(path.join(certDir, "client-cert.pem")), "openssl unavailable — mTLS listener not started");

    const https = require("https");
    const call = (opts) => new Promise((resolve, reject) => {
      const req = https.request({
        host: "localhost", port: MTLS_PORT, path: "/", method: "GET",
        ca: fs.readFileSync(path.join(certDir, "ca.pem")),
        rejectUnauthorized: false, ...opts,
      }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      });
      req.on("error", reject);
      req.end();
    });

    const without = await call({});
    expect(without.status).toBe(401);
    expect(without.body.flag).toBe("FLAG-MTLS-REFUSED");

    const with_ = await call({
      cert: fs.readFileSync(path.join(certDir, "client-cert.pem")),
      key: fs.readFileSync(path.join(certDir, "client-key.pem")),
    });
    expect(with_.status).toBe(200);
    expect(with_.body.flag).toBe("FLAG-MTLS-4e77");
    expect(with_.body.subject).toBe("authorised-client");
  });

  test("attestation and PAT stubs declare themselves simulated", async () => {
    const ctx = await request.newContext();
    const attest = await (await ctx.post(BASE + "/api/attest", {
      data: { token: "play.abcdefgh12345", platform: "android" },
    })).json();
    expect(attest.simulated).toBe(true);
    expect(attest.realRequirement).toMatch(/Play Integrity|App Attest/);

    const pat = await getJson("/api/pat");
    expect(pat.body.simulated).toBe(true);
    expect(pat.body.realRequirement).toMatch(/Privacy Pass/);
    await ctx.dispose();
  });
});

/* ================= 63-65. API shape ================= */
test.describe("63-65. API shape", () => {
  test("only allowlisted query hashes execute", async () => {
    const ctx = await request.newContext();
    const hashes = await (await ctx.get(BASE + "/api/graphql/hashes")).json();

    const ok = await ctx.post(BASE + "/api/graphql", { data: { hash: hashes.summary } });
    expect((await ok.json()).data.summary.flag).toBe("FLAG-PERSISTEDQ-11ac");

    const adhoc = await ctx.post(BASE + "/api/graphql", { data: { query: "{ users { email password } }" } });
    expect(adhoc.status()).toBe(403);
    expect((await adhoc.json()).flag).toBe("FLAG-PERSISTEDQ-BOT");

    const unknown = await ctx.post(BASE + "/api/graphql", { data: { hash: "0".repeat(64) } });
    expect(unknown.status()).toBe(403);
    expect((await unknown.json()).reason).toBe("unknown-query-hash");
    await ctx.dispose();
  });

  test("request signatures cover the body and cannot be replayed", async () => {
    const ctx = await request.newContext();
    const body = JSON.stringify({ action: "read" });
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(8).toString("hex");
    const signature = apishape.signRequest({ method: "POST", path: "/api/signed-request", body, timestamp, nonce });
    const headers = { "X-Timestamp": timestamp, "X-Nonce": nonce, "X-Signature": signature, "Content-Type": "application/json" };

    const good = await ctx.post(BASE + "/api/signed-request", { data: body, headers });
    expect((await good.json()).flag).toBe("FLAG-REQSIGN-c92e");

    // Same signature, second time → rejected.
    const replay = await ctx.post(BASE + "/api/signed-request", { data: body, headers });
    expect(replay.status()).toBe(401);
    expect((await replay.json()).reason).toBe("nonce-replayed");

    // Tampered body under a valid signature → rejected.
    const tamperedNonce = crypto.randomBytes(8).toString("hex");
    const sig2 = apishape.signRequest({ method: "POST", path: "/api/signed-request", body, timestamp, nonce: tamperedNonce });
    const tampered = await ctx.post(BASE + "/api/signed-request", {
      data: JSON.stringify({ action: "delete" }),
      headers: { ...headers, "X-Nonce": tamperedNonce, "X-Signature": sig2 },
    });
    expect(tampered.status()).toBe(401);
    expect((await tampered.json()).reason).toBe("bad-signature");

    // Stale timestamp → rejected.
    const oldTs = String(Date.now() - 120_000);
    const oldNonce = crypto.randomBytes(8).toString("hex");
    const stale = await ctx.post(BASE + "/api/signed-request", {
      data: body,
      headers: { ...headers, "X-Timestamp": oldTs, "X-Nonce": oldNonce,
        "X-Signature": apishape.signRequest({ method: "POST", path: "/api/signed-request", body, timestamp: oldTs, nonce: oldNonce }) },
    });
    expect(stale.status()).toBe(401);
    expect((await stale.json()).reason).toBe("timestamp-outside-window");
    await ctx.dispose();
  });

  test("binary field names re-key per session", async () => {
    const ctx = await request.newContext();
    const a = await (await ctx.get(BASE + "/api/binary?seed=session-A")).body();
    const b = await (await ctx.get(BASE + "/api/binary?seed=session-B")).body();
    expect(a.equals(b)).toBe(false); // one hardcoded parser will not work twice

    expect(apishape.decodeBinary(a, "session-A", ["title", "flag", "count"]).flag).toBe("FLAG-BINPROTO-a4d6");
    // Wrong seed → the keys are meaningless.
    expect(apishape.decodeBinary(a, "session-B", ["title", "flag", "count"]).flag).toBeUndefined();
    await ctx.dispose();
  });
});

/* ================= 66-68. Passive session signals ================= */
test.describe("66-68. Passive signals", () => {
  test("metronomic navigation is flagged, human dwell is not", async () => {
    const ctx = await request.newContext();
    const botSid = "bot-" + crypto.randomBytes(4).toString("hex");
    for (const p of ["/a", "/b", "/c", "/d"]) await ctx.get(`${BASE}/api/nav/visit?sid=${botSid}&path=${p}`);
    const bot = await ctx.get(`${BASE}/api/nav/score?sid=${botSid}`);
    expect(bot.status()).toBe(403);
    expect((await bot.json()).flag).toBe("FLAG-NAVGRAPH-BOT");

    const humanSid = "human-" + crypto.randomBytes(4).toString("hex");
    for (const p of ["/a", "/b", "/c"]) {
      await ctx.get(`${BASE}/api/nav/visit?sid=${humanSid}&path=${p}`);
      await new Promise((r) => setTimeout(r, 200 + Math.round(Math.random() * 150)));
    }
    const human = await ctx.get(`${BASE}/api/nav/score?sid=${humanSid}`);
    expect(human.status()).toBe(200);
    expect((await human.json()).flag).toBe("FLAG-NAVGRAPH-1c73");
    await ctx.dispose();
  });

  test("a client that never revalidates is flagged", async () => {
    const ctx = await request.newContext();
    const sid = "nocache-" + crypto.randomBytes(4).toString("hex");
    // Re-download the same resource repeatedly without If-None-Match.
    await ctx.get(`${BASE}/api/etag-resource?sid=${sid}`);
    await ctx.get(`${BASE}/api/etag-resource?sid=${sid}`);
    const v = await ctx.get(`${BASE}/api/etag/verify?sid=${sid}`);
    expect(v.status()).toBe(403);
    expect((await v.json()).flag).toBe("FLAG-ETAG-BOT");

    // A revalidating client is fine.
    const sid2 = "cache-" + crypto.randomBytes(4).toString("hex");
    await ctx.get(`${BASE}/api/etag-resource?sid=${sid2}`);
    await ctx.get(`${BASE}/api/etag-resource?sid=${sid2}`, { headers: { "If-None-Match": '"sg-etag-v1"' } });
    const v2 = await ctx.get(`${BASE}/api/etag/verify?sid=${sid2}`);
    expect(v2.status()).toBe(200);
    await ctx.dispose();
  });

  test("CSS media queries fingerprint the client with no JS", async ({ page }) => {
    await page.goto(BASE + "/frontier.html");
    await expect(page.locator("#cssfp-out")).toContainText("FLAG-CSSFP-9e42", { timeout: 15_000 });
    // "base" always applies; the default 1280px viewport adds "wide" too.
    const buckets = await page.locator("#cssfp-out").textContent();
    expect(buckets).toContain("base");
    expect(buckets).toContain("wide");
  });
});

/* ================= 69. Fingerprint surfaces ================= */
test("69. extended fingerprint surfaces are collected", async ({ page }) => {
  await page.goto(BASE + "/frontier.html");
  // textContent() resolves as soon as the element EXISTS, so it can read the
  // "[checking…]" placeholder before the async collection finishes. Assert
  // with toContainText first — that retries — then read the settled value.
  const out = page.locator("#fpsurface-out");
  await expect(out).toContainText("FLAG-FPSURFACE-4a8e", { timeout: 15_000 });
  const text = await out.textContent();
  for (const key of ["fonts=", "codecs=", "voices=", "timerRes=", "webgpu="]) {
    expect(text, `missing ${key}`).toContain(key);
  }
});

/* ================= 70. AI / TDM declarative layer ================= */
test.describe("70. AI declarative layer", () => {
  test("ai.txt, llms.txt and robots.txt agree on the policy", async () => {
    const ctx = await request.newContext();
    const ai = await ctx.get(BASE + "/ai.txt");
    expect(ai.status()).toBe(200);
    const aiBody = await ai.text();
    expect(aiBody).toContain("TDM-Reservation: 1");
    // Headers carry the reservation too, for clients that never read the file.
    expect(ai.headers()["tdm-reservation"]).toBe("1");
    expect(ai.headers()["x-robots-tag"]).toContain("noai");

    const llms = await (await ctx.get(BASE + "/llms.txt")).text();
    expect(llms).toContain("# Scraping Guards Test Page");
    expect(llms).toContain("poisoned");

    const robots = await (await ctx.get(BASE + "/robots.txt")).text();
    for (const bot of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Bytespider", "PerplexityBot"]) {
      expect(robots, `robots.txt must name ${bot}`).toContain(bot);
      expect(aiBody, `ai.txt must name ${bot}`).toContain(bot);
    }
    await ctx.dispose();
  });

  test("the page carries noai and TDM meta tags", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/frontier.html")).text();
    expect(html).toContain("noai");
    expect(html).toContain('name="tdm-reservation"');
    await ctx.dispose();
  });
});

/* ================= 72-74. Perturbation, per-char, tiering ================= */
test.describe("72. Subtle data perturbation", () => {
  const CLEAN = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
    "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
    Referer: BASE + "/frontier.html", "Accept-Language": "en-US",
  };

  test("clean clients get the genuine catalogue", async () => {
    const r = await getJson("/api/prices", CLEAN);
    expect(r.body.flag).toBe("FLAG-PRICES-REAL-c40f");
    expect(r.body.records[0].price).toBe(249.0);
  });

  test("scored clients get drifted values that still look plausible", async () => {
    const real = (await getJson("/api/prices", CLEAN)).body.records;
    const bad = (await getJson("/api/prices", { "User-Agent": "python-requests/2.31.0" })).body.records;

    // Same shape and key set — nothing structural gives it away.
    expect(bad.length).toBe(real.length);
    expect(Object.keys(bad[0]).sort()).toEqual(Object.keys(real[0]).sort());
    // No marker field, unlike guard 54.
    expect(JSON.stringify(bad)).not.toContain("_poison");
    expect(JSON.stringify(bad)).not.toContain("FLAG");

    // Values moved, but stayed within a plausible band (±4%).
    let drifted = 0;
    for (let i = 0; i < real.length; i++) {
      if (bad[i].price !== real[i].price) drifted++;
      const ratio = bad[i].price / real[i].price;
      expect(ratio, `price ${i} drifted implausibly`).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
    expect(drifted, "at least some values must actually move").toBeGreaterThan(0);
  });

  test("drift is stable per client, so re-fetching never reveals it", async () => {
    const ua = { "User-Agent": "python-requests/2.31.0" };
    const a = (await getJson("/api/prices", ua)).body.records;
    const b = (await getJson("/api/prices", ua)).body.records;
    expect(a).toEqual(b);

    // A different scraper identity gets different drift.
    const c = (await getJson("/api/prices", { "User-Agent": "Scrapy/2.11" })).body.records;
    expect(c).not.toEqual(a);
  });
});

test.describe("73. Per-character rendering", () => {
  test("characters are delivered shuffled and encoded, never as text", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/frontier.html")).text();
    expect(html).not.toContain("FLAG-PERCHAR-5e88");

    const { slots } = await (await ctx.get(BASE + "/api/perchar")).json();
    // Decoding requires both the XOR and re-sorting by `order`.
    const decoded = [...slots].sort((a, b) => a.order - b.order)
      .map((s) => String.fromCharCode(s.code ^ 0x5a)).join("");
    expect(decoded).toBe("FLAG-PERCHAR-5e88");

    // Reading them in delivery order gives scrambled output.
    const naive = slots.map((s) => String.fromCharCode(s.code ^ 0x5a)).join("");
    expect(naive).not.toBe(decoded);
    await ctx.dispose();
  });

  test("the browser renders one canvas per character", async ({ page }) => {
    await page.goto(BASE + "/frontier.html");
    await expect(page.locator("#perchar-out")).toContainText("single-character canvases", { timeout: 15_000 });
    const canvases = page.locator("#perchar-wrap canvas");
    await expect(canvases).toHaveCount("FLAG-PERCHAR-5e88".length);
    // Every canvas must actually have ink on it.
    const allDrawn = await page.evaluate(() =>
      [...document.querySelectorAll("#perchar-wrap canvas")].every((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        return d.some((v, i) => i % 4 === 3 && v !== 0);
      })
    );
    expect(allDrawn).toBe(true);
  });
});

test.describe("74. Tiered field-level access", () => {
  test("premium fields are absent below the pro tier, not merely hidden", async () => {
    const ctx = await request.newContext();
    const anon = await (await ctx.get(BASE + "/api/tiered")).json();
    expect(anon.plan).toBe("anonymous");
    expect(anon.fields).toEqual(["id", "name"]);
    // The expensive fields are simply not in the payload.
    expect(JSON.stringify(anon.records)).not.toContain("margin");
    expect(JSON.stringify(anon.records)).not.toContain("forecast");

    const free = await (await ctx.post(BASE + "/api/auth/login", {
      data: { username: "demo", password: "demo-password" },
    })).json();
    const freeData = await (await ctx.get(BASE + "/api/tiered", {
      headers: { "X-API-Key": free.apiKey },
    })).json();
    expect(freeData.plan).toBe("free");
    expect(JSON.stringify(freeData.records)).not.toContain("margin");

    const pro = await (await ctx.post(BASE + "/api/auth/login", {
      data: { username: "pro", password: "pro-password" },
    })).json();
    const proData = await (await ctx.get(BASE + "/api/tiered", {
      headers: { "X-API-Key": pro.apiKey },
    })).json();
    expect(proData.plan).toBe("pro");
    expect(proData.flag).toBe("FLAG-TIERED-b7c2");
    expect(proData.records[0]).toHaveProperty("margin");
    expect(proData.records[0]).toHaveProperty("forecast");
    await ctx.dispose();
  });

  test("farming free accounts cannot reach premium fields", async () => {
    const ctx = await request.newContext();
    // Ten separate free accounts still yield the same impoverished projection.
    for (let i = 0; i < 10; i++) {
      const acct = await (await ctx.post(BASE + "/api/auth/login", {
        data: { username: "demo", password: "demo-password", device: `dev-${i}` },
      })).json();
      const d = await (await ctx.get(BASE + "/api/tiered", { headers: { "X-API-Key": acct.apiKey } })).json();
      expect(d.fields).not.toContain("margin");
    }
    await ctx.dispose();
  });
});

/* ================= 75. Verified crawler allowlisting ================= */
test.describe("75. Verified crawler allowlisting", () => {
  const crawlers = require("../lib/crawlers");

  test("a real forward-confirmed lookup verifies the crawler", async () => {
    // Exercises the genuine DNS path: localhost always resolves to 127.0.0.1,
    // so reverse -> suffix -> forward-confirm all run for real.
    const r = await crawlers.verify("127.0.0.1", "SGTestBot/1.0", { simHostname: "localhost" });
    expect(r.claimed).toBe("SGTestBot");
    expect(r.verified).toBe(true);
    expect(r.reason).toBe("forward-confirmed");
  });

  test("a forged Googlebot UA is rejected", async () => {
    // Hostname does not belong to the operator.
    const wrongHost = await crawlers.verify("127.0.0.1", "Googlebot/2.1", { simHostname: "localhost" });
    expect(wrongHost.verified).toBe(false);
    expect(wrongHost.reason).toBe("hostname-not-owned-by-operator");

    // Operator-shaped hostname, but it will not forward-confirm to our IP.
    // This is the case a rDNS-only check would wrongly accept.
    const forgedPtr = await crawlers.verify("127.0.0.1", "Googlebot/2.1", {
      simHostname: "crawl-66-249-66-1.googlebot.com",
    });
    expect(forgedPtr.verified).toBe(false);
    expect(["forward-confirm-mismatch", "forward-lookup-failed"]).toContain(forgedPtr.reason);
  });

  test("clients making no crawler claim are simply not allowlisted", async () => {
    const r = await crawlers.verify("127.0.0.1", "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0");
    expect(r.claimed).toBeNull();
    expect(r.verified).toBe(false);
  });

  test("the endpoint reports spoofed vs verified", async () => {
    const spoof = await getJson("/api/crawler/verify", {
      "User-Agent": "Googlebot/2.1", "X-Sim-RDNS": "localhost",
    });
    expect(spoof.status).toBe(403);
    expect(spoof.body.flag).toBe("FLAG-CRAWLER-SPOOFED");

    const ok = await getJson("/api/crawler/verify", {
      "User-Agent": "SGTestBot/1.0", "X-Sim-RDNS": "localhost",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.flag).toBe("FLAG-VERIFIEDBOT-9d14");
  });

  test("a verified crawler bypasses the risk ladder entirely", async () => {
    // Same request shape that scores as "block" without the allowlist.
    const blocked = await getJson("/api/risk/gated?signals=honeypot-link-followed");
    expect(blocked.body.action).toBe("block");

    const allowed = await getJson("/api/risk/gated?signals=honeypot-link-followed", {
      "User-Agent": "SGTestBot/1.0", "X-Sim-RDNS": "localhost",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.action).toBe("allow");
    expect(allowed.body.flag).toBe("FLAG-RISK-ALLOWLIST-7e02");
  });
});

/* ================= 76. Adaptive weights ================= */
test.describe("76. Adaptive risk weights", () => {
  const risk = require("../lib/risk");
  test.beforeEach(() => risk.resetLearning());

  test("weights stay at base until there is enough evidence", () => {
    risk.recordOutcome(["no-plugins"], true);
    expect(risk.adaptiveMultiplier("no-plugins")).toBe(1); // below MIN_OBSERVATIONS
    for (let i = 0; i < risk.MIN_OBSERVATIONS; i++) risk.recordOutcome(["no-plugins"], true);
    expect(risk.adaptiveMultiplier("no-plugins")).toBeGreaterThan(1);
  });

  test("a signal that predicts bots gains weight; one that predicts humans loses it", () => {
    for (let i = 0; i < 10; i++) risk.recordOutcome(["no-plugins"], true);
    for (let i = 0; i < 10; i++) risk.recordOutcome(["no-referer"], false);

    expect(risk.adaptiveMultiplier("no-plugins")).toBeCloseTo(1.5, 1);
    expect(risk.adaptiveMultiplier("no-referer")).toBeCloseTo(0.5, 1);

    const scored = risk.adaptiveScore(["no-plugins"]);
    const base = risk.score(["no-plugins"]);
    expect(scored.score).toBeGreaterThan(base.score);
    expect(scored.adaptive).toBe(true);
  });

  test("poisoned feedback cannot drive a weight outside the clamp", () => {
    for (let i = 0; i < 5000; i++) risk.recordOutcome(["no-plugins"], true);
    const m = risk.adaptiveMultiplier("no-plugins");
    expect(m).toBeLessThanOrEqual(risk.CLAMP.max);
    expect(m).toBeGreaterThanOrEqual(risk.CLAMP.min);
    // Even maximally boosted, one weak signal must not reach the block band.
    expect(risk.adaptiveScore(["no-plugins"]).action).toBe("allow");
  });

  test("a honeypot hit labels the co-occurring signals automatically", async () => {
    const ctx = await request.newContext();
    await ctx.get(BASE + "/api/risk/reset-learning");
    // A python-requests UA walking into the honeypot: conclusive bot evidence.
    const bot = await request.newContext({ extraHTTPHeaders: { "User-Agent": "python-requests/2.31.0" } });
    for (let i = 0; i < 6; i++) await bot.get(BASE + "/trap");

    const w = await (await ctx.get(BASE + "/api/risk/weights")).json();
    const learned = w.weights.find((x) => x.signal === "http-library-ua");
    expect(learned.observations.bot).toBeGreaterThanOrEqual(6);
    expect(learned.multiplier).toBeGreaterThan(1); // it earned its weight
    await bot.dispose();
    await ctx.dispose();
  });
});

/* ================= 77. Enumeration detection ================= */
test.describe("77. Enumeration detection", () => {
  test("sequential ID walking is caught regardless of timing", async () => {
    const ctx = await request.newContext();
    const sid = "enum-bot-" + crypto.randomBytes(4).toString("hex");
    for (let id = 1; id <= 12; id++) await ctx.get(`${BASE}/api/item?sid=${sid}&id=${id}`);
    const r = await ctx.get(`${BASE}/api/enumeration/score?sid=${sid}`);
    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.flag).toBe("FLAG-ENUMERATION-BOT");
    expect(body.signals).toContain("sequential-enumeration");
    expect(body.longestRun).toBe(12);
    await ctx.dispose();
  });

  test("broad keyspace coverage is caught even when shuffled", async () => {
    const ctx = await request.newContext();
    const sid = "enum-cover-" + crypto.randomBytes(4).toString("hex");
    // 30 scattered ids out of a 100-key space — no sequential run at all.
    const ids = [...Array(30).keys()].map((i) => (i * 7) % 100);
    for (const id of ids) await ctx.get(`${BASE}/api/item?sid=${sid}&id=${id}`);
    const body = await (await ctx.get(`${BASE}/api/enumeration/score?sid=${sid}&keyspace=100`)).json();
    expect(body.signals).toContain("keyspace-coverage");
    expect(body.enumerating).toBe(true);
    await ctx.dispose();
  });

  test("scattered human browsing with revisits is not flagged", async () => {
    const ctx = await request.newContext();
    const sid = "enum-human-" + crypto.randomBytes(4).toString("hex");
    for (const id of [42, 7, 42, 91, 7]) await ctx.get(`${BASE}/api/item?sid=${sid}&id=${id}`);
    const r = await ctx.get(`${BASE}/api/enumeration/score?sid=${sid}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.flag).toBe("FLAG-ENUMERATION-8c31");
    expect(body.enumerating).toBe(false);
    await ctx.dispose();
  });
});

/* ================= 78. Text watermarking ================= */
test.describe("78. Steganographic text watermarking", () => {
  const watermark = require("../lib/watermark");

  test("the visible text is unchanged but carries the recipient", async () => {
    const ctx = await request.newContext();
    const a = await (await ctx.get(BASE + "/api/article?key=alice-key")).json();
    const b = await (await ctx.get(BASE + "/api/article?key=bob-key")).json();

    // Readers see identical prose...
    expect(watermark.strip(a.text)).toBe(watermark.strip(b.text));
    // ...but the delivered bytes differ, and each traces to its recipient.
    expect(a.text).not.toBe(b.text);
    expect(watermark.extract(a.text)).toBe("acct:alice-key");
    expect(watermark.extract(b.text)).toBe("acct:bob-key");
    await ctx.dispose();
  });

  test("the mark survives a copy-paste and a naive HTML strip", async () => {
    const ctx = await request.newContext();
    const a = await (await ctx.get(BASE + "/api/article?key=carol-key")).json();

    // Simulate "copied into a CMS and re-published inside markup".
    const republished = `<article><p>${a.text}</p></article>`.replace(/<[^>]+>/g, "");
    const traced = await ctx.post(BASE + "/api/watermark/extract", { data: { text: republished } });
    expect(traced.status()).toBe(200);
    expect((await traced.json()).recipient).toBe("acct:carol-key");
    await ctx.dispose();
  });

  test("normalisation removes it — stated honestly, not hidden", async () => {
    const ctx = await request.newContext();
    const a = await (await ctx.get(BASE + "/api/article?key=dave-key")).json();
    const scrubbed = watermark.strip(a.text); // any zero-width normalisation
    const r = await ctx.post(BASE + "/api/watermark/extract", { data: { text: scrubbed } });
    expect(r.status()).toBe(404);
    expect((await r.json()).flag).toBe("FLAG-WATERMARK-NONE");
    await ctx.dispose();
  });
});

/* ================= 79. Degradation response modes ================= */
test.describe("79. Degradation response modes", () => {
  test("the ladder gained a greylist rung below challenge", async () => {
    const risk = require("../lib/risk");
    expect(risk.actionFor(20).action).toBe("monitor");
    // A greylisted client must not be able to tell: same status, no hint.
    const r = await getJson("/api/risk/gated?signals=rate-exceeded", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
      "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
      Referer: BASE + "/frontier.html", "Accept-Language": "en-US",
    });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe("monitor");
    expect(r.body.greylisted).toBe(true);
  });

  test("redirect and empty modes look like ordinary responses", async () => {
    const ctx = await request.newContext();
    const red = await ctx.get(BASE + "/api/degrade?mode=redirect", { maxRedirects: 0 });
    expect(red.status()).toBe(302);
    expect(red.headers()["location"]).toBe("/");

    const empty = await ctx.get(BASE + "/api/degrade?mode=empty");
    expect(empty.status()).toBe(200);
    const body = await empty.json();
    // Structurally valid, just... nothing. No error to notice.
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
    await ctx.dispose();
  });

  test("hangup destroys the socket with no response at all", async () => {
    const http = require("http");
    const u = new URL(BASE);
    const err = await new Promise((resolve) => {
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: "/api/degrade?mode=hangup", method: "GET" },
        (res) => resolve({ unexpectedStatus: res.statusCode })
      );
      req.on("error", (e) => resolve({ code: e.code }));
      req.end();
    });
    // Indistinguishable from a network fault — which is the point.
    expect(err.unexpectedStatus).toBeUndefined();
    expect(["ECONNRESET", "ECONNABORTED", "EPIPE"]).toContain(err.code);
  });

  test("every mode documents what it leaks", async () => {
    const r = await getJson("/api/degrade/modes");
    for (const mode of ["block", "redirect", "empty", "hangup", "slow", "poison"]) {
      expect(r.body.modes[mode], `${mode} must be documented`).toBeTruthy();
      expect(r.body.modes[mode].description.length).toBeGreaterThan(10);
    }
  });
});

/* ================= 80. API honeypot ================= */
test.describe("80. API honeypot", () => {
  test("the decoy field is undocumented and dereferencing it flags the client", async () => {
    const ctx = await request.newContext();
    const listing = await (await ctx.get(BASE + "/api/listing")).json();
    // Present, but named so no legitimate consumer would use it.
    expect(listing._internal_export).toBeTruthy();
    expect(listing.items.length).toBeGreaterThan(0);

    const trap = await ctx.get(BASE + "/api/internal/bulk-export?token=decoy");
    expect(trap.status()).toBe(403);
    expect((await trap.json()).flag).toBe("FLAG-APIHONEYPOT-BOT");
    await ctx.dispose();
  });

  test("hitting the API honeypot also labels the adaptive weights", async () => {
    const ctx = await request.newContext();
    await ctx.get(BASE + "/api/risk/reset-learning");
    const bot = await request.newContext({ extraHTTPHeaders: { "User-Agent": "Scrapy/2.11" } });
    for (let i = 0; i < 6; i++) await bot.get(BASE + "/api/internal/bulk-export");
    const w = await (await ctx.get(BASE + "/api/risk/weights")).json();
    expect(w.weights.find((x) => x.signal === "http-library-ua").observations.bot).toBeGreaterThanOrEqual(6);
    await bot.dispose();
    await ctx.dispose();
  });
});

/* ================= 81. Pay-per-crawl ================= */
test.describe("81. Pay-per-crawl", () => {
  test("priced content answers 402 with terms, and a receipt unlocks it", async () => {
    const ctx = await request.newContext();
    const unpaid = await ctx.get(BASE + "/api/premium-content");
    expect(unpaid.status()).toBe(402);
    const terms = await unpaid.json();
    expect(terms.price.amount).toBe("0.002");
    expect(terms.flag).toBe("FLAG-PAYCRAWL-402");

    const { receipt } = await (await ctx.get(BASE + "/api/crawl-receipt?path=%2Fapi%2Fpremium-content")).json();
    const paid = await ctx.get(BASE + "/api/premium-content", { headers: { "X-Crawler-Receipt": receipt } });
    expect(paid.status()).toBe(200);
    expect((await paid.json()).flag).toBe("FLAG-PAYCRAWL-PAID-1c4e");
    await ctx.dispose();
  });

  test("a receipt is scoped to one path and cannot be forged", async () => {
    const ctx = await request.newContext();
    const { receipt } = await (await ctx.get(BASE + "/api/crawl-receipt?path=%2Fapi%2Fpremium-content")).json();

    // Bought for premium-content, presented at archive.
    const wrongPath = await ctx.get(BASE + "/api/archive", { headers: { "X-Crawler-Receipt": receipt } });
    expect(wrongPath.status()).toBe(402);
    expect((await wrongPath.json()).reason).toBe("receipt-wrong-path");

    const forged = await ctx.get(BASE + "/api/premium-content", {
      headers: { "X-Crawler-Receipt": receipt.split(".")[0] + ".notasignature" },
    });
    expect(forged.status()).toBe(402);
    expect((await forged.json()).reason).toBe("bad-receipt-signature");
    await ctx.dispose();
  });
});

/* ================= 82. Per-path crawler policy ================= */
test.describe("82. Per-path crawler policy", () => {
  test("public paths are crawlable, monetised and internal paths are not", async () => {
    const docs = await getJson("/api/policy?path=%2Fdocs");
    expect(docs.status).toBe(200);
    expect(docs.body.flag).toBe("FLAG-CRAWLPOLICY-ALLOW-3f21");

    for (const path of ["/api/premium-content", "/internal"]) {
      const r = await getJson(`/api/policy?path=${encodeURIComponent(path)}`);
      expect(r.status, path).toBe(403);
      expect(r.body.flag).toBe("FLAG-CRAWLPOLICY-DENY");
    }
  });

  test("restricted paths key on the VERIFIED identity, not the UA string", async () => {
    // Claiming Googlebot without DNS backing gets you nothing.
    const claimed = await getJson("/api/policy?path=%2Farchive", { "User-Agent": "Googlebot/2.1" });
    expect(claimed.status).toBe(403);
    expect(claimed.body.verifiedAs).toBeNull();

    // The archive rule lists Googlebot/Bingbot/archive.org, so our test bot is
    // verified but still not on that path's list — verification is necessary,
    // not sufficient.
    const verified = await getJson("/api/policy?path=%2Farchive", {
      "User-Agent": "SGTestBot/1.0", "X-Sim-RDNS": "localhost",
    });
    expect(verified.body.verifiedAs).toBe("SGTestBot");
    expect(verified.status).toBe(403);

    // ...but it IS allowed on a wildcard path.
    const wildcard = await getJson("/api/policy?path=%2Fdocs", {
      "User-Agent": "SGTestBot/1.0", "X-Sim-RDNS": "localhost",
    });
    expect(wildcard.status).toBe(200);
  });
});

/* ================= 36 refinement: hover before click ================= */
test("36. a programmatic click with no preceding hover is flagged", async () => {
  const ctx = await request.newContext();
  // element.click() fires no mouseover first; a real pointer always arrives.
  const bot = await ctx.post(BASE + "/api/behavior/score", {
    data: { moves: [], clicked: true, hoveredBeforeClick: false },
  });
  expect((await bot.json()).signals).toContain("click-without-hover");

  const human = await ctx.post(BASE + "/api/behavior/score", {
    data: {
      moves: [0, 17, 39, 56, 68, 85, 107].map((t, i) => ({ x: i * 9 + (i % 3), y: i * i, t })),
      clicked: true, hoveredBeforeClick: true, formMs: 2400,
    },
  });
  expect((await human.json()).signals || []).not.toContain("click-without-hover");
  await ctx.dispose();
});

/* ================= 71 + honesty guardrail ================= */
test("71. QUIC stub declares itself simulated", async () => {
  const r = await getJson("/api/net/quic");
  expect(r.body.simulated).toBe(true);
  expect(r.body.realRequirement).toMatch(/HTTP\/3|QUIC/);
  const bot = await getJson("/api/net/quic", { "X-Sim-QUIC": "bot" });
  expect(bot.status).toBe(403);
});

test("every simulated guard in this tier is explicitly labelled", async () => {
  for (const p of ["/api/net/quic", "/api/pat"]) {
    const r = await getJson(p);
    expect(r.body.simulated, `${p} must declare simulated:true`).toBe(true);
  }
  // And the obfuscator must keep its honesty note about not being production-grade.
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "obfuscate.js"), "utf8");
  expect(src).toContain("HONESTY NOTE");
  expect(src).toMatch(/not commercial-grade|packing/i);
});
