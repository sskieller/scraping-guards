// @ts-check
/* The recipe fixture — a semi-real scraping target.
 *
 * These tests are written from the scraper's point of view: what can a raw HTTP
 * client get, what needs a browser, and where do the two disagree? That
 * disagreement is the useful part — real recipe sites create it accidentally.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const { RECIPE, scaled } = require("../lib/recipe-data");
const watermark = require("../lib/watermark");
const { SERVER_RENDERED_STEPS } = require("../lib/recipe-page");

const getHtml = async () => {
  const ctx = await request.newContext();
  const html = await (await ctx.get(BASE + "/recipe")).text();
  await ctx.dispose();
  return html;
};

/* ---------------- Structured data ---------------- */
test.describe("structured data", () => {
  test("JSON-LD is valid schema.org/Recipe and complete", async () => {
    const html = await getHtml();
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m, "page must carry a JSON-LD block").toBeTruthy();
    const ld = JSON.parse(m[1]);

    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.name).toBe(RECIPE.title);
    expect(ld.recipeInstructions).toHaveLength(20);
    expect(ld.recipeInstructions[0]["@type"]).toBe("HowToStep");
    expect(ld.recipeIngredient.length).toBe(
      RECIPE.ingredientGroups.reduce((n, g) => n + g.items.length, 0)
    );
    expect(ld.prepTime).toMatch(/^PT\d+M$/);
    expect(ld.aggregateRating.ratingValue).toBe(RECIPE.rating.value);
  });

  test("JSON-LD agrees with the API — no drift between the two paths", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(BASE + "/recipe")).text();
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const api = await (await ctx.get(BASE + "/api/recipe")).json();

    expect(ld.recipeInstructions.map((s) => s.text)).toEqual(api.steps.map((s) => s.text));
    expect(ld.recipeYield).toBe(`${api.yieldBase} ${api.yieldUnit}`);
    await ctx.dispose();
  });
});

/* ---------------- What a raw HTTP client gets ---------------- */
test.describe("naive scraper (raw HTML)", () => {
  test("gets the prose, ingredients and only the server-rendered steps", async () => {
    const html = await getHtml();
    expect(html).toContain(RECIPE.title);
    expect(html).toContain("bread flour");
    // Steps 1-15 are rendered as markup; 16-20 arrive on scroll.
    const rendered = (html.match(/class="r[0-9a-f]+ step"/g) || []).length;
    expect(rendered).toBe(SERVER_RENDERED_STEPS);

    // The <ol> genuinely stops at 15 — check the rendered list, not the whole page.
    const list = html.match(/<ol class="steps" id="steps">([\s\S]*?)<\/ol>/)[1];
    expect(list).toContain(RECIPE.steps[0].text);
    expect(list).not.toContain(RECIPE.steps[19].text);
  });

  // The most useful thing this fixture demonstrates. A site adds lazy loading
  // for performance, then publishes complete JSON-LD for SEO — and the JSON-LD
  // hands a scraper everything the lazy loading was withholding, with no browser
  // required. Real recipe sites do this constantly.
  test("JSON-LD leaks what lazy loading withholds — no JS needed", async () => {
    const html = await getHtml();
    const list = html.match(/<ol class="steps" id="steps">([\s\S]*?)<\/ol>/)[1];
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

    // Step 20 is absent from the DOM...
    expect(list).not.toContain(RECIPE.steps[19].text);
    // ...and present in full in the structured data on the very same response.
    expect(ld.recipeInstructions).toHaveLength(20);
    expect(ld.recipeInstructions[19].text).toBe(RECIPE.steps[19].text);
    // Same story for the JS-fetched nutrition panel.
    expect(html).not.toContain('<table class="nutrition-table"');
    expect(ld.nutrition.calories).toBe(`${RECIPE.nutrition.calories} kcal`);
  });

  test("only ever sees the BASE quantities, never a scaled one", async () => {
    const html = await getHtml();
    expect(html).toContain(">400 g<");  // flour at the base yield of 12
    expect(html).not.toContain(">800 g<"); // what 24 buns would need
    // The scaling inputs are in the DOM, so a determined scraper can compute it.
    expect(html).toMatch(/data-qty="400"[^>]*data-scalable="true"/);
  });

  test("class names are randomized per response", async () => {
    const [a, b] = [await getHtml(), await getHtml()];
    const cls = (h) => (h.match(/class="(r[0-9a-f]+) step"/) || [])[1];
    expect(cls(a)).toBeTruthy();
    expect(cls(a)).not.toBe(cls(b));
  });

  test("the honeypot is present but unreachable by humans", async () => {
    const html = await getHtml();
    expect(html).toMatch(/honeypot[^>]*href="\/trap\?src=recipe"/);
    expect(html).toMatch(/honeypot[^>]*aria-hidden="true"/);
    expect(html).toMatch(/honeypot[^>]*tabindex="-1"/);
  });

  test("each response carries a per-client watermark and canary", async () => {
    const ctx = await request.newContext();
    const one = await (await ctx.get(BASE + "/recipe", { headers: { "X-API-Key": "alice" } })).text();
    const two = await (await ctx.get(BASE + "/recipe", { headers: { "X-API-Key": "bob" } })).text();
    const story = (h) => h.match(/<section class="story">([\s\S]*?)<\/section>/)[1];

    expect(watermark.extract(story(one))).toBe("acct:alice");
    expect(watermark.extract(story(two))).toBe("acct:bob");
    // Visible prose is identical — the mark is invisible.
    expect(watermark.strip(story(one))).toBe(watermark.strip(story(two)));
    expect(one).toMatch(/<!-- CANARY-[0-9a-f]{12} -->/);
    await ctx.dispose();
  });
});

/* ---------------- The servings calculator ---------------- */
test.describe("servings calculator", () => {
  test("scaling doubles the scalable quantities in the DOM", async ({ page }) => {
    await page.goto(BASE + "/recipe");
    const flour = page.locator('.qty[data-qty="400"]');
    await expect(flour).toHaveText("400 g");

    await page.selectOption("#servings", "24");
    await expect(flour).toHaveText("800 g");
    await expect(page.locator("#yield-readout")).toHaveText("24");
    await expect(page.locator("#scale-note")).toContainText("×2");

    await page.selectOption("#servings", "6");
    await expect(flour).toHaveText("200 g");
  });

  test("non-linear ingredients are held back, not multiplied", async ({ page }) => {
    await page.goto(BASE + "/recipe");
    const yeast = page.locator('.qty[data-scalable="false"][data-qty="7"]');
    await expect(yeast).toHaveText("7 g");
    await page.selectOption("#servings", "48"); // ×4
    // A naive scraper would report 28 g and produce something inedible.
    await expect(yeast).toHaveText("7 g");
    await expect(yeast).toHaveClass(/fixed/);
  });

  test("the client calculator matches the server's scaling exactly", async ({ page }) => {
    await page.goto(BASE + "/recipe");
    for (const target of [6, 18, 24, 36]) {
      await page.selectOption("#servings", String(target));
      const domQuantities = await page.$$eval(".qty", (els) => els.map((e) => e.textContent.trim()));
      const serverQuantities = scaled(target).flatMap((g) =>
        g.items.map((i) => `${i.qty}${i.unit ? " " + i.unit : ""}`)
      );
      expect(domQuantities, `mismatch at yield ${target}`).toEqual(serverQuantities);
    }
  });
});

/* ---------------- Browser-only content ---------------- */
test.describe("JS-capable browser", () => {
  test("all 20 steps are present after the lazy load", async ({ page }) => {
    await page.goto(BASE + "/recipe");
    await page.locator("#more-steps").scrollIntoViewIfNeeded();
    await expect(page.locator("li.step")).toHaveCount(20, { timeout: 10_000 });
    await expect(page.locator("#step-20")).toContainText("Syrup while hot");
    await expect(page.locator("#more-steps")).toContainText("All 20 steps loaded");
  });

  test("nutrition is rendered only after a JS fetch", async ({ page }) => {
    const html = await getHtml();
    // Absent from the rendered markup (though the JSON-LD still carries it —
    // see the leak test above).
    expect(html).not.toContain('<table class="nutrition-table"');
    expect(html).toContain('<div id="nutrition-panel">Loading…</div>');

    await page.goto(BASE + "/recipe");
    await expect(page.locator(".nutrition-table")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".nutrition-table")).toContainText(`${RECIPE.nutrition.calories} kcal`);
  });

  test("both illustrations load and are real SVG", async ({ page }) => {
    const ctx = await request.newContext();
    for (const name of ["hero", "knot"]) {
      const r = await ctx.get(`${BASE}/assets/recipe/${name}.svg`);
      expect(r.status(), name).toBe(200);
      expect(r.headers()["content-type"]).toContain("image/svg+xml");
      const body = await r.text();
      expect(body).toMatch(/^<svg[\s>]/);
      expect(body).toContain("</svg>");
      expect(body, `${name} needs an accessible label`).toContain("aria-label");
    }
    await ctx.dispose();

    await page.goto(BASE + "/recipe");
    const heroLoaded = await page.evaluate(() => {
      const img = document.querySelector(".hero img");
      return img && img.complete && img.naturalWidth > 0;
    });
    expect(heroLoaded).toBe(true);
  });
});

/* ---------------- The JSON API ---------------- */
test.describe("recipe API", () => {
  test("scales on demand and explains what it refused to scale", async () => {
    const ctx = await request.newContext();
    const r = await (await ctx.get(BASE + "/api/recipe?yield=36")).json();
    expect(r.requestedYield).toBe(36);

    const dough = r.ingredientGroups.find((g) => g.name === "Dough");
    const flour = dough.items.find((i) => i.name.startsWith("bread flour"));
    expect(flour.qty).toBe(1200);      // 400 × 3
    expect(flour.factor).toBe(3);

    const yeast = dough.items.find((i) => i.name.includes("yeast"));
    expect(yeast.qty).toBe(7);
    expect(yeast.scaled).toBe(false);
    expect(yeast.reason).toContain("does not scale linearly");
    await ctx.dispose();
  });

  test("rejects an out-of-range yield instead of returning nonsense", async () => {
    const ctx = await request.newContext();
    for (const bad of ["0", "-5", "9999", "abc"]) {
      const r = await ctx.get(`${BASE}/api/recipe?yield=${bad}`);
      expect(r.status(), `yield=${bad}`).toBe(400);
    }
    await ctx.dispose();
  });

  test("the steps endpoint supports the lazy-load offset", async () => {
    const ctx = await request.newContext();
    const rest = await (await ctx.get(BASE + "/api/recipe/steps?from=16")).json();
    expect(rest.steps).toHaveLength(5);
    expect(rest.steps[0].n).toBe(16);
    const all = await (await ctx.get(BASE + "/api/recipe/steps")).json();
    expect(all.steps).toHaveLength(20);
    await ctx.dispose();
  });
});

/* ---------------- Fixture integrity ---------------- */
test("the recipe data is internally consistent", () => {
  expect(RECIPE.steps).toHaveLength(20);
  // Steps must be numbered 1..20 with no gaps — the page renders by slice.
  expect(RECIPE.steps.map((s) => s.n)).toEqual([...Array(20).keys()].map((i) => i + 1));
  for (const s of RECIPE.steps) {
    expect(s.title.length, `step ${s.n} needs a title`).toBeGreaterThan(3);
    expect(s.text.length, `step ${s.n} needs real text`).toBeGreaterThan(40);
  }
  for (const g of RECIPE.ingredientGroups) {
    expect(g.items.length).toBeGreaterThan(0);
    for (const i of g.items) {
      expect(typeof i.qty).toBe("number");
      expect(typeof i.scalable).toBe("boolean");
    }
  }
});
