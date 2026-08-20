// @ts-check
/* What each class of scraping client actually reaches.
 *
 * The README's client-class matrix is a claim, and claims in a README rot. This
 * spec is that table executed: six client shapes, each described by the signals
 * it genuinely emits, checked against the risk engine's verdict and — where it
 * can be done over plain HTTP — against the live server.
 *
 * The taxonomy follows webscraping.fyi's tooling overview, which splits the
 * space into raw HTTP clients, TLS-impersonating HTTP clients (curl_cffi,
 * primp, hrequests), plain headless browsers, anti-detect browsers (nodriver,
 * camoufox, puppeteer-extra), and the newer LLM-driven agents. Those five
 * behave very differently against the same guards, and collapsing them into
 * "bot" hides the interesting part.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const risk = require("../lib/risk");

/* Each entry lists the signals that client class emits *by construction* —
 * things it cannot avoid without becoming a different class of client. */
const CLASSES = [
  {
    name: "raw HTTP client (curl, requests)",
    signals: ["http-library-ua", "missing-sec-fetch", "no-referer", "no-languages", "no-subresources"],
    expect: "block",
    note: "The UA alone is 45. Nothing else has to go wrong.",
  },
  {
    name: "raw HTTP client with a browser UA",
    // Spoofing the UA removes the 45-point tell and leaves the transport ones.
    signals: ["ja3-ua-mismatch", "missing-sec-fetch", "no-referer", "no-subresources"],
    expect: "block",
    note: "Claiming Chrome without Chrome's TLS handshake is worse than being honest.",
  },
  {
    name: "TLS-impersonating HTTP client (curl_cffi, primp)",
    // JA3 and HTTP/2 now match the claimed browser, and the header set is
    // copied from a real capture. What remains is that nothing executes.
    signals: ["no-subresources", "no-conditional-requests"],
    expect: "challenge",
    note: "Passes the transport guards outright; dies on anything needing JS.",
  },
  {
    name: "headless browser, no stealth",
    signals: ["navigator.webdriver", "headless-ua", "swiftshader-gpu", "no-plugins"],
    // 78, just under the block band. Three loud tells still do not add up to a
    // refusal, because the ladder reserves "block" for the conclusive signals —
    // a honeypot hit or a forged signature. Everything short of proof gets
    // served something, slowly.
    expect: "tarpit",
    note: "Three independent tells for the same underlying fact — still not proof.",
  },
  {
    name: "anti-detect browser (nodriver, camoufox)",
    // The webdriver flag, the UA and the GPU string are all patched. Behaviour
    // is what is left, and behaviour is expensive to fake convincingly.
    signals: ["perfectly-linear-path", "uniform-timing"],
    expect: "challenge",
    note: "Fingerprints are patched; the mouse path is not.",
  },
  {
    name: "AI browser agent (browser-use, skyvern)",
    // Drives a real browser, so the fingerprint is real — but it clicks by
    // coordinate after a screenshot, so the pointer teleports and each step
    // waits on an LLM round-trip.
    signals: ["perfectly-linear-path", "implausible-navigation", "no-conditional-requests"],
    expect: "challenge",
    note: "A real browser moving in a way no hand moves.",
  },
  {
    name: "compliant crawler",
    signals: ["no-referer"],
    expect: "allow",
    note: "Identifies itself, obeys robots.txt, never touches a honeypot.",
  },
];

test.describe("expected results by client class", () => {
  for (const c of CLASSES) {
    test(`${c.name} → ${c.expect}`, () => {
      const r = risk.score(c.signals);
      expect(r.action, `${c.name}: ${c.note} (score ${r.score})`).toBe(c.expect);
    });
  }

  test("the ladder orders the classes the way the README claims", () => {
    const scores = CLASSES.map((c) => ({ name: c.name, score: risk.score(c.signals).score }));
    const byName = Object.fromEntries(scores.map((s) => [s.name, s.score]));

    // A compliant crawler must always be the safest thing on the list, and a
    // raw HTTP client the least safe. If a change ever inverts that, the
    // weights have drifted away from reality.
    expect(Math.min(...scores.map((s) => s.score))).toBe(byName["compliant crawler"]);
    expect(byName["raw HTTP client (curl, requests)"]).toBe(Math.max(...scores.map((s) => s.score)));

    // Impersonating TLS is a real improvement over spoofing only the UA.
    expect(byName["TLS-impersonating HTTP client (curl_cffi, primp)"])
      .toBeLessThan(byName["raw HTTP client with a browser UA"]);

    // And patching fingerprints beats not patching them.
    expect(byName["anti-detect browser (nodriver, camoufox)"])
      .toBeLessThan(byName["headless browser, no stealth"]);

    // The two hardest classes to separate land within a few points of each
    // other, and both in the same band. That is not a flaw in the weights: an
    // anti-detect browser and an AI agent driving a real browser look almost
    // identical from the server, and only behaviour tells them apart at all.
    expect(Math.abs(
      byName["anti-detect browser (nodriver, camoufox)"] - byName["AI browser agent (browser-use, skyvern)"]
    )).toBeLessThanOrEqual(5);
  });
});

/* ---------------- The same classes against the live server ---------------- */

const HEADERS = {
  raw: { "User-Agent": "python-requests/2.31.0" },
  spoofed: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
    "X-Sim-JA3": "python-requests",
  },
  impersonating: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
    "X-Sim-JA3": "chrome",
    "X-Sim-H2": "browser",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: BASE + "/frontier.html",
  },
};

const get = async (path, headers) => {
  const ctx = await request.newContext({ extraHTTPHeaders: headers });
  const r = await ctx.get(BASE + path);
  const body = r.headers()["content-type"]?.includes("json") ? await r.json() : await r.text();
  await ctx.dispose();
  return { status: r.status(), body };
};

test("a TLS-impersonating client clears the guards that stop a raw one", async () => {
  // Guard 42 is a stub, but its verdict is the one that matters here: a
  // python-requests handshake behind a Chrome UA is the single loudest tell in
  // the whole transport layer.
  const spoofed = await get("/api/net/tls", HEADERS.spoofed);
  expect(spoofed.status).toBe(403);

  const impersonating = await get("/api/net/tls", HEADERS.impersonating);
  expect(impersonating.status).toBe(200);

  // ...and the risk-gated endpoint agrees.
  const gated = await get("/api/risk/gated", HEADERS.impersonating);
  expect(gated.status).toBe(200);
  expect(gated.body.action).toBe("allow");

  const rawGated = await get("/api/risk/gated", HEADERS.raw);
  expect(rawGated.status).toBe(403);
});

test("no HTTP client of any class reaches the JS-gated guards", async () => {
  // This is the line TLS impersonation cannot cross: proof-of-work, the WASM
  // check and canvas rendering all require an engine, not a better handshake.
  for (const p of ["/api/pow/challenge", "/api/wasm/verify"]) {
    const r = await get(p, HEADERS.impersonating);
    // Either the endpoint hands out a challenge it cannot solve, or refuses —
    // never the protected resource itself.
    expect(JSON.stringify(r.body)).not.toMatch(/FLAG-[A-Z]+-[0-9a-f]{4}\b/);
  }
});

test("the hidden-data routes hand every class the same content anyway", async () => {
  // Worth stating plainly: the elaborate client-class ladder above governs the
  // *guarded* endpoints. The recipe page's JSON-LD and hydration blob are
  // served to anyone, because SEO requires it. A raw `requests` call — the
  // weakest client on the list — gets the complete recipe.
  const raw = await get("/recipe", HEADERS.raw);
  expect(raw.status).toBe(200);
  expect(raw.body).toContain("application/ld+json");
  expect(raw.body).toContain("__INITIAL_STATE__");
});
