/* Recipe fixture: a realistic scraping target.
 *
 * Recipe sites are the canonical scraping victim — structured data, a long
 * preamble nobody wants, quantities that change with a servings control, and
 * numbered steps. That makes this the most useful "semi-real" page in the repo:
 * a scraper that works here is doing something like real work.
 *
 * Single source of truth. The HTML page, the JSON API and the JSON-LD block are
 * all rendered from this object, so they can never disagree — which matters,
 * because a scraper that trusts JSON-LD over the DOM should get the same answer.
 *
 * The content is invented. Any resemblance to a specific published recipe is
 * accidental; it exists to be scraped, not cooked from.
 */
"use strict";

const RECIPE = {
  slug: "brown-butter-cardamom-buns",
  title: "Brown Butter Cardamom Buns",
  subtitle: "Kardemummabullar, the long way round",
  author: "Test Kitchen",
  published: "2026-03-14",
  updated: "2026-08-12",
  rating: { value: 4.7, count: 218 },
  cuisine: "Scandinavian",
  category: "Baking",
  tags: ["baking", "slow", "sweet", "weekend"],
  yieldQuestion: "How many buns?",
  yieldOptions: [6, 12, 18, 24, 36, 48],
  yieldBase: 12,          // the recipe as written makes 12 buns
  yieldUnit: "buns",
  times: { prep: 45, proof: 150, bake: 22, total: 217 }, // minutes

  story: [
    "Every cardamom bun recipe promises you can do it in an afternoon. This one " +
    "does not. The dough wants a slow cold rise, the butter wants to be browned " +
    "and then cooled back to a paste, and the cardamom wants to be cracked from " +
    "whole pods about ten minutes before it goes anywhere near flour.",

    "What you get for that trouble is a bun with an actual crumb — layered rather " +
    "than bready, closer to a laminated dough than a cinnamon roll. The tangzhong " +
    "starter is the part people skip and the part that matters most: cooking a " +
    "small portion of the flour with milk into a paste lets the dough carry far " +
    "more liquid without turning slack, which is what keeps the finished bun soft " +
    "three days later.",

    "A note on the cardamom. Pre-ground is not the same ingredient. It loses the " +
    "eucalyptus note within weeks of grinding, and that note is the entire point " +
    "of the bun. Buy pods, crack them, discard the husks, and grind the seeds " +
    "coarsely — you want visible flecks, not dust.",
  ],

  equipment: [
    "Stand mixer with dough hook (or 20 minutes of patience)",
    "Mortar and pestle, or a spice grinder",
    "Small saucepan with a light-coloured base — you need to see the butter colour",
    "Instant-read thermometer",
    "Rolling pin",
    "Two half-sheet pans with parchment",
    "Digital scale — volume measures will not work for the tangzhong",
  ],

  /* Quantities are per the base yield of 12. `scalable: false` marks the things
   * that do not scale linearly — salt, yeast and spice all need judgement, and a
   * naive x4 makes an inedible bun. A scraper that multiplies everything gets
   * that wrong, which is exactly the sort of thing this page exists to test. */
  ingredientGroups: [
    {
      name: "Tangzhong starter",
      items: [
        { qty: 20, unit: "g", name: "bread flour", scalable: true },
        { qty: 100, unit: "ml", name: "whole milk", scalable: true },
      ],
    },
    {
      name: "Dough",
      items: [
        { qty: 400, unit: "g", name: "bread flour", note: "plus more for dusting", scalable: true },
        { qty: 180, unit: "ml", name: "whole milk, at 36°C", scalable: true },
        { qty: 90, unit: "g", name: "caster sugar", scalable: true },
        { qty: 80, unit: "g", name: "unsalted butter, softened", scalable: true },
        { qty: 1, unit: "", name: "large egg", scalable: true },
        { qty: 7, unit: "g", name: "instant yeast", note: "do not scale linearly past 24 buns", scalable: false },
        { qty: 6, unit: "g", name: "fine sea salt", scalable: false },
        { qty: 12, unit: "", name: "green cardamom pods", note: "≈4 g seed once husked", scalable: true },
      ],
    },
    {
      name: "Brown butter filling",
      items: [
        { qty: 120, unit: "g", name: "unsalted butter", scalable: true },
        { qty: 100, unit: "g", name: "light brown sugar", scalable: true },
        { qty: 8, unit: "", name: "green cardamom pods", note: "ground separately from the dough batch", scalable: true },
        { qty: 1, unit: "tsp", name: "ground cinnamon", scalable: true },
        { qty: 2, unit: "g", name: "flaky salt", scalable: false },
      ],
    },
    {
      name: "Syrup and finish",
      items: [
        { qty: 60, unit: "g", name: "caster sugar", scalable: true },
        { qty: 60, unit: "ml", name: "water", scalable: true },
        { qty: 2, unit: "", name: "cardamom pods, lightly crushed", scalable: true },
        { qty: 30, unit: "g", name: "pearl sugar", note: "for the tops", scalable: true },
      ],
    },
  ],

  steps: [
    { n: 1, title: "Crack the cardamom", text: "Split 20 pods with the flat of a knife. Discard the husks and grind the seeds coarsely — visible flecks, not dust. Keep the dough batch and the filling batch separate." },
    { n: 2, title: "Cook the tangzhong", text: "Whisk 20 g flour into 100 ml milk in a small pan. Cook over medium-low, stirring constantly, until it thickens to a loose paste that holds a line when you drag the whisk through, about 3 minutes. It should reach roughly 65°C." },
    { n: 3, title: "Cool it", text: "Scrape into the mixer bowl and spread up the sides to cool. It must be below 30°C before the yeast goes anywhere near it. This takes about 15 minutes; do not rush it with the fridge, which makes it seize." },
    { n: 4, title: "Warm the milk", text: "Bring 180 ml milk to 36°C — warm to the fingertip, not hot. Above 45°C you start killing yeast, and the difference is invisible until the dough fails to rise." },
    { n: 5, title: "Combine the wet", text: "Add the warm milk, egg, sugar and yeast to the cooled tangzhong. Whisk by hand until the sugar has mostly dissolved." },
    { n: 6, title: "Add the dry", text: "Add the flour, salt and the dough batch of cardamom. Mix on low with the dough hook for 2 minutes, just until no dry flour remains." },
    { n: 7, title: "Autolyse", text: "Stop the mixer and rest the dough, covered, for 20 minutes. The flour hydrates and the gluten begins to organise itself without any work from you." },
    { n: 8, title: "Knead", text: "Mix on medium for 8–10 minutes. The dough will look wrong — slack, tacky, clinging to the bowl — for the first 6 minutes. Do not add flour. It comes together suddenly." },
    { n: 9, title: "Butter in stages", text: "With the mixer running, add the softened butter 20 g at a time, waiting for each addition to disappear before the next. Total about 6 minutes. The dough will loosen and then re-tighten." },
    { n: 10, title: "Windowpane test", text: "Stretch a walnut of dough between your fingers. It should thin to translucency without tearing. If it tears, mix another 2 minutes and test again." },
    { n: 11, title: "Cold rise", text: "Cover and refrigerate for at least 4 hours, ideally overnight. Cold dough is what makes the lamination possible — at room temperature the butter filling simply merges into the crumb." },
    { n: 12, title: "Brown the butter", text: "Melt 120 g butter over medium heat. It will foam, quieten, then throw brown flecks and smell like toasted hazelnut — roughly 6 minutes. Pour it out immediately, solids and all; the residual pan heat will take it to burnt in seconds." },
    { n: 13, title: "Cool to paste", text: "Chill the brown butter until it sets to the texture of soft peanut butter, then beat in the brown sugar, filling cardamom, cinnamon and flaky salt. Liquid butter will run out of the bun; paste will not." },
    { n: 14, title: "Roll", text: "Roll the cold dough to a 40 × 30 cm rectangle, long side facing you. Work quickly and keep it cold." },
    { n: 15, title: "Fill and fold", text: "Spread the filling over the whole surface. Fold the left third over the middle, then the right third over that, like a letter. You now have three layers." },
    { n: 16, title: "Cut strips", text: "Trim the short edges square, then cut into 12 strips about 3 cm wide, cutting through all three layers." },
    { n: 17, title: "Twist and knot", text: "Stretch a strip gently, twist it 4–5 times, then wind it around two fingers and tuck the tail underneath. Untidy is fine; tight is not — a knot with no slack cannot expand." },
    { n: 18, title: "Second proof", text: "Space the knots well apart on lined trays. Prove at warm room temperature for 60–90 minutes, until visibly puffed and slow to spring back when pressed." },
    { n: 19, title: "Bake", text: "Bake at 200°C fan for 18–22 minutes, rotating the trays at the halfway point, until deep golden. Pale buns are underbaked buns; the filling needs the colour." },
    { n: 20, title: "Syrup while hot", text: "Simmer the syrup sugar, water and crushed pods for 2 minutes. Brush the buns generously the moment they leave the oven, scatter with pearl sugar, and leave 10 minutes before eating." },
  ],

  notes: [
    "Make-ahead: the dough holds in the fridge for 48 hours. Flavour improves; rise slows.",
    "Freezing: freeze shaped, unproved knots. Thaw and prove from frozen, adding about an hour.",
    "Storage: airtight, 3 days. Refresh at 160°C for 4 minutes — they come back almost completely.",
    "Substitutions: plain flour works but the crumb is softer and tears more easily when knotting.",
  ],

  nutrition: { perBun: true, calories: 384, fat: 17, saturates: 10, carbs: 51, sugars: 22, protein: 6, salt: 0.7 },
};

/* ---------- Catalogue ---------------------------------------------------
 * A crawler needs somewhere to crawl. RECIPE stays the default export used by
 * the original detail-page tests; RECIPES is the full set behind the index. */
const { PICI, SHORTS } = require("./recipe-catalogue");

const RECIPES = [RECIPE, PICI, ...SHORTS];

const bySlug = (slug) => RECIPES.find((r) => r.slug === slug) || null;

/* Cards for the index: just enough to render a listing, no steps. */
function catalogue() {
  return RECIPES.map((r) => ({
    slug: r.slug, title: r.title, subtitle: r.subtitle,
    cuisine: r.cuisine, category: r.category, tags: r.tags || [],
    rating: r.rating, totalTime: r.times.total,
    steps: r.steps.length,
    yield: `${r.yieldBase} ${r.yieldUnit}`,
    url: `/recipe/${r.slug}`,
  }));
}

/* Related recipes, for the cross-links between detail pages. Shared tags
 * first, then same category — so the link graph is connected rather than a
 * set of islands, which is what makes crawl-depth testing meaningful. */
function related(slug, limit = 3) {
  const self = bySlug(slug);
  if (!self) return [];
  const tags = new Set(self.tags || []);
  return RECIPES
    .filter((r) => r.slug !== slug)
    .map((r) => ({
      r,
      score: (r.tags || []).filter((t) => tags.has(t)).length +
             (r.category === self.category ? 1 : 0) +
             (r.cuisine === self.cuisine ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.r.slug.localeCompare(b.r.slug))
    .slice(0, limit)
    .map(({ r, score }) => ({ slug: r.slug, title: r.title, url: `/recipe/${r.slug}`, score }));
}

/* Previous/next in catalogue order — a second, independent path through the
 * graph, so a crawler that misses the index can still walk the whole set. */
function neighbours(slug) {
  const i = RECIPES.findIndex((r) => r.slug === slug);
  if (i < 0) return { prev: null, next: null };
  const at = (j) => (RECIPES[j] ? { slug: RECIPES[j].slug, title: RECIPES[j].title, url: `/recipe/${RECIPES[j].slug}` } : null);
  return { prev: at(i - 1), next: at(i + 1) };
}

/* Scale one ingredient to a target yield. Non-scalable items are returned
 * unchanged, with the reason attached, so an API consumer can see the rule
 * rather than silently getting the wrong number. */
function scaleItem(item, targetYield, baseYield = RECIPE.yieldBase) {
  if (!item.scalable) {
    return { ...item, scaled: false, reason: "does not scale linearly — adjust by taste/judgement" };
  }
  const factor = targetYield / baseYield;
  const raw = item.qty * factor;
  // Round the way a cook would: coarse for large amounts, finer for small.
  const rounded = raw >= 100 ? Math.round(raw / 5) * 5 : raw >= 10 ? Math.round(raw) : Math.round(raw * 2) / 2;
  return { ...item, qty: rounded, scaled: true, factor: Number(factor.toFixed(3)) };
}

function scaled(targetYield, recipe = RECIPE) {
  return recipe.ingredientGroups.map((g) => ({
    name: g.name,
    items: g.items.map((i) => scaleItem(i, targetYield, recipe.yieldBase)),
  }));
}

module.exports = { RECIPE, RECIPES, bySlug, catalogue, related, neighbours, scaleItem, scaled };
