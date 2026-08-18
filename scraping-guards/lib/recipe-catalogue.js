/* The rest of the catalogue.
 *
 * The first recipe (lib/recipe-data.js) proves a single detail page can be
 * scraped. A catalogue proves something different: that a crawler can *find*
 * pages it was never given a URL for. That needs a link graph with enough
 * depth to be worth traversing — an index, pagination, lazy loading, related
 * links and a sitemap.
 *
 * Two recipes are full-length (20 steps); the remaining six are short, which is
 * also realistic — most recipes on a real site are simple ones.
 *
 * All content is invented.
 */
"use strict";

/* ---------- Second full recipe: serves PEOPLE, not items ---------------
 * Deliberately a different yield semantic from the buns. A scraper that
 * hardcodes "12 buns" from the first page gets the second one wrong. */
const PICI = {
  slug: "pici-ragu-bianco",
  title: "Hand-Rolled Pici with Ragù Bianco",
  subtitle: "A white ragù, no tomato anywhere near it",
  author: "Test Kitchen",
  published: "2026-04-02",
  updated: "2026-08-09",
  rating: { value: 4.9, count: 96 },
  cuisine: "Italian",
  category: "Pasta",
  tags: ["pasta", "slow", "pork", "weekend"],
  yieldBase: 4,
  yieldUnit: "servings",
  yieldQuestion: "How many people are you feeding?",
  yieldOptions: [2, 4, 6, 8, 12],
  times: { prep: 60, proof: 30, bake: 180, total: 270 },

  story: [
    "Ragù bianco is what ragù was before tomatoes reached Italy, and it is still " +
    "the better dish. Without tomato there is nothing to hide behind: the whole " +
    "flavour has to come from browning the meat properly, deglazing with enough " +
    "wine to matter, and then leaving it alone for three hours.",
    "Pici are the easiest fresh pasta to make badly and the most forgiving to make " +
    "well. No eggs, no machine — flour, water, a little oil, and then twenty " +
    "minutes of rolling ropes between your palms. They should be uneven. Uniform " +
    "pici are a sign someone used a machine, and they cook worse for it.",
  ],

  equipment: [
    "Heavy casserole or Dutch oven with a lid",
    "Bench scraper",
    "A large clean work surface — pici need room",
    "Digital scale",
  ],

  ingredientGroups: [
    {
      name: "Pici",
      items: [
        { qty: 400, unit: "g", name: "'00' flour", note: "plus more for the bench", scalable: true },
        { qty: 200, unit: "ml", name: "warm water", scalable: true },
        { qty: 2, unit: "tbsp", name: "olive oil", scalable: true },
        { qty: 5, unit: "g", name: "fine salt", scalable: false },
      ],
    },
    {
      name: "Ragù bianco",
      items: [
        { qty: 600, unit: "g", name: "pork shoulder, in 3 cm cubes", scalable: true },
        { qty: 200, unit: "g", name: "pork belly, diced", scalable: true },
        { qty: 1, unit: "", name: "onion, finely diced", scalable: true },
        { qty: 2, unit: "", name: "celery sticks, finely diced", scalable: true },
        { qty: 1, unit: "", name: "carrot, finely diced", scalable: true },
        { qty: 4, unit: "", name: "garlic cloves, sliced", scalable: true },
        { qty: 250, unit: "ml", name: "dry white wine", scalable: true },
        { qty: 400, unit: "ml", name: "chicken stock", scalable: true },
        { qty: 2, unit: "", name: "bay leaves", scalable: false },
        { qty: 1, unit: "tsp", name: "fennel seeds, crushed", scalable: true },
        { qty: 6, unit: "g", name: "fine salt", note: "season in layers, not all at once", scalable: false },
      ],
    },
    {
      name: "To finish",
      items: [
        { qty: 60, unit: "g", name: "Parmesan, finely grated", scalable: true },
        { qty: 30, unit: "g", name: "cold butter", scalable: true },
        { qty: 1, unit: "", name: "lemon, zest only", scalable: false },
      ],
    },
  ],

  steps: [
    { n: 1, title: "Make the pici dough", text: "Mix the flour and salt, make a well, and work in the warm water and oil with a fork until it comes together into a shaggy mass." },
    { n: 2, title: "Knead", text: "Knead on an unfloured bench for 8 minutes. It should go from rough to smooth and slightly tacky. Resist adding flour — the dough tightens as it rests." },
    { n: 3, title: "Rest the dough", text: "Wrap and rest at room temperature for at least 30 minutes. This is not optional; unrested dough springs back and will not roll into ropes." },
    { n: 4, title: "Brown the pork shoulder", text: "Pat the shoulder dry and brown hard in batches in a dry-ish pan. Crowding steams the meat and costs you the entire flavour base of a white ragù." },
    { n: 5, title: "Render the belly", text: "Lower the heat and render the diced belly until the fat runs and the pieces are golden, about 8 minutes." },
    { n: 6, title: "Soffritto", text: "Add the onion, celery and carrot to the rendered fat with a pinch of salt. Cook gently for 12 minutes until soft and sweet but not coloured." },
    { n: 7, title: "Garlic and fennel", text: "Add the garlic and crushed fennel seeds and cook for 2 minutes, until fragrant. Any longer and the garlic turns bitter." },
    { n: 8, title: "Deglaze", text: "Pour in the wine and scrape the base clean with a wooden spoon. Simmer until reduced by half — the raw alcohol edge must cook off." },
    { n: 9, title: "Return the meat", text: "Return the browned shoulder and any resting juices, add the stock and bay, and bring to a bare simmer." },
    { n: 10, title: "Braise", text: "Cover and cook at 150°C for 2½–3 hours, until the shoulder gives way completely under a spoon. Check once an hour and top up with water if it looks dry." },
    { n: 11, title: "Roll the pici", text: "Cut the rested dough into strips, then roll each into a rope about the thickness of a pencil between your palms. They will be uneven. That is correct." },
    { n: 12, title: "Dust and hold", text: "Toss the finished pici in semolina or flour and leave in loose nests on a tray. They can sit for an hour at room temperature." },
    { n: 13, title: "Shred", text: "Lift the meat out and shred it coarsely with two forks, discarding the bay. Leave some pieces larger than others." },
    { n: 14, title: "Reduce the sauce", text: "Skim the worst of the fat, then reduce the braising liquid over medium heat until it coats a spoon, about 10 minutes." },
    { n: 15, title: "Recombine", text: "Return the shredded meat to the reduced sauce. Taste and season now — this is the point where the salt has to be right." },
    { n: 16, title: "Boil the pasta", text: "Cook the pici in heavily salted boiling water for 4–6 minutes. Fresh pici are done when they float and lose their raw core; taste one rather than trusting the clock." },
    { n: 17, title: "Save the water", text: "Reserve a large mug of pasta water before draining. You will need more of it than you expect." },
    { n: 18, title: "Marry", text: "Drain the pici and add them to the pan of ragù with a splash of pasta water. Toss over medium heat for a full minute so the starch and sauce emulsify." },
    { n: 19, title: "Mount with butter and cheese", text: "Off the heat, add the cold butter and most of the Parmesan, tossing constantly and loosening with more pasta water until glossy rather than greasy." },
    { n: 20, title: "Finish and serve", text: "Grate over the lemon zest, check the seasoning one last time, and serve immediately with the remaining Parmesan. It will not wait." },
  ],

  notes: [
    "Make-ahead: the ragù is better on day two. Cool fast and refrigerate for up to three days.",
    "Freezing: the ragù freezes well for three months; the pici do not freeze at all.",
    "Wine: use something you would drink. A ragù bianco reduces it, so faults concentrate.",
  ],

  nutrition: { perServing: true, calories: 812, fat: 34, saturates: 13, carbs: 79, sugars: 6, protein: 41, salt: 2.1 },
};

/* ---------- Short recipes: the bulk of any real catalogue ------------- */
const short = (o) => ({
  author: "Test Kitchen",
  published: "2026-05-01",
  updated: "2026-07-20",
  yieldUnit: "servings",
  yieldQuestion: "How many people are you feeding?",
  yieldOptions: [2, 4, 6, 8],
  equipment: [],
  notes: [],
  ...o,
});

const SHORTS = [
  short({
    slug: "burnt-butter-carrots",
    title: "Burnt Butter Carrots with Dill",
    subtitle: "One pan, twenty minutes",
    rating: { value: 4.4, count: 61 }, cuisine: "Nordic", category: "Sides",
    tags: ["quick", "vegetarian", "side"],
    yieldBase: 4, times: { prep: 10, proof: 0, bake: 20, total: 30 },
    story: ["Carrots take heat far better than people give them credit for. Push them past the point you think is right and the sugars do the work for you."],
    ingredientGroups: [{ name: "Everything", items: [
      { qty: 600, unit: "g", name: "carrots, halved lengthways", scalable: true },
      { qty: 60, unit: "g", name: "butter", scalable: true },
      { qty: 1, unit: "tbsp", name: "honey", scalable: true },
      { qty: 15, unit: "g", name: "dill, roughly chopped", scalable: true },
      { qty: 4, unit: "g", name: "flaky salt", scalable: false },
    ]}],
    steps: [
      { n: 1, title: "Parboil", text: "Boil the carrots in salted water for 6 minutes, until a knife meets slight resistance. Drain thoroughly and let the steam escape." },
      { n: 2, title: "Brown the butter", text: "Melt the butter in a wide pan over medium heat until it foams, quietens, and smells nutty — about 5 minutes." },
      { n: 3, title: "Sear", text: "Add the carrots cut-side down in a single layer and leave them undisturbed for 5 minutes to take real colour." },
      { n: 4, title: "Glaze", text: "Add the honey, turn the carrots, and cook 3 minutes more until sticky." },
      { n: 5, title: "Finish", text: "Off the heat, toss through the dill and flaky salt. Serve straight from the pan." },
    ],
    nutrition: { perServing: true, calories: 198, fat: 13, saturates: 8, carbs: 18, sugars: 13, protein: 2, salt: 1.1 },
  }),
  short({
    slug: "rye-pancakes",
    title: "Rye Pancakes with Soured Cream",
    subtitle: "Darker, nuttier, better",
    rating: { value: 4.6, count: 143 }, cuisine: "Nordic", category: "Breakfast",
    tags: ["quick", "breakfast", "baking"],
    yieldBase: 4, times: { prep: 10, proof: 20, bake: 15, total: 45 },
    story: ["Half rye is the most it will take before the crumb turns heavy. The twenty-minute rest is what stops them tasting raw."],
    ingredientGroups: [{ name: "Batter", items: [
      { qty: 120, unit: "g", name: "rye flour", scalable: true },
      { qty: 120, unit: "g", name: "plain flour", scalable: true },
      { qty: 350, unit: "ml", name: "buttermilk", scalable: true },
      { qty: 2, unit: "", name: "eggs", scalable: true },
      { qty: 8, unit: "g", name: "baking powder", scalable: false },
      { qty: 3, unit: "g", name: "salt", scalable: false },
    ]}, { name: "To serve", items: [
      { qty: 200, unit: "g", name: "soured cream", scalable: true },
      { qty: 2, unit: "tbsp", name: "birch or maple syrup", scalable: true },
    ]}],
    steps: [
      { n: 1, title: "Mix", text: "Whisk the dry ingredients, then the wet, then combine — stopping while a few lumps remain. Overmixing makes them tough." },
      { n: 2, title: "Rest", text: "Rest the batter 20 minutes so the rye hydrates fully. It will thicken noticeably." },
      { n: 3, title: "Cook", text: "Ladle into a buttered pan over medium heat. Flip when the surface bubbles hold open, about 2 minutes." },
      { n: 4, title: "Serve", text: "Stack, spoon over soured cream and syrup, and eat immediately." },
    ],
    nutrition: { perServing: true, calories: 431, fat: 16, saturates: 9, carbs: 57, sugars: 14, protein: 15, salt: 1.4 },
  }),
  short({
    slug: "cold-smoked-salmon-cure",
    title: "Beetroot-Cured Salmon",
    subtitle: "Three days, almost no work",
    rating: { value: 4.8, count: 74 }, cuisine: "Nordic", category: "Preserving",
    tags: ["slow", "fish", "make-ahead"],
    yieldBase: 8, times: { prep: 25, proof: 4320, bake: 0, total: 4345 },
    story: ["Curing is mostly waiting. The beetroot is for colour and a faint earthiness; the salt and sugar do the actual work."],
    ingredientGroups: [{ name: "Cure", items: [
      { qty: 1000, unit: "g", name: "salmon side, pin-boned, skin on", scalable: true },
      { qty: 120, unit: "g", name: "coarse salt", scalable: true },
      { qty: 100, unit: "g", name: "caster sugar", scalable: true },
      { qty: 250, unit: "g", name: "raw beetroot, grated", scalable: true },
      { qty: 2, unit: "tbsp", name: "dill seed", scalable: true },
    ]}],
    steps: [
      { n: 1, title: "Mix the cure", text: "Combine the salt, sugar, grated beetroot and dill seed into a wet, crimson mixture." },
      { n: 2, title: "Pack", text: "Lay the salmon skin-down and pack the cure over the flesh in an even layer, thicker at the shoulder." },
      { n: 3, title: "Weigh it down", text: "Wrap tightly, set on a tray, and weight with something flat. Refrigerate." },
      { n: 4, title: "Turn daily", text: "Pour off the liquid and turn the fish once a day for three days." },
      { n: 5, title: "Rinse and slice", text: "Rinse the cure off, pat completely dry, and slice thinly on a long angle away from the skin." },
    ],
    nutrition: { perServing: true, calories: 246, fat: 12, saturates: 2, carbs: 6, sugars: 6, protein: 27, salt: 3.4 },
  }),
  short({
    slug: "brown-bread-ice-cream",
    title: "Brown Bread Ice Cream",
    subtitle: "Uses up the heel of the loaf",
    rating: { value: 4.5, count: 52 }, cuisine: "British", category: "Dessert",
    tags: ["dessert", "make-ahead"],
    yieldBase: 6, times: { prep: 30, proof: 240, bake: 12, total: 282 },
    story: ["Caramelised breadcrumbs behave like praline: crisp at first, then dissolving into the custard. Made a day ahead they soften too far."],
    ingredientGroups: [{ name: "Crumb", items: [
      { qty: 120, unit: "g", name: "stale wholemeal breadcrumbs", scalable: true },
      { qty: 80, unit: "g", name: "demerara sugar", scalable: true },
    ]}, { name: "Custard", items: [
      { qty: 500, unit: "ml", name: "double cream", scalable: true },
      { qty: 250, unit: "ml", name: "whole milk", scalable: true },
      { qty: 6, unit: "", name: "egg yolks", scalable: true },
      { qty: 120, unit: "g", name: "caster sugar", scalable: true },
    ]}],
    steps: [
      { n: 1, title: "Caramelise the crumbs", text: "Toss the crumbs with demerara and bake at 180°C for 10–12 minutes, stirring twice, until dark and crisp. Cool and break up." },
      { n: 2, title: "Make the custard", text: "Heat the cream and milk. Whisk yolks with sugar, temper, then cook to 82°C, stirring constantly." },
      { n: 3, title: "Chill", text: "Strain and chill thoroughly, ideally overnight." },
      { n: 4, title: "Churn", text: "Churn until thick, then fold through most of the crumb." },
      { n: 5, title: "Freeze", text: "Freeze 4 hours. Scatter the reserved crumb over each serving." },
    ],
    nutrition: { perServing: true, calories: 612, fat: 44, saturates: 26, carbs: 46, sugars: 38, protein: 8, salt: 0.3 },
  }),
  short({
    slug: "charred-cabbage-anchovy",
    title: "Charred Cabbage with Anchovy Butter",
    subtitle: "Cook it far longer than feels right",
    rating: { value: 4.7, count: 88 }, cuisine: "British", category: "Sides",
    tags: ["quick", "side"],
    yieldBase: 4, times: { prep: 10, proof: 0, bake: 35, total: 45 },
    story: ["The outer leaves should look ruined. That blackening is the entire dish; underneath, the cabbage steams in its own moisture."],
    ingredientGroups: [{ name: "Everything", items: [
      { qty: 1, unit: "", name: "hispi cabbage, quartered", scalable: true },
      { qty: 80, unit: "g", name: "butter, softened", scalable: true },
      { qty: 6, unit: "", name: "anchovy fillets, mashed", scalable: true },
      { qty: 1, unit: "tbsp", name: "cider vinegar", scalable: true },
      { qty: 2, unit: "g", name: "black pepper", scalable: false },
    ]}],
    steps: [
      { n: 1, title: "Make the butter", text: "Mash the anchovies into the softened butter with the pepper until smooth." },
      { n: 2, title: "Char", text: "Sear the cabbage quarters cut-side down in a dry hot pan for 6 minutes a side, until genuinely blackened in places." },
      { n: 3, title: "Roast", text: "Transfer to a 200°C oven for 20 minutes, until a knife slides into the core without resistance." },
      { n: 4, title: "Dress", text: "Dot with the anchovy butter, splash over the vinegar, and let it melt into the leaves before serving." },
    ],
    nutrition: { perServing: true, calories: 231, fat: 19, saturates: 11, carbs: 9, sugars: 7, protein: 5, salt: 1.6 },
  }),
  short({
    slug: "quick-pickled-shallots",
    title: "Quick Pickled Shallots",
    subtitle: "Ready in an hour, keeps a month",
    rating: { value: 4.3, count: 210 }, cuisine: "British", category: "Preserving",
    tags: ["quick", "vegetarian", "make-ahead"],
    yieldBase: 8, times: { prep: 10, proof: 60, bake: 0, total: 70 },
    story: ["Every rich dish on this site is improved by something sharp next to it. This is the cheapest possible version of that."],
    ingredientGroups: [{ name: "Everything", items: [
      { qty: 300, unit: "g", name: "shallots, sliced into thin rings", scalable: true },
      { qty: 150, unit: "ml", name: "red wine vinegar", scalable: true },
      { qty: 100, unit: "ml", name: "water", scalable: true },
      { qty: 40, unit: "g", name: "caster sugar", scalable: true },
      { qty: 8, unit: "g", name: "salt", scalable: false },
      { qty: 1, unit: "tsp", name: "black peppercorns", scalable: true },
    ]}],
    steps: [
      { n: 1, title: "Pack", text: "Pack the sliced shallots tightly into a clean jar with the peppercorns." },
      { n: 2, title: "Make the brine", text: "Warm the vinegar, water, sugar and salt until dissolved. Do not boil." },
      { n: 3, title: "Pour and wait", text: "Pour the warm brine over to cover, seal, and leave an hour. Refrigerate once cool; they keep a month." },
    ],
    nutrition: { perServing: true, calories: 46, fat: 0, saturates: 0, carbs: 10, sugars: 9, protein: 1, salt: 1.0 },
  }),
];

module.exports = { PICI, SHORTS };
