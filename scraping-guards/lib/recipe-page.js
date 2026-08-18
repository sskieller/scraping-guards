/* Renders the recipe page from lib/recipe-data.js.
 *
 * Server-rendered on purpose: the DOM, the JSON API and the JSON-LD block all
 * come from one object, so a scraper that trusts structured data and one that
 * parses the DOM must arrive at the same answer. Recipe sites that hand-maintain
 * their JSON-LD routinely drift, and that drift is a bug this page should not have.
 *
 * Guards deliberately left ON here, because a real site would have them:
 *   1  content injected by JS   — nutrition panel
 *   6  lazy load on scroll      — steps 16-20
 *  14  honeypot link           — the off-screen "printer-friendly" link
 *  31  DOM randomization       — ingredient/step class names
 *  41  canary watermark        — per-client comment
 *  78  text watermark          — recipient encoded in the story prose
 * Everything else is left off so the page reads as an ordinary recipe.
 */
"use strict";
const crypto = require("crypto");
const { RECIPE } = require("./recipe-data");
const watermark = require("./watermark");

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SERVING_OPTIONS = [6, 12, 18, 24, 36, 48];
const SERVER_RENDERED_STEPS = 15; // the rest arrive on scroll (guard 6)

/* schema.org/Recipe — the structured-data path most recipe scrapers take first. */
function jsonLd(baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: RECIPE.title,
    description: RECIPE.subtitle,
    author: { "@type": "Organization", name: RECIPE.author },
    datePublished: RECIPE.published,
    dateModified: RECIPE.updated,
    recipeYield: `${RECIPE.yieldBase} ${RECIPE.yieldUnit}`,
    recipeCuisine: RECIPE.cuisine,
    recipeCategory: RECIPE.category,
    prepTime: `PT${RECIPE.times.prep}M`,
    cookTime: `PT${RECIPE.times.bake}M`,
    totalTime: `PT${RECIPE.times.total}M`,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: RECIPE.rating.value,
      ratingCount: RECIPE.rating.count,
    },
    image: [`${baseUrl}/assets/recipe/hero.svg`],
    recipeIngredient: RECIPE.ingredientGroups.flatMap((g) =>
      g.items.map((i) => `${i.qty}${i.unit ? " " + i.unit : ""} ${i.name}`.trim())
    ),
    recipeInstructions: RECIPE.steps.map((s) => ({
      "@type": "HowToStep",
      position: s.n,
      name: s.title,
      text: s.text,
    })),
    nutrition: {
      "@type": "NutritionInformation",
      servingSize: "1 bun",
      calories: `${RECIPE.nutrition.calories} kcal`,
      fatContent: `${RECIPE.nutrition.fat} g`,
      carbohydrateContent: `${RECIPE.nutrition.carbs} g`,
      proteinContent: `${RECIPE.nutrition.protein} g`,
    },
  };
}

function render({ sid, canary, account = "anonymous", baseUrl = "" } = {}) {
  const cls = () => "r" + crypto.randomBytes(4).toString("hex"); // guard 31
  const cIng = cls(), cStep = cls(), cQty = cls();

  const ingredientsHtml = RECIPE.ingredientGroups.map((g) => `
        <div class="ing-group">
          <h3>${esc(g.name)}</h3>
          <ul class="${cIng}">
            ${g.items.map((i) => `
            <li>
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
        <li class="${cStep} step" id="step-${s.n}" value="${s.n}">
          <h3><span class="step-n">${s.n}</span> ${esc(s.title)}</h3>
          <p>${esc(s.text)}</p>
        </li>`;

  const stepsHtml = RECIPE.steps.slice(0, SERVER_RENDERED_STEPS).map(stepHtml).join("");

  // Guard 78: the recipient rides invisibly inside the prose.
  const story = RECIPE.story
    .map((p, i) => `<p>${esc(i === 0 ? watermark.embed(p, "acct:" + account.slice(0, 12)) : p)}</p>`)
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(RECIPE.title)} — Test Kitchen</title>
<meta name="description" content="${esc(RECIPE.subtitle)}">
<link rel="stylesheet" href="/assets/recipe.css">
<script type="application/ld+json">${JSON.stringify(jsonLd(baseUrl), null, 2)}</script>
</head>
<body data-sid="${esc(sid)}" data-base-yield="${RECIPE.yieldBase}">
<!-- ${esc(canary)} -->
<header class="site">
  <a class="brand" href="/recipe">Test Kitchen</a>
  <nav><a href="/recipe">Recipes</a> <a href="/docs">Method</a> <a href="/marketing">About</a></nav>
</header>

<article class="recipe">
  <figure class="hero">
    <img src="/assets/recipe/hero.svg" width="1200" height="630"
         alt="Illustration of a tray of knotted cardamom buns scattered with pearl sugar">
    <figcaption>Twelve knots, one tray, about four hours including the cold rise.</figcaption>
  </figure>

  <h1>${esc(RECIPE.title)}</h1>
  <p class="subtitle">${esc(RECIPE.subtitle)}</p>

  <p class="byline">
    By <span class="author">${esc(RECIPE.author)}</span> ·
    Updated <time datetime="${RECIPE.updated}">${RECIPE.updated}</time> ·
    <span class="rating" aria-label="Rated ${RECIPE.rating.value} out of 5 from ${RECIPE.rating.count} ratings">
      ★ ${RECIPE.rating.value} <span class="rating-count">(${RECIPE.rating.count})</span>
    </span>
  </p>

  <dl class="meta">
    <div><dt>Prep</dt><dd>${RECIPE.times.prep} min</dd></div>
    <div><dt>Proof</dt><dd>${RECIPE.times.proof} min</dd></div>
    <div><dt>Bake</dt><dd>${RECIPE.times.bake} min</dd></div>
    <div><dt>Total</dt><dd>${Math.floor(RECIPE.times.total / 60)} h ${RECIPE.times.total % 60} min</dd></div>
    <div><dt>Makes</dt><dd><span id="yield-readout">${RECIPE.yieldBase}</span> ${esc(RECIPE.yieldUnit)}</dd></div>
    <div><dt>Cuisine</dt><dd>${esc(RECIPE.cuisine)}</dd></div>
  </dl>

  <section class="story">
    <h2>Before you start</h2>
    ${story}
  </section>

  <section class="calculator">
    <h2>Scale the recipe</h2>
    <p class="hint">Quantities update as you change this. Yeast, salt and the flaky
       salt are held back deliberately — they do not scale linearly, and a straight
       multiplication makes an inedible bun.</p>
    <label for="servings">How many buns?</label>
    <select id="servings" name="servings">
      ${SERVING_OPTIONS.map((n) => `<option value="${n}"${n === RECIPE.yieldBase ? " selected" : ""}>${n} buns</option>`).join("\n      ")}
    </select>
    <output id="scale-note" for="servings">×1 — as written</output>
  </section>

  <section class="ingredients">
    <h2>Ingredients</h2>
    ${ingredientsHtml}
    <p class="hint footnote">* Held at the written amount when you scale — these
       do not scale linearly. Adjust by judgement, not arithmetic.</p>
  </section>

  <section class="equipment">
    <h2>Equipment</h2>
    <ul>${RECIPE.equipment.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
  </section>

  <section class="method">
    <h2>Method</h2>
    <ol class="steps" id="steps">${stepsHtml}</ol>

    <figure class="diagram">
      <img src="/assets/recipe/knot.svg" width="900" height="300" loading="lazy"
           alt="Three-panel diagram: cut a strip, twist it, then wind and tuck it into a knot">
      <figcaption>Step 17, the part that reads badly in words.</figcaption>
    </figure>

    <p id="more-steps" class="loading">Loading the remaining steps…</p>
  </section>

  <section class="notes">
    <h2>Notes</h2>
    <ul>${RECIPE.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
  </section>

  <section class="nutrition">
    <h2>Nutrition</h2>
    <p class="hint">Per bun, at the recipe's base yield.</p>
    <div id="nutrition-panel">Loading…</div>
  </section>

  <!-- Guard 14. Off-screen and removed from the accessibility tree, so no
       human or screen-reader user can reach it; a link-greedy crawler will. -->
  <a class="honeypot" href="/trap?src=recipe" rel="nofollow" tabindex="-1" aria-hidden="true">Printer-friendly version</a>
</article>

<footer class="site">
  <p>Fixture page for the scraping-guards suite — the recipe is invented.
     See <a href="/frontier.html">the guard pages</a>.</p>
</footer>

<script src="/assets/recipe.js"></script>
</body>
</html>`;
}

module.exports = { render, jsonLd, SERVER_RENDERED_STEPS, SERVING_OPTIONS };
