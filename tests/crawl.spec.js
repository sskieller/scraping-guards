// @ts-check
/* Crawling the recipe catalogue.
 *
 * The detail-page tests (recipe.spec.js) ask "can you scrape a page you were
 * given?". These ask the harder question: "can you FIND the pages nobody gave
 * you?" — which is what a crawler actually does.
 *
 * There are three independent routes through the catalogue, and a crawler that
 * finds only one of them must still end up with all eight recipes:
 *   1. index pagination  (?page=N, server-rendered, works without JS)
 *   2. infinite scroll   (the same pages, fetched on scroll)
 *   3. related + prev/next links between detail pages (no index needed)
 * Plus /sitemap.xml as a fourth, flat route.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const data = require("../lib/recipe-data");
const { PER_PAGE } = require("../lib/recipe-page");

const ALL_SLUGS = data.RECIPES.map((r) => r.slug).sort();

const slugsIn = (html) =>
  [...html.matchAll(/href="\/recipe\/([a-z0-9-]+)"/g)].map((m) => m[1]);

/* ---------------- Route 1: pagination, no JS ---------------- */
test.describe("crawl by pagination (no JavaScript)", () => {
  test("a link-following crawler reaches every recipe", async () => {
    const ctx = await request.newContext();
    const found = new Set();
    const visited = new Set();
    const queue = ["/recipes"];

    while (queue.length) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      const html = await (await ctx.get(BASE + url)).text();
      slugsIn(html).forEach((s) => found.add(s));
      for (const m of html.matchAll(/href="(\/recipes\?page=\d+)"/g)) {
        if (!visited.has(m[1])) queue.push(m[1]);
      }
    }

    expect([...found].sort()).toEqual(ALL_SLUGS);
    // 3 index pages + the entry URL; a crawler should not need more.
    expect(visited.size).toBeLessThanOrEqual(5);
    await ctx.dispose();
  });

  test("pagination is complete and non-overlapping", async () => {
    const ctx = await request.newContext();
    const pages = Math.ceil(data.RECIPES.length / PER_PAGE);
    const seen = [];
    for (let p = 1; p <= pages; p++) {
      const html = await (await ctx.get(`${BASE}/recipes?page=${p}`)).text();
      const onPage = [...new Set(slugsIn(html))].filter((s) => !seen.includes(s));
      seen.push(...onPage);
    }
    expect(seen.sort()).toEqual(ALL_SLUGS); // every recipe, exactly once
    await ctx.dispose();
  });

  test("out-of-range pages clamp instead of erroring", async () => {
    const ctx = await request.newContext();
    for (const p of ["0", "-1", "999"]) {
      const r = await ctx.get(`${BASE}/recipes?page=${p}`);
      expect(r.status(), `page=${p}`).toBe(200);
      expect(slugsIn(await r.text()).length).toBeGreaterThan(0);
    }
    await ctx.dispose();
  });
});

/* ---------------- Route 2: infinite scroll ---------------- */
test.describe("crawl by infinite scroll", () => {
  test("scrolling loads every recipe onto page 1", async ({ page }) => {
    // Only the first page is server-rendered — assert that against the raw
    // HTML, not the live DOM: the observer can fire before the first assertion
    // because page 1 is short enough to leave the sentinel already in view.
    const ctx = await request.newContext();
    const rawCards = (await (await ctx.get(BASE + "/recipes")).text()).match(/<li class="card">/g) || [];
    expect(rawCards).toHaveLength(PER_PAGE);
    await ctx.dispose();

    await page.goto(BASE + "/recipes");

    // Scroll until the sentinel reports it is done.
    for (let i = 0; i < 8; i++) {
      await page.locator("#more-cards").scrollIntoViewIfNeeded();
      if (await page.locator('#more-cards[data-done="true"]').count()) break;
      await page.waitForTimeout(200);
    }

    await expect(page.locator("#more-cards")).toContainText("All 8 recipes loaded", { timeout: 10_000 });
    await expect(page.locator("li.card")).toHaveCount(data.RECIPES.length);

    const hrefs = await page.$$eval("a.card-link", (as) =>
      as.map((a) => a.getAttribute("href").replace("/recipe/", ""))
    );
    expect(hrefs.sort()).toEqual(ALL_SLUGS);
  });

  test("scrolling and pagination yield exactly the same set", async ({ page }) => {
    // Scroll route.
    await page.goto(BASE + "/recipes");
    for (let i = 0; i < 8; i++) {
      await page.locator("#more-cards").scrollIntoViewIfNeeded();
      if (await page.locator('#more-cards[data-done="true"]').count()) break;
      await page.waitForTimeout(200);
    }
    const scrolled = (await page.$$eval("a.card-link", (as) =>
      as.map((a) => a.getAttribute("href"))
    )).sort();

    // Pagination route.
    const ctx = await request.newContext();
    const paged = new Set();
    for (let p = 1; p <= Math.ceil(data.RECIPES.length / PER_PAGE); p++) {
      const html = await (await ctx.get(`${BASE}/recipes?page=${p}`)).text();
      slugsIn(html).forEach((s) => paged.add("/recipe/" + s));
    }
    await ctx.dispose();

    expect(scrolled).toEqual([...paged].sort());
  });
});

/* ---------------- Route 3: the detail-page link graph ---------------- */
test.describe("crawl without the index", () => {
  test("related and prev/next links alone connect the whole catalogue", async () => {
    const ctx = await request.newContext();
    const visited = new Set();
    // Start from one leaf recipe, never touching /recipes.
    const queue = ["/recipe/quick-pickled-shallots"];

    while (queue.length) {
      const url = queue.shift();
      const slug = url.replace("/recipe/", "");
      if (visited.has(slug)) continue;
      visited.add(slug);
      const html = await (await ctx.get(BASE + url)).text();
      // Follow only related + prev/next, not the nav or breadcrumbs.
      const links = [...html.matchAll(/<(?:li|nav class="pager")[^>]*>[\s\S]*?<\/(?:li|nav)>/g)]
        .flatMap((m) => slugsIn(m[0]));
      for (const s of new Set(links)) if (!visited.has(s)) queue.push("/recipe/" + s);
    }

    expect([...visited].sort()).toEqual(ALL_SLUGS);
    await ctx.dispose();
  });

  test("every recipe links onward — no dead ends", async () => {
    const ctx = await request.newContext();
    for (const slug of ALL_SLUGS) {
      const html = await (await ctx.get(`${BASE}/recipe/${slug}`)).text();
      const outbound = new Set(slugsIn(html).filter((s) => s !== slug));
      expect(outbound.size, `${slug} is a dead end`).toBeGreaterThan(0);
    }
    await ctx.dispose();
  });
});

/* ---------------- Route 4: sitemap ---------------- */
test("the sitemap lists the index and every recipe", async () => {
  const ctx = await request.newContext();
  const r = await ctx.get(BASE + "/sitemap.xml");
  expect(r.headers()["content-type"]).toContain("xml");
  const xml = await r.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.some((l) => l.endsWith("/recipes"))).toBe(true);
  for (const slug of ALL_SLUGS) {
    expect(locs.some((l) => l.endsWith(`/recipe/${slug}`)), `sitemap missing ${slug}`).toBe(true);
  }
  await ctx.dispose();
});

/* ---------------- The second full recipe ---------------- */
test.describe("second recipe (different yield semantics)", () => {
  const PICI = "pici-ragu-bianco";

  test("scales by PEOPLE, not by item count", async ({ page }) => {
    const pici = data.bySlug(PICI);
    expect(pici.yieldUnit).toBe("servings");
    expect(pici.yieldBase).toBe(4); // the buns page says 12 buns — a hardcoded scraper breaks here

    await page.goto(`${BASE}/recipe/${PICI}`);
    await expect(page.locator("label[for=servings]")).toContainText("How many people");

    const flour = page.locator('.qty[data-qty="400"]').first();
    await expect(flour).toHaveText("400 g");
    await page.selectOption("#servings", "8"); // ×2 from a base of 4
    await expect(flour).toHaveText("800 g");
    await expect(page.locator("#yield-readout")).toHaveText("8");
  });

  test("has its own 20 steps, lazily loaded, distinct from recipe one", async ({ page }) => {
    await page.goto(`${BASE}/recipe/${PICI}`);
    await page.locator("#more-steps").scrollIntoViewIfNeeded();
    await expect(page.locator("li.step")).toHaveCount(20, { timeout: 10_000 });
    await expect(page.locator("#step-20")).toContainText("Finish and serve");

    // Not the buns' step 20.
    const buns = data.RECIPE.steps[19].text;
    await expect(page.locator("#steps")).not.toContainText(buns);
  });

  test("its JSON-LD is its own, and matches its API", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(`${BASE}/recipe/${PICI}`)).text();
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(ld.name).toBe("Hand-Rolled Pici with Ragù Bianco");
    expect(ld.recipeYield).toBe("4 servings");
    expect(ld.recipeInstructions).toHaveLength(20);

    const api = await (await ctx.get(`${BASE}/api/recipe?slug=${PICI}`)).json();
    expect(ld.recipeInstructions.map((s) => s.text)).toEqual(api.steps.map((s) => s.text));
    await ctx.dispose();
  });
});

/* ---------------- Catalogue-wide invariants ---------------- */
test.describe("every recipe in the catalogue", () => {
  test("renders, and short ones have no lazy-load sentinel", async () => {
    const ctx = await request.newContext();
    for (const recipe of data.RECIPES) {
      const r = await ctx.get(`${BASE}/recipe/${recipe.slug}`);
      expect(r.status(), recipe.slug).toBe(200);
      const html = await r.text();
      expect(html).toContain(recipe.title);

      const hasSentinel = html.includes('id="more-steps"');
      const shouldLazyLoad = recipe.steps.length > 15;
      // A short recipe that advertised a lazy loader would hang forever.
      expect(hasSentinel, `${recipe.slug} sentinel mismatch`).toBe(shouldLazyLoad);

      const rendered = (html.match(/class="r[0-9a-f]+ step"/g) || []).length;
      expect(rendered).toBe(Math.min(recipe.steps.length, 15));
    }
    await ctx.dispose();
  });

  test("carries canonical and prev/next link relations", async () => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(`${BASE}/recipe/${data.RECIPES[1].slug}`)).text();
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/recipe\/pici-ragu-bianco">/);
    expect(html).toMatch(/<link rel="prev"/);
    expect(html).toMatch(/<link rel="next"/);
    await ctx.dispose();
  });

  test("an unknown slug 404s with a route back to the index", async () => {
    const ctx = await request.newContext();
    const r = await ctx.get(BASE + "/recipe/no-such-recipe");
    expect(r.status()).toBe(404);
    expect(await r.text()).toContain('href="/recipes"');
    await ctx.dispose();
  });

  test("the API exposes the whole catalogue and paginates identically", async () => {
    const ctx = await request.newContext();
    const all = await (await ctx.get(BASE + "/api/recipes")).json();
    expect(all.total).toBe(data.RECIPES.length);
    expect(all.recipes.map((r) => r.slug).sort()).toEqual(ALL_SLUGS);

    const page1 = await (await ctx.get(BASE + "/api/recipes?page=1")).json();
    expect(page1.recipes).toHaveLength(PER_PAGE);
    expect(page1.nextPage).toBe(2);

    const last = await (await ctx.get(`${BASE}/api/recipes?page=${page1.pages}`)).json();
    expect(last.nextPage).toBeNull();
    await ctx.dispose();
  });
});
