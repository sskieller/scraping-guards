/* Guard 47: weighted risk scoring + proportional escalation.
 *
 * This is the architectural piece the first 46 guards were missing. Each of
 * those returns an independent binary verdict, which has two failure modes:
 *   - one false positive locks a real user out entirely;
 *   - a scraper can defeat the guards one at a time, and each win is total.
 *
 * Here every signal contributes weight to a single score, and the RESPONSE is
 * proportional to that score rather than all-or-nothing. A scraper now has to
 * suppress enough signal mass at once, and a single misfire only nudges a user
 * into a challenge they can pass.
 */
"use strict";

/* Weights are the whole policy. Roughly:
 *   90-100 : conclusive on its own (a human cannot trigger it)
 *   30-50  : strong, but a weird-but-real client could hit it
 *   10-25  : suggestive; meaningful only in combination
 *   1-9    : weak texture
 */
const WEIGHTS = {
  // Conclusive — only a bot can do these.
  "honeypot-link-followed": 100,
  "honeypot-field-filled": 100,
  "forged-signature": 90,

  // Strong automation tells.
  "http-library-ua": 45,
  "ja3-ua-mismatch": 40,
  "no-subresources": 35,
  "navigator.webdriver": 30,
  "selenium-artifact": 35,
  "debugger-detected": 30,
  "script-integrity-failed": 40,

  // Moderate.
  "header-order-mismatch": 25,
  "headless-ua": 25,
  "perfectly-linear-path": 25,
  "missing-sec-fetch": 20,
  "uniform-timing": 20,
  "form-filled-too-fast": 20,
  "datacenter-ip": 20,
  "swiftshader-gpu": 15,
  "rate-exceeded": 15,
  "implausible-navigation": 15,

  // Weak — texture only.
  "no-referer": 10,
  "no-plugins": 8,
  "no-languages": 8,
  "odd-hardware": 8,
  "tz-locale-mismatch": 12,
  "no-conditional-requests": 6,
};

/* Escalation ladder. The point is that "block" is the LAST resort, not the
 * only tool: a mid-score client gets a challenge it can actually pass. */
const LADDER = [
  { min: 0,   max: 24,       action: "allow",     description: "serve normally" },
  { min: 25,  max: 49,       action: "challenge", description: "require CAPTCHA or proof-of-work" },
  { min: 50,  max: 79,       action: "tarpit",    description: "serve, but slowly and with degraded data" },
  { min: 80,  max: Infinity, action: "block",     description: "refuse outright" },
];

function actionFor(score) {
  return LADDER.find((r) => score >= r.min && score <= r.max);
}

/* Score a set of signal names. Unknown signals contribute a small default so a
 * new detector is never silently worthless, but cannot dominate the score. */
function score(signals, { unknownWeight = 5 } = {}) {
  const list = Array.isArray(signals) ? signals : [];
  const breakdown = [];
  let total = 0;
  const seen = new Set();

  for (const name of list) {
    if (seen.has(name)) continue; // never double-count a repeated signal
    seen.add(name);
    const weight = Object.prototype.hasOwnProperty.call(WEIGHTS, name) ? WEIGHTS[name] : unknownWeight;
    total += weight;
    breakdown.push({ signal: name, weight, known: name in WEIGHTS });
  }

  const capped = Math.min(total, 100);
  const rung = actionFor(capped);
  return {
    score: capped,
    rawScore: total,
    action: rung.action,
    description: rung.description,
    breakdown: breakdown.sort((a, b) => b.weight - a.weight),
  };
}

/* Collect the signals observable from the request itself, so the engine can be
 * consulted without any client cooperation. */
function serverSignals(req, { ip = "", subresourcesSeen = true, conditional = true } = {}) {
  const h = req.headers;
  const out = [];
  const ua = h["user-agent"] || "";

  if (/python-requests|curl\/|Go-http-client|axios|Scrapy|libwww|Java\//i.test(ua)) out.push("http-library-ua");
  if (/Headless/i.test(ua)) out.push("headless-ua");
  if (!h["sec-fetch-mode"] && !h["sec-fetch-dest"]) out.push("missing-sec-fetch");
  if (!h["referer"] && !h["origin"]) out.push("no-referer");
  if (!h["accept-language"]) out.push("no-languages");
  if (!subresourcesSeen) out.push("no-subresources");
  if (!conditional) out.push("no-conditional-requests");
  // Loopback is treated as residential here; a real deployment consults an ASN feed.
  if (/^(?!127\.|::1|::ffff:127\.)/.test(ip) && /^(3[0-9]|4[0-5])\./.test(ip)) out.push("datacenter-ip");

  return out;
}

/* ===================== Guard 76: adaptive weights =====================
 * The weights above are my guesses. Real systems learn theirs, because a
 * signal's value drifts: a tell that was conclusive last year becomes noise
 * once every stealth library patches it.
 *
 * The conclusive guards are the labeller. A honeypot hit (guard 14/15) is
 * ground truth — no human can trigger one — so whenever one fires we can
 * record every OTHER signal that co-occurred and learn which ones actually
 * predict automation. Signals that keep showing up alongside confirmed bots
 * gain weight; signals that keep showing up on confirmed humans lose it.
 *
 * Two safety rails, both deliberate:
 *   - adjustment is clamped to [0.5x, 1.5x] of the hand-set base weight, so a
 *     poisoned feedback stream cannot drive a signal to dominate or vanish;
 *   - a signal needs MIN_OBSERVATIONS before it moves at all, so one unlucky
 *     session cannot reweight the system.
 */
const CLAMP = { min: 0.5, max: 1.5 };
const MIN_OBSERVATIONS = 5;

// signal -> {bot, human}
const observations = new Map();

function recordOutcome(signals, confirmedBot) {
  for (const s of new Set(Array.isArray(signals) ? signals : [])) {
    const rec = observations.get(s) || { bot: 0, human: 0 };
    if (confirmedBot) rec.bot++; else rec.human++;
    observations.set(s, rec);
  }
}

/* Precision: of the times we saw this signal and later learned the truth, how
 * often was it a bot? 0.5 is uninformative and leaves the weight unchanged. */
function adaptiveMultiplier(signal) {
  const rec = observations.get(signal);
  if (!rec) return 1;
  const total = rec.bot + rec.human;
  if (total < MIN_OBSERVATIONS) return 1;
  const precision = rec.bot / total;
  const raw = 1 + (precision - 0.5) * 2 * 0.5; // precision 1.0 -> 1.5x, 0.0 -> 0.5x
  return Math.min(CLAMP.max, Math.max(CLAMP.min, raw));
}

function adaptiveScore(signals, opts = {}) {
  const base = score(signals, opts);
  let total = 0;
  const breakdown = base.breakdown.map((b) => {
    const mult = adaptiveMultiplier(b.signal);
    const weight = Math.round(b.weight * mult);
    total += weight;
    const rec = observations.get(b.signal) || { bot: 0, human: 0 };
    return { ...b, baseWeight: b.weight, multiplier: Number(mult.toFixed(2)), weight, observations: rec };
  });
  const capped = Math.min(total, 100);
  const rung = actionFor(capped);
  return {
    score: capped, rawScore: total, action: rung.action, description: rung.description,
    breakdown, adaptive: true, baseScore: base.score,
  };
}

function weightTable() {
  return Object.entries(WEIGHTS).map(([signal, base]) => ({
    signal, base,
    multiplier: Number(adaptiveMultiplier(signal).toFixed(2)),
    effective: Math.round(base * adaptiveMultiplier(signal)),
    observations: observations.get(signal) || { bot: 0, human: 0 },
  }));
}

function resetLearning() { observations.clear(); }

module.exports = {
  score, serverSignals, actionFor, WEIGHTS, LADDER,
  recordOutcome, adaptiveScore, adaptiveMultiplier, weightTable, resetLearning,
  MIN_OBSERVATIONS, CLAMP,
};
