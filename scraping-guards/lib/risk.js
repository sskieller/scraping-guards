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

module.exports = { score, serverSignals, actionFor, WEIGHTS, LADDER };
