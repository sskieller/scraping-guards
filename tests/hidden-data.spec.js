// @ts-check
/* The five hidden-data extraction routes.
 *
 * webscraping.fyi's "Find Hidden Data" lesson lists five places structured data
 * hides in an ordinary page: JSON-LD, the hydration blob, meta tags,
 * microdata/RDFa, and data-* attributes. A scraper that learns to read them
 * skips the DOM entirely — which is the point of practising against them.
 *
 * Two properties are worth asserting, and neither is obvious:
 *   1. All five routes agree. If they disagreed, a scraper could not tell which
 *      one to trust, and the fixture would be teaching the wrong lesson.
 *   2. All five work with JavaScript switched off. The guards on this page
 *      withhold content from raw HTTP clients; these routes hand it straight
 *      back. That contradiction is deliberate and real sites ship it daily.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const { RECIPE } = require("../lib/recipe-data");
const { SERVER_RENDERED_STEPS } = require("../lib/recipe-page");

/* Deliberately a raw HTTP fetch, never a browser: every assertion below has to
 * hold for a client that cannot run a line of JavaScript. */
const getHtml = async (path = "/recipe") => {
  const ctx = await request.newContext();
  const html = await (await ctx.get(BASE + path)).text();
  await ctx.dispose();
  return html;
};

const jsonLd = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m, "route 1: JSON-LD block").toBeTruthy();
  return JSON.parse(m[1]);
};

const hydration = (html) => {
  const m = html.match(/<script id="__INITIAL_STATE__" type="application\/json">([\s\S]*?)<\/script>/);
  expect(m, "route 2: hydration blob").toBeTruthy();
  return JSON.parse(m[1]);
};

const meta = (html, key) => {
  const m = html.match(
    new RegExp(`<meta (?:property|name)="${key.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`)
  );
  return m && m[1];
};

const itemprops = (html, name) => {
  const re = new RegExp(`itemprop="${name}"[^>]*>([^<]*)`, "g");
  return [...html.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
};

/* ---------------- Each route on its own ---------------- */

test("route 1: JSON-LD carries the complete recipe", async () => {
  const ld = jsonLd(await getHtml());
  expect(ld["@type"]).toBe("Recipe");
  expect(ld.name).toBe(RECIPE.title);
  expect(ld.recipeInstructions).toHaveLength(RECIPE.steps.length);
});

test("route 2: the hydration blob carries fields the page never renders", async () => {
  const state = hydration(await getHtml());
  const r = state.props.pageProps.recipe;

  // The DOM ships only the first few steps and fetches nutrition over XHR.
  // The hydration blob hands over both, to a client that ran no JavaScript.
  expect(r.steps).toHaveLength(RECIPE.steps.length);
  expect(r.steps.length).toBeGreaterThan(SERVER_RENDERED_STEPS);
  expect(r.nutrition.calories).toBe(RECIPE.nutrition.calories);
  expect(state.buildId).toBe("sg-" + RECIPE.slug);
});

test("route 3: Open Graph, Twitter and product meta tags", async () => {
  const html = await getHtml();
  expect(meta(html, "og:title")).toBe(RECIPE.title);
  expect(meta(html, "og:type")).toBe("article");
  expect(meta(html, "og:image")).toMatch(/hero\.svg/);
  expect(meta(html, "twitter:card")).toBe("summary_large_image");
  expect(meta(html, "article:published_time")).toBe(RECIPE.published);

  // Price scrapers target exactly this pair.
  expect(meta(html, "product:price:amount")).toMatch(/^\d+\.\d{2}$/);
  expect(meta(html, "product:price:currency")).toBe("EUR");
});

test("route 4: microdata annotates the visible DOM", async () => {
  const html = await getHtml();
  expect(html).toContain('itemtype="https://schema.org/Recipe"');
  expect(html).toContain('itemtype="https://schema.org/HowToStep"');

  expect(itemprops(html, "name")[0]).toBe(RECIPE.title);
  // Counted by attribute, not by text: an annotated <li> wraps its quantity in
  // a nested <span>, so the itemprop element's own first text node is empty.
  expect(html.match(/itemprop="recipeIngredient"/g)).toHaveLength(
    RECIPE.ingredientGroups.reduce((n, g) => n + g.items.length, 0)
  );

  // Microdata decorates what is *rendered*, so it stops where lazy loading
  // does. That is the honest difference between routes 1-3 and routes 4-5:
  // the first three describe the resource, the last two describe the page.
  const steps = html.match(/itemprop="recipeInstructions"/g) || [];
  expect(steps).toHaveLength(SERVER_RENDERED_STEPS);
});

test("route 5: data-* attributes carry the machine-readable quantities", async () => {
  const html = await getHtml();
  expect(html).toMatch(/data-base-yield="\d+"/);
  expect(html).toMatch(new RegExp(`data-slug="${RECIPE.slug}"`));

  // Each ingredient's quantity, unit and scalability, parsed rather than
  // regexed out of "2 tbsp". This is the route the yield calculator itself uses.
  const qty = [...html.matchAll(/data-qty="([\d.]+)"\s+data-unit="([^"]*)"\s+data-scalable="(true|false)"/g)];
  expect(qty.length).toBe(RECIPE.ingredientGroups.reduce((n, g) => n + g.items.length, 0));
  expect(qty.some(([, , , s]) => s === "false"), "some ingredient must be non-scalable").toBe(true);
});

/* ---------------- The routes against each other ---------------- */

test("all five routes agree on the facts they share", async () => {
  const html = await getHtml();
  const ld = jsonLd(html);
  const state = hydration(html).props.pageProps.recipe;

  const titles = [ld.name, state.title, meta(html, "og:title"), itemprops(html, "name")[0]];
  expect(new Set(titles).size, `titles disagree: ${JSON.stringify(titles)}`).toBe(1);

  // Ingredients: JSON-LD's flat list, the hydration blob's grouped list, and
  // the microdata annotations must describe the same set.
  const fromState = state.ingredientGroups.flatMap((g) => g.items.map((i) => i.name));
  expect(fromState.length).toBe(ld.recipeIngredient.length);
  for (const name of fromState) {
    expect(ld.recipeIngredient.join(" | ")).toContain(name);
  }

  // Steps: routes 1 and 2 are complete, route 4 is truncated by lazy loading.
  expect(ld.recipeInstructions.length).toBe(state.steps.length);
  expect(itemprops(html, "text").length).toBeLessThan(state.steps.length);
});

test("every route survives with JavaScript disabled", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(BASE + "/recipe");

  // With no JS, the DOM is missing steps 4-20 and the nutrition panel...
  await expect(page.locator("#nutrition-panel")).toContainText("Loading");

  // ...yet four of the five routes are sitting in the markup untouched.
  const html = await page.content();
  expect(jsonLd(html).recipeInstructions).toHaveLength(RECIPE.steps.length);
  expect(hydration(html).props.pageProps.recipe.nutrition.calories).toBe(RECIPE.nutrition.calories);
  expect(meta(html, "og:title")).toBe(RECIPE.title);
  expect(html).toContain('itemtype="https://schema.org/Recipe"');
  expect(html).toMatch(/data-qty="/);

  await ctx.close();
});

test("the hydration blob and the API agree — no drift between the two paths", async () => {
  const state = hydration(await getHtml()).props.pageProps.recipe;
  const ctx = await request.newContext();
  const api = await (await ctx.get(BASE + "/api/recipe?slug=" + RECIPE.slug)).json();
  const nutrition = await (await ctx.get(BASE + "/api/recipe/nutrition?slug=" + RECIPE.slug)).json();
  await ctx.dispose();

  expect(state.title).toBe(api.title);
  expect(state.steps.length).toBe(api.steps.length);
  expect(state.nutrition.calories).toBe(nutrition.calories);
});

/* ---------------- The hidden API ---------------- */
/* The routes the page's own JavaScript calls. Finding them is a matter of
 * opening the network tab, and once found they hand over clean JSON that is
 * subject to none of the presentation-layer guards — because those guards
 * exist to make *HTML* hard to parse, and the API is not HTML.
 *
 * This is not a flaw in the fixture; it is the most common real-world hole. A
 * team hardens its rendered pages and leaves the endpoint feeding them wide
 * open, because the endpoint is "internal".
 */
test.describe("the hidden API bypasses the presentation-layer guards", () => {
  const api = async (path) => {
    const ctx = await request.newContext();
    const r = await ctx.get(BASE + path);
    const body = await r.json();
    await ctx.dispose();
    return { status: r.status(), body };
  };

  test("guard 1 (js-render): no JavaScript engine required", async () => {
    const { status, body } = await api("/api/recipe?slug=" + RECIPE.slug);
    expect(status).toBe(200);
    expect(body.title).toBe(RECIPE.title);
  });

  test("guard 6 (lazy-load): all steps in one request, no scrolling", async () => {
    const { body } = await api("/api/recipe?slug=" + RECIPE.slug);
    expect(body.steps).toHaveLength(RECIPE.steps.length);
    expect(body.steps.length).toBeGreaterThan(SERVER_RENDERED_STEPS);

    // Nutrition, which the page fetches over XHR after render, is one GET away.
    const n = await api("/api/recipe/nutrition?slug=" + RECIPE.slug);
    expect(n.body.calories).toBe(RECIPE.nutrition.calories);
  });

  test("guards 31 and 58 (dom-randomization, ssr-variance): the shape is stable", async () => {
    // The HTML renames its classes and reshuffles its nesting on every
    // response. The JSON does neither — two calls are byte-identical, so a
    // selector written once keeps working.
    const [a, b] = [await api("/api/recipe?slug=" + RECIPE.slug), await api("/api/recipe?slug=" + RECIPE.slug)];
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));

    const ctx = await request.newContext();
    const [h1, h2] = [
      await (await ctx.get(BASE + "/recipe")).text(),
      await (await ctx.get(BASE + "/recipe")).text(),
    ];
    await ctx.dispose();
    const cls = (h) => (h.match(/class="(r[0-9a-f]+) step"/) || [])[1];
    expect(cls(h1)).not.toBe(cls(h2));  // HTML: unstable by design
  });

  test("guard 57 (fragmentation): values arrive whole, not split across decoys", async () => {
    const { body } = await api("/api/recipe?slug=" + RECIPE.slug);
    // In the HTML, a quantity is scattered over random spans with hidden
    // decoys between them; here it is a number and a unit.
    const first = body.ingredientGroups[0].items[0];
    expect(typeof first.qty).toBe("number");
    expect(first).toHaveProperty("scalable");
  });

  test("the API even does the scaling the client calculator does", async () => {
    // Worth being explicit about: the endpoint is not just a data leak, it is
    // a *compute* leak. The scraper does not have to reimplement the yield
    // logic — including which ingredients refuse to scale.
    const { body } = await api(`/api/recipe?slug=${RECIPE.slug}&yield=${RECIPE.yieldBase * 2}`);
    const held = body.ingredientGroups.flatMap((g) => g.items).filter((i) => i.scalable === false);
    expect(held.length).toBeGreaterThan(0);
    expect(body.notes || body.scalingNotes || "").toBeTruthy();
  });
});
