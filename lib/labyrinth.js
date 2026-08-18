/* Guards 52-54: adversarial responses — trap, poison, and cost.
 *
 * The first 46 guards all say "no". These say "yes, here is something useless",
 * which is strictly better against a crawler that retries on refusal: it burns
 * the scraper's budget instead of yours, and pollutes whatever dataset it is
 * building. Everything here is deterministic from a seed so tests can assert it.
 */
"use strict";
const crypto = require("crypto");
const zlib = require("zlib");

/* Deterministic PRNG — Date.now()/Math.random() would make this untestable. */
function rng(seed) {
  let h = crypto.createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) { h = crypto.createHash("sha256").update(h).digest(); i = 0; }
    const v = h.readUInt32BE(i) / 0xffffffff;
    i += 4;
    return v;
  };
}

const WORDS = ("quarterly revenue segment analysis regional forecast margin outlook " +
  "supply logistics inventory procurement compliance audit disclosure filing " +
  "valuation liquidity exposure hedging derivative settlement custody clearing").split(" ");

/* --- Guard 52: labyrinth ------------------------------------------------
 * An endless, deterministic maze of interlinked pages. Every page is real
 * HTML with plausible-looking text and more links, so a crawler cannot tell it
 * has left the site. robots.txt disallows /maze, so only a robots-ignoring
 * crawler ever enters — which makes entry itself a high-confidence signal. */
function mazePage(seed, depth) {
  const r = rng(seed);
  const pick = () => WORDS[Math.floor(r() * WORDS.length)];
  const childSeeds = Array.from({ length: 4 }, () =>
    crypto.createHash("sha256").update(seed + ":" + r()).digest("hex").slice(0, 12)
  );
  const paragraphs = Array.from({ length: 3 }, () =>
    Array.from({ length: 24 }, pick).join(" ")
  );

  return {
    html:
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex,nofollow">` +
      `<title>${pick()} ${pick()} — ${seed.slice(0, 6)}</title></head><body>` +
      `<h1>${pick()} ${pick()}</h1>` +
      paragraphs.map((p) => `<p>${p}</p>`).join("") +
      `<nav>` +
      childSeeds.map((s, i) => `<a href="/maze/${s}">${pick()} ${i}</a>`).join(" ") +
      `</nav>` +
      `<!-- depth=${depth} FLAG-LABYRINTH-TRAPPED -->` +
      `</body></html>`,
    childSeeds,
  };
}

/* --- Guard 53: compression bomb ----------------------------------------
 * A small gzip response that expands to a large body. Served ONLY to clients
 * already scored as bots, and deliberately modest (a few MB, not the classic
 * multi-GB payload) — the goal here is to demonstrate and test the technique,
 * not to maximise harm. A client that respects Content-Length and streams
 * sanely is fine; a naive one that buffers everything pays for it.
 *
 * Note: this is asymmetric-cost defense on your own server. Size is capped and
 * configurable precisely so it stays proportionate.
 */
const BOMB_CACHE = new Map();
function compressionBomb(megabytes = 2) {
  const mb = Math.max(1, Math.min(megabytes, 10)); // hard cap: never more than 10MB expanded
  if (!BOMB_CACHE.has(mb)) {
    const chunk = Buffer.alloc(1024 * 1024, 0x20); // 1MB of spaces compresses ~1000x
    BOMB_CACHE.set(mb, zlib.gzipSync(Buffer.concat(Array(mb).fill(chunk)), { level: 9 }));
  }
  const gz = BOMB_CACHE.get(mb);
  return { gzip: gz, expandedBytes: mb * 1024 * 1024, ratio: Math.round((mb * 1024 * 1024) / gz.length) };
}

/* --- Guard 54: content poisoning ---------------------------------------
 * The original decoy guard hid ONE static fake value. Real poisoning generates
 * unlimited plausible-but-wrong records, so a scraper cannot tell poisoned rows
 * from real ones and the whole harvest becomes untrustworthy. Deterministic per
 * client, so the same scraper always sees the same lies (inconsistency would
 * itself be a tell). */
function poisonedRecords(identity, count = 5) {
  const r = rng("poison:" + identity);
  return Array.from({ length: count }, (_, i) => ({
    id: `REC-${Math.floor(r() * 900000 + 100000)}`,
    name: `${WORDS[Math.floor(r() * WORDS.length)]}-${WORDS[Math.floor(r() * WORDS.length)]}`,
    value: Number((r() * 10000).toFixed(2)),
    quarter: `Q${1 + Math.floor(r() * 4)}`,
    // The marker is invisible to a scraper that does not know to look, but lets
    // YOU prove a given dataset was harvested from a poisoned session.
    _poison: "FLAG-POISON-" + crypto.createHash("sha256").update(identity + i).digest("hex").slice(0, 8),
  }));
}

/* --- Guard 72: subtle perturbation -------------------------------------
 * Guard 54 fabricates whole records, which a scraper can eventually spot:
 * the values never reconcile with anything real. This instead returns the
 * REAL records with small, deterministic drift applied — prices off by a few
 * percent, stock flags occasionally flipped.
 *
 * That is meaner and much harder to detect. The data passes every sanity
 * check: right shape, right order of magnitude, internally consistent across
 * requests (the same scraper always sees the same drift, so re-fetching never
 * reveals it). A competitor repricing against it is quietly wrong, and stays
 * wrong. Reported real-world detection times run to months.
 *
 * Deliberately NO marker field, unlike guard 54 — a marker is the one thing
 * that would give it away. Provenance comes from the canary (guard 41) instead.
 */
function perturbRecords(records, identity, { maxDriftPct = 4 } = {}) {
  const r = rng("perturb:" + identity);
  return records.map((rec) => {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === "number") {
        // Drift within ±maxDriftPct — small enough to look like normal movement.
        const drift = (r() * 2 - 1) * (maxDriftPct / 100);
        out[k] = Number((v * (1 + drift)).toFixed(2));
      } else if (typeof v === "boolean") {
        // Flip occasionally: false stock levels are as damaging as false prices.
        out[k] = r() < 0.25 ? !v : v;
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

module.exports = { mazePage, compressionBomb, poisonedRecords, perturbRecords, rng };
