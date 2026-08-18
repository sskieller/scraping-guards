// @ts-check
// Tier 1 guards (26-41): fully implemented, real defenses.
const { test, expect, request } = require("@playwright/test");
const crypto = require("crypto");

const BASE = process.env.BASE_URL || "http://localhost:8080";

/* Raw Node request — Playwright's APIRequestContext normalizes header order,
 * so header-ORDER assertions need a client that sends exactly what we specify.
 * Node preserves the insertion order of the headers object. */
function rawGet(path, headers) {
  const http = require("http");
  const u = new URL(BASE + path);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const CHROME_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="120", "Not:A-Brand";v="8"',
  Accept: "*/*",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "en-US,en;q=0.9",
};

/* ---------------- Naive-scraper baseline for Tier 1 ---------------- */
test("no Tier 1 flag leaks into the raw HTML of advanced.html", async () => {
  const ctx = await request.newContext();
  const html = await (await ctx.get(BASE + "/advanced.html")).text();
  for (const flag of [
    "FLAG-GLYPHFONT-d4c7", "FLAG-AESGCM-e60a", "FLAG-POW-7c25", "FLAG-CAPTCHA-3a91",
    "FLAG-SIGNEDTOKEN-b4f8", "FLAG-SESSION-5d13", "FLAG-CURSOR-4b7d", "FLAG-SSE-2d90",
    "FLAG-WEBSOCKET-f719", "FLAG-CANARY-c3b8", "FLAG-HEADERS-c1d7", "FLAG-REFERER-90ce",
    "FLAG-BEHAVIORADV-8ef2",
  ]) {
    expect(html, `raw HTML must not contain ${flag}`).not.toContain(flag);
  }
  // The canary IS present — it is a watermark, not a secret.
  expect(html).toMatch(/CANARY-[0-9a-f]{12}/);
  await ctx.dispose();
});

/* ---------------- 26. CAPTCHA interstitial ---------------- */
test.describe("26. CAPTCHA interstitial", () => {
  test("gated content is refused until the challenge is solved", async () => {
    const ctx = await request.newContext();
    const before = await ctx.get(BASE + "/gated");
    expect(before.status()).toBe(403);
    expect(await before.text()).toContain("Checking your browser");

    const c = await (await ctx.get(BASE + "/api/captcha/new")).json();
    const solved = await ctx.post(BASE + "/api/captcha/solve", { data: { id: c.id, answer: c.a + c.b } });
    expect((await solved.json()).ok).toBe(true);

    // The pass cookie now unlocks it (the context carries the Set-Cookie).
    const after = await ctx.get(BASE + "/gated");
    expect(after.status()).toBe(200);
    expect(await after.text()).toContain("FLAG-CAPTCHA-3a91");
    await ctx.dispose();
  });

  test("a wrong answer is rejected and the challenge is single-use", async () => {
    const ctx = await request.newContext();
    const c = await (await ctx.get(BASE + "/api/captcha/new")).json();
    const bad = await ctx.post(BASE + "/api/captcha/solve", { data: { id: c.id, answer: c.a + c.b + 1 } });
    expect(bad.status()).toBe(403);

    const good = await ctx.post(BASE + "/api/captcha/solve", { data: { id: c.id, answer: c.a + c.b } });
    expect(good.status()).toBe(200);
    const replay = await ctx.post(BASE + "/api/captcha/solve", { data: { id: c.id, answer: c.a + c.b } });
    expect(replay.status()).toBe(400); // consumed
    await ctx.dispose();
  });
});

/* ---------------- 27. Proof of work ---------------- */
test.describe("27. Proof-of-work", () => {
  test("valid nonce unlocks; unsolved nonce is refused", async () => {
    const ctx = await request.newContext();
    const { challenge, difficulty } = await (await ctx.get(BASE + "/api/pow/challenge")).json();

    const bad = await ctx.post(BASE + "/api/pow/verify", { data: { challenge, nonce: 0 } });
    // nonce 0 almost certainly fails the difficulty target
    if (bad.status() === 200) test.skip(true, "nonce 0 happened to solve it");
    expect((await bad.json()).reason).toBe("insufficient-work");

    let nonce = 0;
    const target = "0".repeat(difficulty);
    while (!crypto.createHash("sha256").update(`${challenge}:${nonce}`).digest("hex").startsWith(target)) nonce++;

    const good = await ctx.post(BASE + "/api/pow/verify", { data: { challenge, nonce } });
    expect(good.status()).toBe(200);
    expect((await good.json()).flag).toBe("FLAG-POW-7c25");
    await ctx.dispose();
  });

  test("a solved challenge cannot be replayed", async () => {
    const ctx = await request.newContext();
    const { challenge, difficulty } = await (await ctx.get(BASE + "/api/pow/challenge")).json();
    let nonce = 0;
    const target = "0".repeat(difficulty);
    while (!crypto.createHash("sha256").update(`${challenge}:${nonce}`).digest("hex").startsWith(target)) nonce++;

    expect((await ctx.post(BASE + "/api/pow/verify", { data: { challenge, nonce } })).status()).toBe(200);
    const replay = await ctx.post(BASE + "/api/pow/verify", { data: { challenge, nonce } });
    expect(replay.status()).toBe(403);
    expect((await replay.json()).reason).toBe("unknown-challenge");
    await ctx.dispose();
  });
});

/* ---------------- 28. Glyph cipher font ---------------- */
test.describe("28. Glyph-substitution font", () => {
  test("DOM holds ciphertext, never the plaintext flag", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/advanced.html")).text();
    expect(html).toContain("SYNT.TYLCUSBAG.q9p2");   // ciphertext
    expect(html).not.toContain("FLAG-GLYPHFONT-d4c7"); // never in the markup
    await ctx.dispose();
  });

  test("the font actually remaps glyphs (rendered != DOM text)", async ({ page }) => {
    await page.goto(BASE + "/advanced.html");
    await page.evaluate(() => document.fonts.ready);
    // Same string in the cipher face vs a normal face must render differently.
    const differs = await page.evaluate(() => {
      const draw = (family) => {
        const c = document.createElement("canvas");
        c.width = 300; c.height = 40;
        const ctx = c.getContext("2d");
        ctx.font = `20px "${family}", monospace`;
        ctx.fillText("SYNT.TYLCUSBAG.q9p2", 2, 26);
        return c.toDataURL();
      };
      return draw("ScrapeGuardCipher") !== draw("NoSuchFontFallback");
    });
    expect(differs).toBe(true);
  });
});

/* ---------------- 29. AES-GCM payload ---------------- */
test.describe("29. AES-GCM encrypted payload", () => {
  test("raw response is ciphertext only", async () => {
    const ctx = await request.newContext();
    const body = await (await ctx.get(BASE + "/api/aes")).text();
    expect(body).not.toContain("FLAG-AESGCM-e60a");
    expect(JSON.parse(body)).toHaveProperty("iv");
    await ctx.dispose();
  });

  test("browser decrypts it with crypto.subtle", async ({ page }) => {
    await page.goto(BASE + "/advanced.html");
    await expect(page.locator("#aes-out")).toHaveText("FLAG-AESGCM-e60a", { timeout: 10_000 });
  });
});

/* ---------------- 30. Signed expiring tokens ---------------- */
test.describe("30. HMAC-signed expiring token", () => {
  test("valid token works; forged signature is rejected", async () => {
    const ctx = await request.newContext();
    const { token } = await (await ctx.get(BASE + "/api/token/issue")).json();

    const ok = await ctx.get(BASE + "/api/token/content?token=" + encodeURIComponent(token));
    expect((await ok.json()).flag).toBe("FLAG-SIGNEDTOKEN-b4f8");

    const forged = await ctx.get(BASE + "/api/token/content?token=" +
      encodeURIComponent(token.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    expect(forged.status()).toBe(401);
    expect((await forged.json()).reason).toBe("bad-signature");
    await ctx.dispose();
  });

  test("token expires (cannot be lifted from source and replayed)", async () => {
    const ctx = await request.newContext();
    const { token, ttlMs } = await (await ctx.get(BASE + "/api/token/issue")).json();
    await new Promise((r) => setTimeout(r, ttlMs + 400));
    const late = await ctx.get(BASE + "/api/token/content?token=" + encodeURIComponent(token));
    expect(late.status()).toBe(401);
    expect((await late.json()).reason).toBe("expired");
    await ctx.dispose();
  });
});

/* ---------------- 31. DOM randomization ---------------- */
test("31. class/attribute names differ on every request", async () => {
  const ctx = await request.newContext();
  const grab = async () => {
    const html = await (await ctx.get(BASE + "/advanced.html")).text();
    return (html.match(/class="(x[0-9a-f]{10})/) || [])[1];
  };
  const [a, b] = [await grab(), await grab()];
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a).not.toBe(b); // a selector-pinned scraper breaks here
  await ctx.dispose();
});

/* ---------------- 32/33. Header + referer validation ---------------- */
test.describe("32/33. Request header validation", () => {
  test("an HTTP-library request is rejected", async () => {
    const ctx = await request.newContext({
      extraHTTPHeaders: { "User-Agent": "python-requests/2.31.0" },
    });
    const r = await ctx.get(BASE + "/api/headers/check");
    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.flag).toBe("FLAG-HEADERS-BOT");
    expect(body.signals).toContain("http-library-user-agent");
    expect(body.signals.some((s) => s.startsWith("missing:sec-fetch"))).toBe(true);
    await ctx.dispose();
  });

  // A correctly-ordered browser request passes. Header ORDER is the whole test
  // here: the same header VALUES in the wrong sequence are rejected below.
  test("a correctly-ordered browser request passes", async () => {
    const r = await rawGet("/api/headers/check", CHROME_HEADERS);
    expect(r.status).toBe(200);
    expect(r.body.flag).toBe("FLAG-HEADERS-c1d7");
  });

  test("the same headers in the wrong order are rejected", async () => {
    // Identical values — only Accept-Encoding moves ahead of Accept, the way
    // python-requests emits them. Order alone flips the verdict.
    const reordered = {
      "User-Agent": CHROME_HEADERS["User-Agent"],
      "sec-ch-ua": CHROME_HEADERS["sec-ch-ua"],
      "Accept-Encoding": CHROME_HEADERS["Accept-Encoding"],
      Accept: CHROME_HEADERS.Accept,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Accept-Language": CHROME_HEADERS["Accept-Language"],
    };
    const r = await rawGet("/api/headers/check", reordered);
    expect(r.status).toBe(403);
    expect(r.body.signals).toContain("header-order-mismatch");
  });

  // Playwright-driven Chromium is itself caught here: the automation layer
  // injects Accept-Language out of Chrome's natural position, giving
  //   …user-agent, sec-ch-ua, ACCEPT-LANGUAGE, sec-ch-ua-mobile, accept…
  // instead of vanilla Chrome's …accept-encoding, accept-language (last).
  // This is the guard working, not a false positive — it is exactly the kind
  // of tell a real anti-bot service uses.
  test("Playwright's own header injection is detected", async ({ page }) => {
    await page.goto(BASE + "/advanced.html");
    await expect(page.locator("#headers-out")).toContainText("header-order-mismatch", { timeout: 10_000 });
  });

  test("missing Referer is rejected, browser fetch passes", async ({ page }) => {
    const ctx = await request.newContext();
    const bare = await ctx.get(BASE + "/api/referer/check");
    expect(bare.status()).toBe(403);
    expect((await bare.json()).reason).toBe("no-referer");
    await ctx.dispose();

    await page.goto(BASE + "/advanced.html");
    await expect(page.locator("#referer-out")).toContainText("FLAG-REFERER-90ce", { timeout: 10_000 });
  });
});

/* ---------------- 34. Session + CSRF ---------------- */
test.describe("34. Cookie session + CSRF", () => {
  test("stateless request fails; cookie+CSRF succeeds", async () => {
    const ctx = await request.newContext();
    const cold = await ctx.post(BASE + "/api/session/content");
    expect(cold.status()).toBe(401);
    expect((await cold.json()).reason).toBe("no-session");

    const { csrf } = await (await ctx.get(BASE + "/api/session/new")).json();

    const noCsrf = await ctx.post(BASE + "/api/session/content"); // cookie only
    expect(noCsrf.status()).toBe(403);
    expect((await noCsrf.json()).reason).toBe("missing-csrf");

    const good = await ctx.post(BASE + "/api/session/content", { headers: { "X-CSRF-Token": csrf } });
    expect((await good.json()).flag).toBe("FLAG-SESSION-5d13");
    await ctx.dispose();
  });
});

/* ---------------- 35. Automation artifacts ---------------- */
test("35. automation artifacts are detected under Playwright", async ({ page }) => {
  await page.goto(BASE + "/advanced.html");
  await expect(page.locator("#artifacts-out")).toContainText("FLAG-ARTIFACTS-BOT", { timeout: 10_000 });
});

/* ---------------- 36. Behavioral analysis ---------------- */
test.describe("36. Advanced behavioral scoring", () => {
  test("synthetic telemetry is flagged", async () => {
    const ctx = await request.newContext();
    // Perfectly linear path, uniform 10ms sampling, instant form fill.
    const moves = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: i * 10, t: i * 10 }));
    const r = await ctx.post(BASE + "/api/behavior/score", {
      data: { moves, keys: [0, 100, 200, 300], formMs: 12 },
    });
    const body = await r.json();
    expect(body.bot).toBe(true);
    expect(body.flag).toBe("FLAG-BEHAVIORADV-BOT");
    expect(body.signals).toEqual(
      expect.arrayContaining(["uniform-timing", "perfectly-linear-path", "form-filled-too-fast", "uniform-keystrokes"])
    );
    await ctx.dispose();
  });

  test("human-like telemetry passes", async () => {
    const ctx = await request.newContext();
    // Jittery curve, irregular sampling, plausible typing and fill time.
    const jitter = [0, 17, 39, 56, 68, 85, 107, 124, 136, 153, 175, 192];
    const moves = jitter.map((t, i) => ({
      x: Math.round(i * 9 + Math.sin(i) * 6),
      y: Math.round(i * i * 0.7 + (i % 3)),
      t,
    }));
    const r = await ctx.post(BASE + "/api/behavior/score", {
      data: { moves, keys: [0, 137, 302, 401, 588], formMs: 2400 },
    });
    const body = await r.json();
    expect(body.bot, JSON.stringify(body.signals)).toBe(false);
    expect(body.flag).toBe("FLAG-BEHAVIORADV-8ef2");
    await ctx.dispose();
  });
});

/* ---------------- 37. Cursor pagination ---------------- */
test.describe("37. Signed-cursor pagination", () => {
  test("flag requires walking every page in order", async () => {
    const ctx = await request.newContext();
    let cursor = null, pages = [], flag = null;
    for (let i = 0; i < 5; i++) {
      const r = await (await ctx.get(BASE + "/api/items" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""))).json();
      pages.push(r.page);
      if (r.flag) flag = r.flag;
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    expect(pages).toEqual([0, 1, 2]);
    expect(flag).toBe("FLAG-CURSOR-4b7d"); // only on the last page
    await ctx.dispose();
  });

  test("a forged cursor cannot skip ahead", async () => {
    const ctx = await request.newContext();
    const forged = Buffer.from("cursor|2|" + (Date.now() + 60_000)).toString("base64url") + ".notavalidsignature";
    const r = await ctx.get(BASE + "/api/items?cursor=" + encodeURIComponent(forged));
    expect(r.status()).toBe(403);
    expect((await r.json()).flag).toBe("FLAG-CURSOR-BOT");
    await ctx.dispose();
  });
});

/* ---------------- 38/39. Alternate transports ---------------- */
test("38. SSE delivers content outside any HTML body", async ({ page }) => {
  await page.goto(BASE + "/advanced.html");
  await expect(page.locator("#sse-out")).toHaveText("FLAG-SSE-2d90", { timeout: 10_000 });
});

test("39. WebSocket handshake matches the RFC 6455 test vector", () => {
  const { accept } = require("../lib/websocket");
  expect(accept("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("39. WebSocket releases content only on the right command", async ({ page }) => {
  await page.goto(BASE + "/advanced.html");
  await expect(page.locator("#ws-out")).toHaveText("FLAG-WEBSOCKET-f719", { timeout: 10_000 });

  const wrong = await page.evaluate(() => new Promise((resolve) => {
    const s = new WebSocket(`ws://${location.host}/ws`);
    s.onopen = () => s.send("wrong-command");
    s.onmessage = (e) => { resolve(e.data); s.close(); };
  }));
  expect(wrong).toContain("unknown-command");
});

/* ---------------- 40. Advanced rate limiting ---------------- */
test.describe("40. Advanced rate limiting", () => {
  test.beforeEach(async () => {
    const ctx = await request.newContext();
    await ctx.get(BASE + "/api/rate/reset");
    await ctx.dispose();
  });

  test("sliding window blocks sustained bursts", async () => {
    const ctx = await request.newContext();
    let limitedAt = null;
    for (let i = 1; i <= 10 && limitedAt === null; i++) {
      if ((await ctx.get(BASE + "/api/rate/sliding")).status() === 429) limitedAt = i;
    }
    expect(limitedAt).toBe(6); // max 5
    await ctx.dispose();
  });

  test("token bucket allows a burst then throttles", async () => {
    const ctx = await request.newContext();
    let limitedAt = null;
    for (let i = 1; i <= 10 && limitedAt === null; i++) {
      if ((await ctx.get(BASE + "/api/rate/bucket")).status() === 429) limitedAt = i;
    }
    expect(limitedAt).toBeGreaterThanOrEqual(6); // capacity 5, then refill-limited
    await ctx.dispose();
  });

  test("tarpit slows instead of returning 429", async () => {
    const ctx = await request.newContext();
    const t0 = Date.now();
    let sawSlow = false;
    for (let i = 0; i < 6; i++) {
      const r = await ctx.get(BASE + "/api/rate/tarpit");
      expect(r.status()).toBe(200); // never 429 — no retry schedule leaked
      if ((await r.json()).delayMs > 0) sawSlow = true;
    }
    expect(sawSlow).toBe(true);
    expect(Date.now() - t0).toBeGreaterThan(400); // wall-clock actually burned
    await ctx.dispose();
  });
});

/* ---------------- 41. Canary watermarks ---------------- */
test("41. canary differs per client identity", async () => {
  const a = await request.newContext({ extraHTTPHeaders: { "User-Agent": "client-alpha" } });
  const b = await request.newContext({ extraHTTPHeaders: { "User-Agent": "client-beta" } });
  const ca = (await (await a.get(BASE + "/api/canary")).json()).canary;
  const cb = (await (await b.get(BASE + "/api/canary")).json()).canary;
  expect(ca).toMatch(/^CANARY-[0-9a-f]{12}$/);
  expect(ca).not.toBe(cb); // leaked content is traceable to one fetcher
  await a.dispose(); await b.dispose();
});
