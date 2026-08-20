/* Renders the recipe pages and the catalogue index from lib/recipe-data.js.
 *
 * Server-rendered on purpose: the DOM, the JSON API and the JSON-LD block all
 * come from one object, so a scraper that trusts structured data and one that
 * parses the DOM must arrive at the same answer. Recipe sites that hand-maintain
 * their JSON-LD routinely drift, and that drift is a bug this page should not have.
 *
 * Guards deliberately left ON here, because a real site would have them:
 *   1  content injected by JS   — nutrition panel, lazily-listed cards
 *   6  lazy load on scroll      — the tail of the steps, and index pages 2+
 *  14  honeypot link           — the off-screen "printer-friendly" link
 *  31  DOM randomization       — ingredient/step class names
 *  41  canary watermark        — per-client comment
 *  78  text watermark          — recipient encoded in the story prose
 * Everything else is left off so the pages read as an ordinary recipe site.
 *
 * The index exists so a crawler has a link graph to traverse. There are three
 * independent routes to every recipe — index pagination, related links, and
 * prev/next — plus a sitemap. A crawler that finds only one of them still
 * reaches the whole catalogue, which is what makes partial-crawl testing useful.
 */
"use strict";
const crypto = require("crypto");
const data = require("./recipe-data");
const watermark = require("./watermark");

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SERVER_RENDERED_STEPS = 15; // the rest arrive on scroll (guard 6)
const PER_PAGE = 3;               // small, so pagination actually has to be walked

const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/* schema.org/Recipe — the structured-data path most recipe scrapers take first. */
function jsonLd(recipe, baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.subtitle,
    author: { "@type": "Organization", name: recipe.author },
    datePublished: recipe.published,
    dateModified: recipe.updated,
    recipeYield: `${recipe.yieldBase} ${recipe.yieldUnit}`,
    recipeCuisine: recipe.cuisine,
    recipeCategory: recipe.category,
    keywords: (recipe.tags || []).join(", "),
    prepTime: `PT${recipe.times.prep}M`,
    cookTime: `PT${recipe.times.bake}M`,
    totalTime: `PT${recipe.times.total}M`,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: recipe.rating.value,
      ratingCount: recipe.rating.count,
    },
    image: [`${baseUrl}/assets/recipe/hero.svg?r=${recipe.slug}`],
    recipeIngredient: recipe.ingredientGroups.flatMap((g) =>
      g.items.map((i) => `${i.qty}${i.unit ? " " + i.unit : ""} ${i.name}`.trim())
    ),
    recipeInstructions: recipe.steps.map((s) => ({
      "@type": "HowToStep", position: s.n, name: s.title, text: s.text,
    })),
    nutrition: {
      "@type": "NutritionInformation",
      servingSize: recipe.nutrition.perBun ? "1 bun" : "1 serving",
      calories: `${recipe.nutrition.calories} kcal`,
      fatContent: `${recipe.nutrition.fat} g`,
      carbohydrateContent: `${recipe.nutrition.carbs} g`,
      proteinContent: `${recipe.nutrition.protein} g`,
    },
  };
}

/* The same recipe, in the shapes a scraper actually looks for.
 *
 * webscraping.fyi lists five routes to "hidden data": JSON-LD, JS hydration
 * state, meta tags, microdata/RDFa, and data-* attributes. A real site tends to
 * emit several of them without noticing, and every one is a complete bypass of
 * whatever the DOM is doing — no browser required. This fixture emits all five,
 * from one object, so a scraper can be tested against each path independently
 * and a test can prove they all agree.
 */

/* Route 2: the hydration blob. Next.js calls it __NEXT_DATA__, Nuxt calls it
 * __NUXT__, hand-rolled apps call it __INITIAL_STATE__. Whatever the name, it
 * is usually the *complete* server state, including fields the page never
 * renders — which is why it is the first thing an experienced scraper greps
 * for. Ours behaves the same way: it carries all 20 steps and the nutrition
 * the DOM withholds. */
function hydrationState(recipe) {
  return {
    props: {
      pageProps: {
        recipe: {
          slug: recipe.slug,
          title: recipe.title,
          subtitle: recipe.subtitle,
          yieldBase: recipe.yieldBase,
          yieldUnit: recipe.yieldUnit,
          rating: recipe.rating,
          times: recipe.times,
          ingredientGroups: recipe.ingredientGroups,
          steps: recipe.steps,
          nutrition: recipe.nutrition,
        },
      },
    },
    buildId: "sg-" + recipe.slug,
  };
}

/* Route 3: Open Graph, Twitter Card and product metadata. */
function metaTags(recipe, baseUrl) {
  const price = (recipe.times.total / 10).toFixed(2); // stands in for a commerce field
  return [
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(recipe.title)}">`,
    `<meta property="og:description" content="${esc(recipe.subtitle)}">`,
    `<meta property="og:url" content="${baseUrl}/recipe/${recipe.slug}">`,
    `<meta property="og:image" content="${baseUrl}/assets/recipe/hero.svg?r=${recipe.slug}">`,
    `<meta property="og:site_name" content="Test Kitchen">`,
    `<meta property="article:published_time" content="${recipe.published}">`,
    `<meta property="article:modified_time" content="${recipe.updated}">`,
    `<meta property="article:section" content="${esc(recipe.category)}">`,
    ...(recipe.tags || []).map((t) => `<meta property="article:tag" content="${esc(t)}">`),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(recipe.title)}">`,
    `<meta name="twitter:description" content="${esc(recipe.subtitle)}">`,
    // A commerce-shaped field, because these are what price scrapers target.
    `<meta property="product:price:amount" content="${price}">`,
    `<meta property="product:price:currency" content="EUR">`,
  ].join("\n");
}

const chrome = (inner, { title, description, extraHead = "" }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/assets/recipe.css">
${extraHead}
</head>
${inner}
</html>`;

const siteHeader = `
<header class="site">
  <a class="brand" href="/recipes">Test Kitchen</a>
  <nav><a href="/recipes">All recipes</a> <a href="/docs">Method</a> <a href="/marketing">About</a></nav>
</header>`;

const siteFooter = `
<footer class="site">
  <p>Fixture pages for the scraping-guards suite — the recipes are invented.
     See <a href="/frontier.html">the guard pages</a> and
     <a href="/sitemap.xml">the sitemap</a>.</p>
</footer>`;

/* ------------------------------------------------------------------ *
 * Detail page
 * ------------------------------------------------------------------ */
function render(recipe, { sid, canary, account = "anonymous", baseUrl = "" } = {}) {
  const cls = () => "r" + crypto.randomBytes(4).toString("hex"); // guard 31
  const cIng = cls(), cStep = cls(), cQty = cls();
  const options = recipe.yieldOptions || [recipe.yieldBase];
  const lazySteps = recipe.steps.length > SERVER_RENDERED_STEPS;

  const ingredientsHtml = recipe.ingredientGroups.map((g) => `
        <div class="ing-group">
          <h3>${esc(g.name)}</h3>
          <ul class="${cIng}">
            ${g.items.map((i) => `
            <li itemprop="recipeIngredient">
              <span class="${cQty} qty"
                    data-qty="${i.qty}"
                    data-unit="${esc(i.unit)}"
                    data-scalable="${i.scalable}">${i.qty}${i.unit ? " " + esc(i.unit) : ""}</span>
              <span class="ing-name">${esc(i.name)}</span>
              ${i.note ? `<em class="ing-note">${esc(i.note)}</em>` : ""}
            </li>`).join("")}
          </ul>
        </div>`).join("");

  const stepHtml = (s) => `
        <li class="${cStep} step" id="step-${s.n}" value="${s.n}"
            itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
          <meta itemprop="position" content="${s.n}">
          <h3><span class="step-n">${s.n}</span> <span itemprop="name">${esc(s.title)}</span></h3>
          <p itemprop="text">${esc(s.text)}</p>
        </li>`;

  const stepsHtml = recipe.steps.slice(0, SERVER_RENDERED_STEPS).map(stepHtml).join("");

  // Guard 78: the recipient rides invisibly inside the prose.
  const story = recipe.story
    .map((p, i) => `<p>${esc(i === 0 ? watermark.embed(p, "acct:" + account.slice(0, 12)) : p)}</p>`)
    .join("\n        ");

  const rel = data.related(recipe.slug);
  const { prev, next } = data.neighbours(recipe.slug);

  const body = `
<body data-sid="${esc(sid)}" data-base-yield="${recipe.yieldBase}" data-slug="${esc(recipe.slug)}">
<!-- ${esc(canary)} -->
${siteHeader}

<nav class="crumbs" aria-label="Breadcrumb">
  <a href="/recipes">All recipes</a> ›
  <a href="/recipes?category=${encodeURIComponent(recipe.category)}">${esc(recipe.category)}</a> ›
  <span aria-current="page">${esc(recipe.title)}</span>
</nav>

<article class="recipe" itemscope itemtype="https://schema.org/Recipe">
  <figure class="hero">
    <img src="/assets/recipe/hero.svg?r=${esc(recipe.slug)}" width="1200" height="630"
         alt="Illustration for ${esc(recipe.title)}">
    <figcaption>${esc(recipe.subtitle)}.</figcaption>
  </figure>

  <h1 itemprop="name">${esc(recipe.title)}</h1>
  <p class="subtitle" itemprop="description">${esc(recipe.subtitle)}</p>
  <meta itemprop="recipeYield" content="${recipe.yieldBase} ${esc(recipe.yieldUnit)}">
  <meta itemprop="recipeCategory" content="${esc(recipe.category)}">
  <meta itemprop="recipeCuisine" content="${esc(recipe.cuisine)}">
  <meta itemprop="totalTime" content="PT${recipe.times.total}M">

  <p class="byline">
    By <span class="author" itemprop="author">${esc(recipe.author)}</span> ·
    Updated <time datetime="${recipe.updated}">${recipe.updated}</time> ·
    <span class="rating" aria-label="Rated ${recipe.rating.value} out of 5 from ${recipe.rating.count} ratings">
      ★ ${recipe.rating.value} <span class="rating-count">(${recipe.rating.count})</span>
    </span>
  </p>

  <dl class="meta">
    <div><dt>Prep</dt><dd>${recipe.times.prep} min</dd></div>
    <div><dt>Cook</dt><dd>${recipe.times.bake} min</dd></div>
    <div><dt>Total</dt><dd>${mins(recipe.times.total)}</dd></div>
    <div><dt>Makes</dt><dd><span id="yield-readout">${recipe.yieldBase}</span> ${esc(recipe.yieldUnit)}</dd></div>
    <div><dt>Cuisine</dt><dd>${esc(recipe.cuisine)}</dd></div>
    <div><dt>Steps</dt><dd>${recipe.steps.length}</dd></div>
  </dl>

  <section class="story">
    <h2>Before you start</h2>
    ${story}
  </section>

  <section class="calculator">
    <h2>Scale the recipe</h2>
    <p class="hint">Quantities update as you change this. Salt, yeast and raising
       agents are held back deliberately — they do not scale linearly.</p>
    <label for="servings">${esc(recipe.yieldQuestion || "How many servings?")}</label>
    <select id="servings" name="servings">
      ${options.map((n) => `<option value="${n}"${n === recipe.yieldBase ? " selected" : ""}>${n} ${esc(recipe.yieldUnit)}</option>`).join("\n      ")}
    </select>
    <output id="scale-note" for="servings">×1 — as written</output>
  </section>

  <section class="ingredients">
    <h2>Ingredients</h2>
    ${ingredientsHtml}
    <p class="hint footnote">* Held at the written amount when you scale — these
       do not scale linearly. Adjust by judgement, not arithmetic.</p>
  </section>
${recipe.equipment.length ? `
  <section class="equipment">
    <h2>Equipment</h2>
    <ul>${recipe.equipment.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
  </section>` : ""}

  <section class="method">
    <h2>Method</h2>
    <ol class="steps" id="steps">${stepsHtml}</ol>
${recipe.slug === "brown-butter-cardamom-buns" ? `
    <figure class="diagram">
      <img src="/assets/recipe/knot.svg" width="900" height="300" loading="lazy"
           alt="Three-panel diagram: cut a strip, twist it, then wind and tuck it into a knot">
      <figcaption>Step 17, the part that reads badly in words.</figcaption>
    </figure>` : ""}
${lazySteps ? `    <p id="more-steps" class="loading">Loading the remaining steps…</p>` : ""}
  </section>
${recipe.notes.length ? `
  <section class="notes">
    <h2>Notes</h2>
    <ul>${recipe.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
  </section>` : ""}

  <section class="nutrition">
    <h2>Nutrition</h2>
    <p class="hint">Per ${recipe.nutrition.perBun ? "bun" : "serving"}, at the recipe's base yield.</p>
    <div id="nutrition-panel" data-slug="${esc(recipe.slug)}">Loading…</div>
  </section>

  <!-- Guard 14. Off-screen and removed from the accessibility tree, so no
       human or screen-reader user can reach it; a link-greedy crawler will. -->
  <a class="honeypot" href="/trap?src=${esc(recipe.slug)}" rel="nofollow" tabindex="-1" aria-hidden="true">Printer-friendly version</a>
</article>

<nav class="related" aria-label="Related recipes">
  <h2>You might also like</h2>
  <ul>${rel.map((r) => `<li><a href="${r.url}">${esc(r.title)}</a></li>`).join("")}</ul>
</nav>

<nav class="pager" aria-label="Recipe navigation">
  ${prev ? `<a class="prev" rel="prev" href="${prev.url}">← ${esc(prev.title)}</a>` : "<span></span>"}
  ${next ? `<a class="next" rel="next" href="${next.url}">${esc(next.title)} →</a>` : "<span></span>"}
</nav>
${siteFooter}
<!-- Route 2: hydration state. Carries the complete server state — including
     the steps and nutrition the DOM withholds until you scroll or run JS. -->
<script id="__INITIAL_STATE__" type="application/json">${JSON.stringify(hydrationState(recipe))}</script>
<script>window.__INITIAL_STATE__ = JSON.parse(document.getElementById("__INITIAL_STATE__").textContent);</script>
<script src="/assets/recipe.js"></script>
</body>`;

  return chrome(body, {
    title: `${recipe.title} — Test Kitchen`,
    description: recipe.subtitle,
    extraHead: `${metaTags(recipe, baseUrl)}
<link rel="canonical" href="${baseUrl}/recipe/${recipe.slug}">
${prev ? `<link rel="prev" href="${baseUrl}${prev.url}">` : ""}
${next ? `<link rel="next" href="${baseUrl}${next.url}">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd(recipe, baseUrl), null, 2)}</script>`,
  });
}

/* ------------------------------------------------------------------ *
 * Catalogue index — paginated AND lazy-loading
 *
 * Both paths are deliberate. `?page=N` links are server-rendered so a
 * JS-less crawler can walk the whole catalogue; the same pages also load on
 * scroll for a browser. A crawler taking either route must end up with the
 * same eight recipes, and a test asserts exactly that.
 * ------------------------------------------------------------------ */
function cardHtml(c) {
  return `
      <li class="card">
        <a class="card-link" href="${c.url}">
          <img src="/assets/recipe/hero.svg?r=${esc(c.slug)}" width="1200" height="630"
               loading="lazy" alt="Illustration for ${esc(c.title)}">
          <h3>${esc(c.title)}</h3>
        </a>
        <p class="card-sub">${esc(c.subtitle)}</p>
        <p class="card-meta">
          <span class="rating">★ ${c.rating.value}</span> ·
          ${esc(c.category)} · ${mins(c.totalTime)} · ${c.steps} steps
        </p>
      </li>`;
}

function renderIndex({ page = 1, perPage = PER_PAGE, category = null, canary = "", baseUrl = "" } = {}) {
  let all = data.catalogue();
  if (category) all = all.filter((c) => c.category.toLowerCase() === String(category).toLowerCase());

  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const slice = all.slice((current - 1) * perPage, current * perPage);
  const qs = (n) => `/recipes?page=${n}${category ? `&category=${encodeURIComponent(category)}` : ""}`;

  const body = `
<body data-page="${current}" data-pages="${pages}" data-total="${all.length}"${category ? ` data-category="${esc(category)}"` : ""}>
<!-- ${esc(canary)} -->
${siteHeader}

<h1>All recipes</h1>
<p class="subtitle">${all.length} recipes${category ? ` in ${esc(category)}` : ""} — page ${current} of ${pages}.</p>

<ul class="cards" id="cards">${slice.map(cardHtml).join("")}</ul>

<p id="more-cards" class="loading"${current >= pages ? ' hidden' : ""}>Loading more recipes…</p>

<nav class="pagination" aria-label="Pagination">
  ${current > 1 ? `<a rel="prev" href="${qs(current - 1)}">← Previous</a>` : "<span></span>"}
  <span class="pages">
    ${Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
      n === current ? `<strong aria-current="page">${n}</strong>` : `<a href="${qs(n)}">${n}</a>`
    ).join(" ")}
  </span>
  ${current < pages ? `<a rel="next" href="${qs(current + 1)}">Next →</a>` : "<span></span>"}
</nav>
${siteFooter}
<script src="/assets/recipe.js"></script>
</body>`;

  return chrome(body, {
    title: `All recipes — Test Kitchen${category ? ` (${category})` : ""}`,
    description: `${all.length} recipes from the Test Kitchen fixture.`,
    extraHead: `<link rel="canonical" href="${baseUrl}${qs(current)}">
${current > 1 ? `<link rel="prev" href="${baseUrl}${qs(current - 1)}">` : ""}
${current < pages ? `<link rel="next" href="${baseUrl}${qs(current + 1)}">` : ""}
<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "All recipes",
      numberOfItems: all.length,
      itemListElement: slice.map((c, i) => ({
        "@type": "ListItem",
        position: (current - 1) * perPage + i + 1,
        url: `${baseUrl}${c.url}`,
        name: c.title,
      })),
    }, null, 2)}</script>`,
  });
}

function sitemap(baseUrl) {
  const urls = [
    { loc: `${baseUrl}/recipes`, priority: "1.0" },
    ...data.catalogue().map((c) => ({ loc: `${baseUrl}${c.url}`, priority: "0.8" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>`;
}

module.exports = { render, renderIndex, sitemap, jsonLd, SERVER_RENDERED_STEPS, PER_PAGE };
