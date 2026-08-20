// @ts-check
/* Guards 84 and 85 — the two things an adaptive scraping library taught us.
 *
 * Scrapling bundles a TLS-impersonating HTTP client, a Camoufox-based stealth
 * browser, and an "adaptive" parser that relocates elements after a page
 * changes. The first two we already modelled. The third attacks guards 31 and
 * 58 directly, and the stealth browser's canvas noise turns out to be
 * detectable — so both produce a guard rather than a note.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const relocate = require("../lib/relocate");
const risk = require("../lib/risk");

/* ================= 84. Canvas noise ================= */
test.describe("84. Canvas noise detection", () => {
  const post = async (body) => {
    const ctx = await request.newContext();
    const r = await ctx.post(BASE + "/api/canvas/noise", { data: body });
    const out = await r.json();
    await ctx.dispose();
    return out;
  };

  test("a stock browser is byte-identical on both probes", async ({ page }) => {
    // This is the assumption the whole guard rests on, so it is measured in a
    // real browser rather than asserted from theory. If Chromium ever stops
    // being translation-invariant, this fails first and loudly.
    await page.goto(BASE + "/frontier.html");
    const out = page.locator("#canvasnoise-out");
    await expect(out).not.toContainText("probing…", { timeout: 10_000 });
    await expect(out).toContainText("sameTwice=0");
    await expect(out).toContainText("translated=0");
    await expect(out).toContainText("FLAG-CANVASNOISE-3c7a");
  });

  test("per-call randomness is caught", async () => {
    const r = await post({ sameTwice: 412, translated: 480, nonBlank: 592 });
    expect(r.signals).toContain("canvas-noise-per-call");
    expect(r.flag).toBe("FLAG-CANVASNOISE-DETECTED");
  });

  test("position-seeded noise survives the naive probe and fails the translation probe", async () => {
    // Camoufox's shape: stable within a session, so drawing the same thing
    // twice matches — but keyed to pixel position, so moving it does not.
    const r = await post({ sameTwice: 0, translated: 337, nonBlank: 592 });
    expect(r.signals).toEqual(["canvas-noise-seeded"]);
    expect(r.hardenedClient).toBe(true);
  });

  test("a blocked canvas is reported as its own thing, not as noise", async () => {
    const r = await post({ sameTwice: 0, translated: 0, nonBlank: 0 });
    expect(r.signals).toEqual(["canvas-unavailable"]);
    expect(r.hardenedClient).toBe(false);
  });

  test("canvas noise never blocks on its own — Brave and Firefox RFP do it too", async () => {
    // The important assertion in this file. Camoufox hides in a crowd of real
    // privacy-conscious users, so treating this as an automation tell would
    // block humans. It has to stay texture.
    expect(risk.score(["canvas-noise-seeded"]).action).toBe("allow");
    expect(risk.score(["canvas-unavailable"]).action).toBe("allow");

    const r = await post({ sameTwice: 0, translated: 337, nonBlank: 592 });
    expect(r.action).toBe("allow");

    // Even the loud version is not conclusive by itself.
    expect(risk.score(["canvas-noise-per-call"]).action).not.toBe("block");
  });
});

/* ================= 85. Similarity-relocation trap ================= */

/* A stand-in for what an adaptive parser does: score a candidate element
 * against a saved identity across the components such libraries actually use —
 * tag, attributes, class, text shape, ancestors and sibling position. The
 * weights do not need to match any particular implementation; the guard has to
 * hold against the whole family, not against one tuning. */
function similarity(saved, cand) {
  const jaccard = (a, b) => {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 1;
    const inter = [...A].filter((x) => B.has(x)).length;
    return inter / (A.size + B.size - inter);
  };
  let s = 0;
  s += saved.tag === cand.tag ? 0.25 : 0;
  s += 0.2 * jaccard(Object.keys(saved.attrs), Object.keys(cand.attrs));
  s += 0.2 * jaccard(Object.values(saved.attrs), Object.values(cand.attrs));
  s += saved.cls === cand.cls ? 0.2 : 0;
  s += 0.1 * jaccard(saved.ancestors, cand.ancestors);
  s += saved.siblingIndex === cand.siblingIndex ? 0.05 : 0;
  return s;
}

/* Parse the candidates out of a /relocate response without a DOM library —
 * the repo has no runtime dependencies and this is the only place a test needs
 * to walk markup. */
function candidates(html) {
  const group = html.match(/<div class="[^"]*g">([\s\S]*?)<\/div>\s*<\/section>/);
  const inner = group ? group[1] : html;
  const out = [];
  const re = new RegExp(`<(${relocate.TAGS.join("|")}) ([^>]*)>([^<]*)</\\1>`, "g");
  for (const m of inner.matchAll(re)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const cls = attrs.class;
    delete attrs.class;
    const itemprop = attrs.itemprop;
    delete attrs.itemprop;
    // Ancestors: the wrapper chain immediately preceding this element.
    const before = inner.slice(0, m.index);
    const ancestors = [...before.matchAll(/<(div|section|article|aside) class="[^"]*"/g)].slice(-3).map((w) => w[1]);
    out.push({ tag: m[1], cls, attrs, itemprop, text: m[3], ancestors, siblingIndex: out.length });
  }
  return out;
}

test.describe("85. Similarity-relocation trap", () => {
  const get = async (sid, rev) => {
    const ctx = await request.newContext();
    const html = await (await ctx.get(`${BASE}/relocate?sid=${sid}&rev=${rev}`)).text();
    await ctx.dispose();
    return html;
  };

  test.beforeEach(async () => {
    const ctx = await request.newContext();
    await ctx.get(BASE + "/api/relocate/reset");
    await ctx.dispose();
  });

  test("the identity vector rotates completely between responses", async () => {
    const a = candidates(await get("t1", 1)).find((c) => c.text === relocate.VALUE);
    const b = candidates(await get("t1", 2)).find((c) => c.text === relocate.VALUE);
    expect(a, "response 1 must contain the real value").toBeTruthy();
    expect(b, "response 2 must contain the real value").toBeTruthy();

    // Class names alone would not be enough — an adaptive parser ignores them.
    // Every other component has to move as well.
    const moved = [
      a.tag !== b.tag,
      a.cls !== b.cls,
      JSON.stringify(Object.keys(a.attrs)) !== JSON.stringify(Object.keys(b.attrs)),
      JSON.stringify(a.ancestors) !== JSON.stringify(b.ancestors),
      a.siblingIndex !== b.siblingIndex,
    ].filter(Boolean).length;
    expect(moved, "at least three identity components must change").toBeGreaterThanOrEqual(3);
  });

  test("relocation does not fail — it succeeds onto the decoy", async () => {
    // Response 1: the scraper saves the real element, the way `auto_save=True` would.
    const first = candidates(await get("t2", 1));
    const saved = first.find((c) => c.text === relocate.VALUE);
    expect(saved).toBeTruthy();

    // Response 2: relocate by similarity, the way `adaptive=True` would.
    const second = candidates(await get("t2", 2));
    const ranked = second
      .map((c) => ({ c, score: similarity(saved, c) }))
      .sort((x, y) => y.score - x.score);

    const best = ranked[0].c;
    // The best match is not the real element...
    expect(best.text).not.toBe(relocate.VALUE);
    // ...and it is confidently the best, not a coin toss — which is what makes
    // this worse than a failure. The scraper gets a number and no error.
    expect(ranked[0].score).toBeGreaterThan(ranked.find((r) => r.c.text === relocate.VALUE).score);
    expect(best.text).toMatch(/^[\d,]+\.\d{2}$/);
  });

  test("the semantic anchor is stable across every rotation", async () => {
    // The honest defeat. Headings and microdata do not move, so a scraper that
    // reads the document the way a person would is untouched by all of this.
    for (const rev of [1, 2, 3, 4]) {
      const html = await get("t3", rev);
      expect(html).toContain("<h2>Live value</h2>");
      const marked = candidates(html).find((c) => c.itemprop === "price");
      expect(marked, `rev ${rev}: itemprop anchor must exist`).toBeTruthy();
      expect(marked.text, `rev ${rev}: the anchored value must be the real one`).toBe(relocate.VALUE);
    }
  });

  test("the trap only arms once there is a previous response to imitate", async () => {
    // The first response has no history, so it carries no inherited decoy —
    // stating this so the guard is not credited with catching a first visit.
    const first = await get("t4", 1);
    const withNoHistory = candidates(first);
    expect(withNoHistory.length).toBe(3); // real + 2 random decoys

    const second = candidates(await get("t4", 2));
    expect(second.length).toBe(4);        // + the inherited-identity decoy
  });

  test("the rendered DOM matches the markup — no accidental auto-closing", async ({ page }) => {
    // The wrappers nest block elements, so invalid nesting here would make a
    // browser build a different tree than a raw-HTML parser sees. Both routes
    // must agree, or the fixture teaches a bug rather than a technique.
    await page.goto(`${BASE}/relocate?sid=dom&rev=1`);
    await expect(page.locator("[itemprop=price]")).toHaveText(relocate.VALUE);
    const domCount = await page.locator("main [class]").evaluateAll(
      (els, tags) => els.filter((e) => tags.includes(e.tagName.toLowerCase())).length,
      relocate.TAGS
    );
    expect(domCount).toBe(candidates(await get("dom2", 1)).length);
  });

  test("two sessions do not share a trap", async () => {
    // The inherited identity is per-session state. If it leaked across
    // sessions, one scraper's history would poison an unrelated visitor.
    await get("s1", 1);
    const other = candidates(await get("s2", 1));
    expect(other.length).toBe(3);
    expect(other.find((c) => c.text === relocate.VALUE)).toBeTruthy();
  });
});
