/* Guard 85: resistance to similarity-based element relocation.
 *
 * Guards 31 and 58 randomize class names and nesting, and the README says they
 * are "defeated by structural, not selector, extraction". Scrapling's adaptive
 * parser automates exactly that: you mark an element once with `auto_save=True`
 * and it stores an identity — tag, attributes, text, ancestor chain, sibling
 * index, depth — then relocates the element on later responses by scoring
 * candidates for similarity. Randomizing class names alone does not stop it,
 * because every other component of the identity survives the change.
 *
 * So this guard attacks the identity vector itself, and does one thing more:
 * it hands the PREVIOUS response's identity to a decoy. A scraper that saved
 * the real element on response N and relocates by similarity on response N+1
 * does not fail to find an element — it confidently finds the wrong one, and
 * that one carries a poisoned value.
 *
 * What defeats it, honestly: anchoring on semantics rather than on remembered
 * structure. The real value is always the one under the "Live value" heading,
 * marked up with `itemprop`. Those do not move. A scraper that reads the
 * document the way a person would is unaffected by every rotation below.
 */
"use strict";
const crypto = require("crypto");

/* Semantically equivalent inline tags — swapping them changes the identity
 * vector without changing a single rendered pixel. */
const TAGS = ["span", "b", "i", "em", "strong", "mark", "u"];
/* Block wrappers only — no <p>. A <p> cannot contain another <p> or an
 * <article>, so a browser would silently auto-close it and build a different
 * tree than the markup implies. A fixture that teaches structural extraction
 * must not have the DOM and the raw HTML disagree by accident. */
const WRAPPERS = ["div", "section", "article", "aside"];
const ATTR_NAMES = ["data-ref", "data-key", "data-idx", "data-tok", "data-bind", "data-v", "data-node"];

const VALUE = "FLAG-RELOCATE-6d20";

const state = new Map(); // sid -> previous identity of the real element

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

/* A tiny seeded PRNG so a given revision renders deterministically — the test
 * needs to re-render response N and get the same bytes. */
function rng(seed) {
  let h = crypto.createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) { h = crypto.createHash("sha256").update(h).digest(); i = 0; }
    const v = h.readUInt32BE(i); i += 4;
    return v / 0x1_0000_0000;
  };
}

/* Everything an auto-match algorithm keys on. Rotating all of it at once is
 * the point: leaving any one component stable leaves a handle to grab. */
function identity(rnd) {
  const attrCount = 1 + Math.floor(rnd() * 3);
  const attrs = {};
  for (let i = 0; i < attrCount; i++) {
    attrs[pick(rnd, ATTR_NAMES)] = crypto
      .createHash("md5").update(String(rnd())).digest("hex").slice(0, 6);
  }
  return {
    tag: pick(rnd, TAGS),
    cls: "r" + crypto.createHash("md5").update(String(rnd())).digest("hex").slice(0, 8),
    attrs,
    depth: 1 + Math.floor(rnd() * 3),        // how many wrappers to nest it in
    wrappers: Array.from({ length: 3 }, () => pick(rnd, WRAPPERS)),
    siblingIndex: Math.floor(rnd() * 4),     // where among its siblings it sits
  };
}

const attrString = (id) =>
  Object.entries(id.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");

/* Render one element with the given identity, wrapped to the given depth. */
function renderEl(id, text, extra) {
  let html = `<${id.tag} class="${id.cls}"${attrString(id)}${extra || ""}>${text}</${id.tag}>`;
  for (let d = 0; d < id.depth; d++) {
    html = `<${id.wrappers[d % id.wrappers.length]} class="${id.cls}w${d}">${html}</${id.wrappers[d % id.wrappers.length]}>`;
  }
  return html;
}

/* Build the block of siblings: the real element plus decoys, in an order the
 * identity's siblingIndex decides. */
function renderGroup(real, realText, decoys) {
  const nodes = decoys.map((d) => renderEl(d.id, d.text));
  const at = Math.min(real.siblingIndex, nodes.length);
  nodes.splice(at, 0, renderEl(real, realText, ' itemprop="price"'));
  return nodes.join("\n      ");
}

/* `rev` lets a caller re-request an earlier revision byte-for-byte, which is
 * what makes the relocation failure reproducible in a test rather than a race. */
function page(sid, rev) {
  const prev = state.get(sid) || null;
  const rnd = rng(`${sid}:${rev}`);
  const real = identity(rnd);

  // The decoy that inherits the previous response's identity. This is the trap:
  // it is the single best similarity match for whatever the scraper saved last
  // time, and it is wrong.
  const decoys = [];
  if (prev) decoys.push({ id: prev, text: "1,204.00" });
  for (let i = 0; i < 2; i++) decoys.push({ id: identity(rnd), text: `${900 + i * 37}.00` });

  state.set(sid, real);

  const body = `<!doctype html>
<meta charset="utf-8">
<title>Live value</title>
<main>
  <section itemscope itemtype="https://schema.org/Offer">
    <h2>Live value</h2>
    <div class="${real.cls}g">
      ${renderGroup(real, VALUE, decoys)}
    </div>
  </section>
</main>
`;
  return { body, identity: real, previousIdentity: prev, decoyCount: decoys.length };
}

function reset() { state.clear(); }

module.exports = { page, reset, VALUE, TAGS };
