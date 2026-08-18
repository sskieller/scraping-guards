/* Guard 77: enumeration / keyspace-coverage detection.
 *
 * Guard 66 asks "is the TIMING human?". This asks a different and often
 * stronger question: "is the SHAPE of what they requested human?"
 *
 * A person reads a handful of scattered items. A scraper walks the ID space —
 * sequentially, or by covering a large fraction of it, or in strict monotonic
 * order. That pattern survives perfect timing jitter, residential proxies and
 * a flawless browser fingerprint, because it is a property of the *intent*,
 * not the transport. It is one of the few signals that a well-built scraper
 * cannot cheaply fake without giving up its own goal.
 */
"use strict";

const sessions = new Map(); // sid -> {ids: [], seen: Set}

function record(sid, id) {
  const s = sessions.get(sid) || { ids: [], seen: new Set() };
  s.ids.push(id);
  s.seen.add(id);
  sessions.set(sid, s);
  return s;
}

/* Longest run of consecutive integers in access order (1,2,3 -> 3). */
function longestSequentialRun(ids) {
  const nums = ids.map(Number).filter(Number.isFinite);
  let best = nums.length ? 1 : 0;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === nums[i - 1] + 1) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  return best;
}

function analyse(sid, { keyspaceSize = 1000 } = {}) {
  const s = sessions.get(sid) || { ids: [], seen: new Set() };
  const nums = s.ids.map(Number).filter(Number.isFinite);
  const signals = [];

  const unique = s.seen.size;
  const coverage = keyspaceSize ? unique / keyspaceSize : 0;
  const run = longestSequentialRun(s.ids);

  // A run of consecutive IDs is the clearest possible enumeration tell.
  if (run >= 5) signals.push("sequential-enumeration");

  // Covering a large slice of the keyspace is a crawl, whatever the order.
  if (coverage >= 0.25) signals.push("keyspace-coverage");

  // Strictly increasing across a long session: systematic, not exploratory.
  const monotonic = nums.length >= 8 && nums.every((v, i) => i === 0 || v > nums[i - 1]);
  if (monotonic) signals.push("monotonic-traversal");

  // Almost no repeats over a long session — humans revisit, crawlers do not.
  if (s.ids.length >= 10 && unique / s.ids.length > 0.95) signals.push("no-revisits");

  return {
    requests: s.ids.length,
    unique,
    coverage: Number(coverage.toFixed(3)),
    longestRun: run,
    signals,
    enumerating: signals.length >= 2 || signals.includes("sequential-enumeration"),
  };
}

function reset(sid) {
  if (sid) sessions.delete(sid); else sessions.clear();
}

module.exports = { record, analyse, reset, longestSequentialRun };
