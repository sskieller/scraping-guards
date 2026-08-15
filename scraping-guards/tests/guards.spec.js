// @ts-check
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";

/* ------------------------------------------------------------------ *
 * A) Naive scraper view: raw HTML only, no JS. Asserts which flags a
 *    plain HTTP fetch (curl / requests / BeautifulSoup) can and cannot see.
 * ------------------------------------------------------------------ */
test.describe("naive scraper (raw HTML, no JS)", () => {
  let html;
  test.beforeAll(async () => {
    const ctx = await request.newContext();
    html = await (await ctx.get(BASE + "/index.html")).text();
    await ctx.dispose();
  });

  test("sees baseline + static-obfuscated flags", () => {
    expect(html).toContain("FLAG-BASELINE-0000");
    expect(html).toContain("FLAG-REAL-a90c");        // decoy: real one is in the DOM
  });

  test("cannot see JS/encoded/rendered flags in raw HTML", () => {
    for (const absent of [
      "FLAG-JSRENDER-7f3a",   // injected by JS
      "FLAG-BASE64-9ad2",     // only base64 present
      "FLAG-ROT13-e7f4",      // only ROT13 present
      "FLAG-CANVAS-4e1d",     // pixels, not text (only in data-attr)
      "FLAG-SHADOW-c7e0",     // shadow DOM
      "FLAG-CSSPSEUDO-b21c",  // in stylesheet ::after
      "FLAG-APITOKEN-8b04",   // behind token API
      "FLAG-IFRAME-6a2d",     // nested document
    ]) {
      expect(html, `raw HTML must not contain ${absent}`).not.toContain(absent);
    }
  });

  test("obfuscated flags are present only in scrambled form", () => {
    expect(html).toContain("a7f9-DESREVER-GALF");       // reversed, not readable
    expect(html).toContain("RkxBRy1CQVNFNjQtOWFkMg=="); // base64 blob, not decoded
    expect(html).not.toContain("FLAG-DESREVER"); // the readable form is never present
  });

  test("decoy poisoning: raw HTML contains the FAKE flag (naive scraper is poisoned)", () => {
    // Both are in the DOM; only the visible one is real. A parser that ignores
    // CSS visibility harvests the honeypot decoy.
    expect(html).toContain("FLAG-DECOY-FAKE-ffff");
    expect(html).toContain("FLAG-REAL-a90c");
  });
});

/* ------------------------------------------------------------------ *
 * B) JS-capable headful-ish browser: asserts guards resolve when JS runs.
 * ------------------------------------------------------------------ */
test.describe("JS-capable browser", () => {
  test("resolves JS / encoded / rendered content", async ({ page }) => {
    await page.goto(BASE + "/index.html");

    await expect(page.locator("#js-slot")).toHaveText("FLAG-JSRENDER-7f3a");
    await expect(page.locator("#b64-slot")).toHaveText("FLAG-BASE64-9ad2");
    await expect(page.locator("#rot-slot")).toHaveText("FLAG-ROT13-e7f4");

    // Shadow DOM (light-DOM query can't reach it; shadow query can).
    const shadowText = await page.evaluate(
      () => document.getElementById("shadow-host").shadowRoot.textContent.trim()
    );
    expect(shadowText).toBe("FLAG-SHADOW-c7e0");

    // CSS ::after content.
    const pseudo = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".pseudo-secret"), "::after").content
    );
    expect(pseudo).toContain("FLAG-CSSPSEUDO-b21c");

    // Iframe content.
    const frame = page.frameLocator("#frame");
    await expect(frame.locator(".flag")).toHaveText("FLAG-IFRAME-6a2d");
  });

  test("time-gated content appears after delay", async ({ page }) => {
    await page.goto(BASE + "/index.html");
    await expect(page.locator("#timed-slot")).toHaveText("FLAG-TIMED-5c2a", { timeout: 4000 });
  });

  test("lazy content loads on scroll", async ({ page }) => {
    await page.goto(BASE + "/index.html");
    await page.locator("#lazy-slot").scrollIntoViewIfNeeded();
    await expect(page.locator("#lazy-slot")).toHaveText("FLAG-LAZY-1b8f");
  });

  test("interaction-gated content needs a click", async ({ page }) => {
    await page.goto(BASE + "/index.html");
    await expect(page.locator("#reveal-slot")).toHaveText("[click required]");
    await page.locator("#reveal-btn").click();
    await expect(page.locator("#reveal-slot")).toHaveText("FLAG-CLICK-9d63");
  });

  test("canvas exposes text only as pixels", async ({ page }) => {
    await page.goto(BASE + "/index.html");
    // The text is drawn, so the canvas is non-blank, but no DOM text node holds it.
    const nonBlank = await page.evaluate(() => {
      const c = document.getElementById("canvas-slot");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return d.some((v, i) => i % 4 === 3 && v !== 0); // any opaque pixel
    });
    expect(nonBlank).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * C) Bot-detection: a stock automated browser trips the heuristics.
 * ------------------------------------------------------------------ */
test.describe("bot detection heuristics", () => {
  test("navigator.webdriver is detected under automation", async ({ page }) => {
    await page.goto(BASE + "/index.html");
    // Playwright sets navigator.webdriver=true.
    await expect(page.locator("#wd-verdict")).toContainText("FLAG-WEBDRIVER-BOT");
  });

  test("token-gated API returns content only with the header", async () => {
    const ctx = await request.newContext();
    const noHeader = await ctx.get(BASE + "/api/protected");
    expect(noHeader.status()).toBe(401);

    const withHeader = await ctx.get(BASE + "/api/protected", {
      headers: { "X-Scrape-Token": "issued-by-js-42" },
    });
    expect(await withHeader.text()).toContain("FLAG-APITOKEN-8b04");
    await ctx.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * D) Server-side honeypots & rate limiting.
 * ------------------------------------------------------------------ */
test.describe("server-side guards", () => {
  test("honeypot trap path flags bots with 403", async () => {
    const ctx = await request.newContext();
    const r = await ctx.get(BASE + "/trap");
    expect(r.status()).toBe(403);
    expect(await r.text()).toContain("FLAG-TRAP-DONOTFOLLOW");
    await ctx.dispose();
  });

  test("honeypot form field rejects filled bot submissions", async () => {
    const ctx = await request.newContext();
    const bot = await ctx.post(BASE + "/submit", { form: { name: "x", website: "http://spam" } });
    expect(bot.status()).toBe(400);
    expect(await bot.text()).toContain("FLAG-HPFIELD-BOT");

    const human = await ctx.post(BASE + "/submit", { form: { name: "x", website: "" } });
    expect(human.status()).toBe(200);
    await ctx.dispose();
  });

  test("rate limiter returns 429 after the window max", async () => {
    const ctx = await request.newContext();
    let got429 = false;
    for (let i = 0; i < 8; i++) {
      const r = await ctx.get(BASE + "/api/rated");
      if (r.status() === 429) { got429 = true; expect(await r.text()).toContain("FLAG-RATELIMIT-429"); break; }
    }
    expect(got429).toBe(true);
    await ctx.dispose();
  });

  test("robots.txt disallows the trap and api paths", async () => {
    const ctx = await request.newContext();
    const txt = await (await ctx.get(BASE + "/robots.txt")).text();
    expect(txt).toContain("Disallow: /trap");
    expect(txt).toContain("Disallow: /api/");
    await ctx.dispose();
  });
});
