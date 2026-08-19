# scraping-guards

[![ci](https://github.com/sskieller/testproject/actions/workflows/ci.yml/badge.svg)](https://github.com/sskieller/testproject/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A deliberately hostile test target for scrapers — and for anti-scraping
defenses.** 83 guards plus a realistic eight-recipe site, with a Playwright
suite that asserts exactly what each class of client can and cannot reach.

Two ways to use it:

- **Testing a scraper?** Point it here and find out where it breaks. Every
  protected value is a `FLAG-<NAME>-<id>` token, so "did it work?" has a precise
  answer rather than an eyeball judgement.
- **Building defenses?** Lift the guards. Each one is small, commented, and
  honest about what defeats it.

No runtime dependencies — the server is Node built-ins only. Playwright is
dev-only, for the test suite.

## Quick start

```bash
npx github:sskieller/testproject serve        # then open http://localhost:8080
```

or from a clone:

```bash
git clone https://github.com/sskieller/testproject.git scraping-guards
cd scraping-guards
npm install
npx playwright install --with-deps chromium
npm test          # 192 tests
npm run serve     # http://localhost:8080
```

or without a Node toolchain:

```bash
docker build -t scraping-guards . && docker run --rm -p 8080:8080 scraping-guards
```

## Using it from another repo

This is the main way to consume it. Three options, in rough order of how much
control you want.

### 1. Embed it in your own test suite

```js
const { start } = require("scraping-guards");

let target;
beforeAll(async () => { target = await start({ port: 0 }); });  // 0 = free port
afterAll(() => target.stop());

test("my scraper handles a servings calculator", async () => {
  const result = await myScraper.scrape(`${target.url}/recipe/pici-ragu-bianco`);
  expect(result.ingredients).toContainEqual({ name: "'00' flour", qty: 800, unit: "g" });
});
```

`port: 0` picks a free port, so a consuming CI job never collides with whatever
else is listening. `target.url` is the base to scrape.

The package also re-exports the fixture data, so your assertions can reference
the same source of truth this project renders from instead of hardcoding values
that will drift:

```js
const { recipes } = require("scraping-guards");
expect(scraped.steps).toHaveLength(recipes.bySlug("pici-ragu-bianco").steps.length);
```

### 2. Run it as a service in CI

```yaml
# .github/workflows/scraper-tests.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - name: Start the scraping target
        run: npx --yes github:sskieller/testproject serve --port 8080 --quiet &

      - name: Wait for it
        run: npx --yes wait-on http://localhost:8080/robots.txt

      - run: npm test          # your scraper's tests, pointed at localhost:8080
```

Or as a service container, using the Docker image you publish from this repo.

### 3. Drive the CLI

```bash
npx scraping-guards serve --port 8080 [--no-mtls] [--quiet]
npx scraping-guards urls                  # every URL worth scraping, one per line
npx scraping-guards flags                 # expected FLAG tokens, as JSON
```

`urls` is handy for seeding a crawler; `flags` gives you the assertion set
without reading the source.

> **Note on the package name.** `scraping-guards` is what `package.json`
> declares, but I could not check npm for a collision from this environment. If
> you intend to `npm publish`, check availability first — the `npx github:` and
> Docker routes above work regardless.

---

## The recipe fixture — a semi-real target

The guard pages are obviously test pages. `/recipes` is not: it is an ordinary
recipe site — eight recipes, a paginated index, hero illustrations, long
preambles nobody asked for, servings calculators, numbered steps, equipment,
notes, nutrition and schema.org JSON-LD. Point a scraper at it and you learn
something the guard pages cannot tell you, because the obstacles are the ones
real sites create *by accident*.

### The crawl graph

There are **four independent routes to every recipe**, and a crawler that finds
only one of them still has to reach all eight. Tests assert each separately:

| Route | Needs JS? | How |
| --- | --- | --- |
| Index pagination | no | `?page=N` links, 3 per page |
| Infinite scroll | yes | the same pages, fetched on scroll |
| Related + prev/next | no | every detail page links onward — no dead ends |
| `sitemap.xml` | no | flat list of all eight |

A test crawls from `/recipes` following only pagination and reaches all eight in
four requests. Another starts from a single leaf recipe, never touches the
index, and reaches all eight through related and prev/next links alone. A third
asserts the scroll route and the pagination route return *exactly* the same set.

**Two recipes are full-length with 20 steps each; six are short.** That matters:
the short ones render every step server-side and must *not* advertise a lazy
loader, or a crawler waits forever for content that will never arrive. A test
checks the sentinel is present only when there is genuinely more to load.

The two long recipes also scale differently on purpose — one makes **12 buns**,
the other serves **4 people**. A scraper that learned "yield is 12" from the
first page gets the second one wrong.

Only the guards a real recipe site would plausibly have are switched on:
JS-rendered nutrition (1), lazy-loaded steps (6), the honeypot link (14),
per-request class names (31), the canary (41) and the text watermark (78).

What makes it a genuine exercise:

- **The servings calculator rewrites every quantity in the DOM.** Raw HTML only
  ever carries the base yield of 12. A scraper reporting "800 g flour" has run
  the page; one reporting "400 g" has not.
- **Not everything scales.** Yeast, salt and flaky salt are pinned, because a
  straight ×4 makes an inedible bun. A scraper that multiplies uniformly gets
  these wrong, and the API says so in a `reason` field rather than silently
  returning a bad number.
- **Steps 16–20 load on scroll**, and nutrition arrives from an API after load.
- **The JSON-LD undercuts both of those.** This is the most instructive part and
  it is not contrived: the structured data block carries all 20 steps and the
  full nutrition, so a scraper that reads JSON-LD gets everything without
  running any JavaScript. Real sites add lazy loading for performance and then
  hand it all back for SEO. A test asserts exactly this contradiction.

Everything renders from one object (`lib/recipe-data.js` + `lib/recipe-catalogue.js`),
so the DOM, the JSON API and the JSON-LD cannot drift apart — a test compares
them. Illustrations are generated SVG (`lib/recipeimg.js`), drawn per category
so each card looks like the distinct page it links to, and deliberately stylised
rather than synthetic photographs.

```bash
npm run serve                       # then open http://localhost:8080/recipes
curl -s localhost:8080/api/recipes                     # the whole catalogue
curl -s "localhost:8080/api/recipe?slug=pici-ragu-bianco&yield=8" | jq .ingredientGroups
curl -s localhost:8080/sitemap.xml
```

**The recipes are invented.** They exist to be scraped, not cooked from.

---

## The complete guard table

**Legend** — `real`: a genuine working defense. `sim`: simulated stub; the real
version needs infrastructure a Node server cannot reach (every such response
carries `simulated: true`). `part`: partly real, noted in the row.

Success flags are what a *sufficiently capable* client extracts. `-BOT`, `-429`
and similar tokens are the guard **firing** on automation — a scraper reaching
those has been caught, not succeeded.

| # | `data-guard` | Type | Technique | Success flag | Defeated by |
| ---: | --- | --- | --- | --- | --- |
| 0 | `baseline` | — | Plain server-rendered text — the control | `FLAG-BASELINE-0000` | Any HTTP client |
| 1 | `js-render` | real | Content injected by client-side JS | `FLAG-JSRENDER-7f3a` | Executing JS |
| 2 | `base64` | real | Base64 payload decoded at runtime | `FLAG-BASE64-9ad2` | Executing JS |
| 3 | `rot13` | real | ROT13 payload decoded at runtime | `FLAG-ROT13-e7f4` | Executing JS |
| 4 | `canvas-text` | real | Text drawn to `<canvas>`; base64 source, pixels only | `FLAG-CANVAS-4e1d` | OCR / vision model |
| 5 | `shadow-dom` | real | Content in an open shadow root, outside the light DOM | `FLAG-SHADOW-c7e0` | Shadow-aware DOM query |
| 6 | `lazy-load` | real | `IntersectionObserver`; materializes on scroll | `FLAG-LAZY-1b8f` | Scrolling a real browser |
| 7 | `time-gated` | real | Appears only after a `setTimeout` delay | `FLAG-TIMED-5c2a` | Waiting after load |
| 8 | `click-reveal` | real | Revealed only on a click event | `FLAG-CLICK-9d63` | Simulated interaction |
| 9 | `css-pseudo` | real | Token lives in a CSS `::after` rule in an external sheet | `FLAG-CSSPSEUDO-b21c` | Reading computed style |
| 10 | `css-reversed` | real | Stored backwards in the DOM, flipped visually by CSS | `FLAG-REVERSED-9f7a` | Reversing the string |
| 11 | `css-order` | real | DOM order scrambled; flex `order` restores reading order | `FLAG-CSSORDER-c518` | Rendering CSS |
| 12 | `zero-width` | real | U+200B chars interleaved to break substring matching | `FLAG-ZWSP-33ab` | Stripping zero-width chars |
| 13 | `email-obfuscation` | real | HTML-entity encoded, TLD appended by JS | `secret@example.com` | Executing JS |
| 14 | `honeypot-link` | real | Off-screen link to `/trap` → 403 | `FLAG-TRAP-DONOTFOLLOW` | **Not following hidden links** |
| 15 | `honeypot-field` | real | Hidden form field → 400 when filled | `FLAG-HPFIELD-BOT` | **Leaving hidden fields blank** |
| 16 | `decoy-data` | real | Hidden fake token beside the real one | `FLAG-REAL-a90c` | Respecting CSS visibility |
| 17 | `webdriver` | real | `navigator.webdriver` check | `FLAG-WEBDRIVER-BOT` | Patching the flag |
| 18 | `headless` | real | UA / plugins / languages / `chrome` heuristics | `FLAG-HEADLESS-BOT` | A full stealth profile |
| 19 | `webgl` | real | SwiftShader / llvmpipe renderer detection | `FLAG-WEBGL-BOT` | Real or spoofed GPU |
| 20 | `canvas-fp` | real | Canvas render hash — identical hashes reveal a farm | `FLAG-CANVASFP-<hash>` | Randomized fingerprint |
| 21 | `behavior` | real | Requires genuine pointer movement | `FLAG-BEHAVIOR-2f8e` | Synthesized input |
| 22 | `fetch-token` | real | Static `X-Scrape-Token` header gate | `FLAG-APITOKEN-8b04` | Replaying the header |
| 23 | `iframe` | real | Content in a nested document | `FLAG-IFRAME-6a2d` | Descending into frames |
| 24 | `anti-copy` | real | Blocks copy / cut / select / context menu | `FLAG-ANTICOPY-71bd` | Reading the DOM directly |
| 25 | `rate-limit` | real | Fixed-window 429 per IP | `FLAG-RATELIMIT-429` | Throttling / IP rotation |
| 26 | `captcha-interstitial` | real | Canvas challenge gates `/gated`; single-use, cookie-bound | `FLAG-CAPTCHA-3a91` | OCR + arithmetic |
| 27 | `proof-of-work` | real | SHA-256 with 4 leading zero hex chars; single-use | `FLAG-POW-7c25` | Burning CPU per page view |
| 28 | `glyph-font` | real | Font `cmap` rewritten so DOM text ≠ rendered text | `FLAG-GLYPHFONT-d4c7` | Reversing the cipher |
| 29 | `aes-crypto` | real | AES-GCM payload, PBKDF2 key derived in-browser | `FLAG-AESGCM-e60a` | Running `crypto.subtle` |
| 30 | `signed-token` | real | HMAC-signed token with a 3-second TTL | `FLAG-SIGNEDTOKEN-b4f8` | Re-issuing per request |
| 31 | `dom-randomization` | real | Class and attribute names regenerated every response | `FLAG-DOMRAND-1f4c` | Structural, not selector, extraction |
| 32 | `header-validation` | real | `Sec-Fetch-*`, Client Hints, and **header ordering** | `FLAG-HEADERS-c1d7` | Exact browser header emulation |
| 33 | `referer-origin` | real | Same-origin `Referer` required on subresources | `FLAG-REFERER-90ce` | Setting `Referer` |
| 34 | `cookie-session` | real | Session cookie + CSRF double-submit | `FLAG-SESSION-5d13` | Stateful session handling |
| 35 | `automation-artifacts` | real | `cdc_`, CDP, AudioContext, WebRTC, timezone-vs-locale | `FLAG-ARTIFACTS-a72f` | Full stealth patching |
| 36 | `behavior-advanced` | real | Path curvature, sampling jitter, keystroke cadence, fill time | `FLAG-BEHAVIORADV-8ef2` | Realistic input synthesis |
| 37 | `cursor-pagination` | real | HMAC-signed cursors; flag only on the last page | `FLAG-CURSOR-4b7d` | Walking pages in order |
| 38 | `sse-transport` | real | Content pushed over Server-Sent Events | `FLAG-SSE-2d90` | Holding the stream open |
| 39 | `websocket-transport` | real | Content over an RFC 6455 upgrade + correct command | `FLAG-WEBSOCKET-f719` | Speaking the protocol |
| 40 | `ratelimit-advanced` | real | Sliding window, token bucket, and a **tarpit** that slows instead of refusing | `FLAG-SLIDING-429`, `FLAG-BUCKET-429`, `FLAG-TARPIT-SLOWED` | Distributed slow crawling |
| 41 | `canary-token` | real | Per-client watermark on every response | `FLAG-CANARY-c3b8` + `CANARY-<hmac>` | *Not defeatable — it is forensic* |
| 42 | `tls-fingerprint` | sim | JA3/JA4 TLS fingerprint. Real: ClientHello via HAProxy/Envoy/nginx-ssl-ja3 | `FLAG-JA3-ok` / `-BOT` | Matching a browser's TLS stack |
| 43 | `http2-fingerprint` | sim | Akamai H2 fingerprint. Real: SETTINGS/WINDOW_UPDATE/PRIORITY frames | `FLAG-H2FP-ok` / `-BOT` | Speaking browser-shaped HTTP/2 |
| 44 | `os-fingerprint` | sim | p0f-style TCP/IP stack. Real: raw packet capture (TTL, window, MSS) | `FLAG-OSFP-ok` / `-BOT` | Matching UA to the real stack |
| 45 | `ip-reputation` | sim | ASN / VPN / Tor. Real: MaxMind, IPQualityScore, Tor exit list | `FLAG-IPREP-ok` / `-BOT` | Residential proxies |
| 46 | `connection-limit` | part | Concurrent sockets per IP — genuinely counted; TLS resumption is not | `FLAG-CONNLIMIT-ok` / `-BOT` | Connection pooling |
| **47** | **`risk-engine`** | real | **Weighted signal scoring with proportional escalation: `allow → monitor → challenge → tarpit → block`** | `FLAG-RISK-ALLOW-2b6d` | Suppressing enough signal *mass* at once |
| 48 | `subresource` | real | Verifies the CSS, font and image were actually fetched | `FLAG-SUBRESOURCE-7a15` | Loading subresources (being a browser) |
| 49 | `anti-debug` | real | `debugger` timing, viewport gap, console tripwire, builtin tamper check | `FLAG-ANTIDEBUG-6c4f` | Patching the checks |
| 50 | `obfuscation` | real | Packed bundle + runtime SHA-256 integrity check against a manifest | `FLAG-INTEGRITY-0f5c` | Unpacking — and it *is* unpackable |
| 51 | `wasm-challenge` | real | Decode routine in a hand-assembled 43-byte WebAssembly module | `FLAG-WASM-9b31` | Instantiating or disassembling it |
| 52 | `labyrinth` | real | Endless deterministic maze; robots-disallowed, so entry *is* the signal | `FLAG-LABYRINTH-TRAPPED` | Obeying `robots.txt` |
| 53 | `compression-bomb` | real | 2 MB gzip expansion, blocked clients only, 10 MB hard cap | `FLAG-BOMB-SERVED` | Streaming / honouring `Content-Length` |
| 54 | `poisoning` | real | Unlimited plausible, deterministic, entirely false records | `FLAG-RECORDS-REAL-5f81` (real data) | Detecting you were classified as a bot |
| 55 | `sprite-digits` | real | Digits as `background-position` offsets — no numerals in the DOM | *(renders `4291`)* | OCR / sprite-offset arithmetic |
| 56 | `pixel-text` | real | Server-rasterised bitmap font; string absent from the response entirely | `FLAG-PIXELS-8D20` *(pixels only)* | OCR |
| 57 | `fragmentation` | real | Value split across random spans with hidden decoys, per request | `FLAG-FRAGMENT-d71a` | Respecting CSS visibility |
| 58 | `ssr-variance` | real | Nesting depth and attribute order vary every response | `FLAG-SSRVAR-6b0e` | Semantic, not structural, extraction |
| 59 | `accounts` | real | Login + per-key quota + device binding | `FLAG-ACCOUNT-3d0b` | Buying accounts |
| 60 | `mtls` | real | **Real mutual TLS** on port +1; CA-signed client cert required | `FLAG-MTLS-4e77` | Possessing a signed client key |
| 61 | `attestation` | sim | Play Integrity / App Attest. Real: server-to-server with Google/Apple | `FLAG-ATTEST-ok` / `-BOT` | A genuine attested device |
| 62 | `private-access-token` | sim | Privacy Pass. Real: RFC 9577 issuer relationship | `FLAG-PAT-ok` / `-BOT` | A genuine issued token |
| 63 | `persisted-queries` | real | Only allowlisted query hashes execute; ad-hoc text refused | `FLAG-PERSISTEDQ-11ac` | Using sanctioned queries only |
| 64 | `request-signing` | real | HMAC over method+path+timestamp+nonce+body; single-use nonce | `FLAG-REQSIGN-c92e` | Holding the signing secret |
| 65 | `binary-protocol` | real | TLV with per-session re-keyed field names | `FLAG-BINPROTO-a4d6` | Re-deriving the schema each session |
| 66 | `nav-graph` | real | Dwell-time and navigation-path plausibility | `FLAG-NAVGRAPH-1c73` | Realistic pacing |
| 67 | `conditional-requests` | real | `If-None-Match` revalidation behaviour | `FLAG-ETAG-b508` | Implementing a cache |
| 68 | `css-fingerprint` | real | Media queries pull distinct images — **works with JS disabled** | `FLAG-CSSFP-9e42` | Rendering CSS honestly |
| 69 | `fingerprint-surfaces` | real | Fonts, codecs, voices, timer resolution, WebGPU, clock skew | `FLAG-FPSURFACE-4a8e` | A full stealth profile |
| 70 | `ai-declarative` | real | `ai.txt`, `llms.txt`, robots AI blocks, `noai` meta, TDM reservation | `FLAG-AIDECLARE-2f70` | *(Declaration, not enforcement)* |
| 71 | `quic-fingerprint` | sim | HTTP/3 QUIC. Real: transport params via an HTTP/3 terminator | `FLAG-QUICFP-ok` / `-BOT` | Speaking browser-shaped QUIC |
| 72 | `data-perturbation` | real | **Real** records returned with small deterministic drift — right shape, right magnitudes, quietly wrong | *(no flag — that is the point)* | Reconciling against a trusted source |
| 73 | `per-char-render` | real | Every character drawn to its own canvas, DOM order shuffled, CSS `order` restores it | `FLAG-PERCHAR-5e88` | OCR **plus** honouring CSS order |
| 74 | `tiered-access` | real | Field-level projection by plan — premium fields absent below `pro`, not hidden | `FLAG-TIERED-b7c2` | Paying for a `pro` account |
| **75** | **`verified-crawler`** | real | **Forward-confirmed reverse DNS allowlisting — the counterpart to 47: lets the *right* bots through** | `FLAG-VERIFIEDBOT-9d14` | Controlling the operator's DNS (i.e. you cannot) |
| **76** | **`adaptive-risk`** | real | **Weights learn from honeypot ground truth; clamped 0.5x–1.5x** | *(see `/api/risk/weights`)* | Avoiding every conclusive guard while leaking nothing |
| 77 | `enumeration` | real | Sequential runs, keyspace coverage, monotonic traversal, no-revisits | `FLAG-ENUMERATION-8c31` | Scraping in genuinely human-shaped access patterns |
| 78 | `text-watermark` | real | Recipient id encoded in zero-width chars *inside* the prose | `FLAG-WATERMARK-4b90` | Stripping non-printing characters |
| **79** | **`response-modes`** | real | **Ways to say no beyond 403: redirect, empty result set, and socket hangup (indistinguishable from a network fault)** | `FLAG-DEGRADE-*` | Distinguishing a block from a network fault |
| 80 | `api-honeypot` | real | Undocumented decoy field in a JSON response; dereferencing it is conclusive | `FLAG-APIHONEYPOT-BOT` | **Not walking undocumented fields** |
| **81** | **`pay-per-crawl`** | real | **HTTP 402 + HMAC receipt scoped to one path and crawler — price access instead of blocking it** | `FLAG-PAYCRAWL-PAID-1c4e` | Paying |
| 82 | `crawler-policy` | real | Per-path policy keyed on the *verified* identity from guard 75, not the UA | `FLAG-CRAWLPOLICY-ALLOW-3f21` | Being a crawler the path actually permits |
| **83** | **`sensor-data`** | real | **Signals sealed into an AES-GCM blob keyed to a single-use server nonce — the shape of `_abck` / `_px` / `reese84` / `aws-waf-token`** | `FLAG-SENSOR-8f27` | Reverse-engineering the collector, then matching its claims to your own request |

### Forcing a verdict on the simulated guards

Every `sim` guard exposes a header so CI can exercise **both** branches:

| Guard | Header |
| --- | --- |
| 42 `tls-fingerprint` | `X-Sim-JA3: python-requests \| curl \| Go-http-client \| chrome` |
| 43 `http2-fingerprint` | `X-Sim-H2: browser \| <anything else>` |
| 44 `os-fingerprint` | `X-Sim-OS: Linux \| Windows \| macOS` |
| 45 `ip-reputation` | `X-Sim-IP-Type: datacenter \| vpn \| tor \| proxy \| residential` |
| 71 `quic-fingerprint` | `X-Sim-QUIC: bot` |
| 53 `compression-bomb` | `X-Sim-Bot: true` (forces the bomb path) |

`tests/stubs.spec.js` asserts that each stub still declares `simulated: true` and
that `lib/netstub.js` documents its real-world requirement — so a stub can never
quietly be mistaken for a working control.

---

## Expected results by client class

| Client | Reaches | Caught by | Verdict |
| --- | --- | --- | --- |
| **`curl` / `requests`** (raw HTML) | Guard 0, plus the *encoded* blobs of 2, 3, 10 | 14, 15, 32, 33, 48, 67 — and poisoned by 16 and 54 | `block` |
| **TLS-impersonating client** (`curl_cffi`, `primp`, `hrequests`) | Everything above, plus 42–44 outright — the handshake, the HTTP/2 frames and the header order all match a real Chrome | 1, 6, 51, 55 and every other JS-gated guard: a better socket still runs no code | `challenge` |
| **Headless browser** (JS, no stealth) | 1–13, 22–23, 26–41, 51, 55–58, 63–70 | 17, 18, 19, 32, 35 | `tarpit` |
| **Anti-detect browser** (`nodriver`, `camoufox`, `puppeteer-extra`) | Most of the above; `navigator.webdriver`, the UA and the GPU string are all patched | 48, 60, 66 remain hard; 36 and 66 read behaviour, which patching does not touch | `challenge` |
| **AI browser agent** (`browser-use`, `skyvern`, `stagehand`) | A real browser, so the fingerprint is genuine | 36 and 66: it clicks by coordinate after a screenshot, so the pointer teleports and every step waits on an LLM round-trip | `challenge` |
| **Compliant crawler** (obeys robots) | Public pages | Avoids 14 and 52 by construction — which is the point | `allow` |

A raw `curl` request scores **83** on the risk engine (guard 47) — `http-library-ua`
45 + `missing-sec-fetch` 20 + `no-referer` 10 + `no-languages` 8 — which lands in
the **block** band.

The verdict column is not documentation: `tests/client-classes.spec.js` builds each
client's signal set and asserts the ladder actually returns these actions, so the
table cannot drift away from the weights.

Two of those rows are worth reading together. TLS impersonation is a real,
cheap win — it clears the entire transport tier — and it buys nothing at all
against a guard that needs a JavaScript engine. The anti-detect browser and the
AI agent land within a few points of each other because from the server they
look nearly identical; only **behaviour** separates them.

---

## The five hidden-data routes

Every guard above makes the *rendered page* harder to parse. None of them touch
the structured data the same page publishes for search engines. The recipe
fixture emits all five routes [webscraping.fyi catalogues](https://webscraping.fyi/learn/hidden-web-data/),
from a single source object:

| # | Route | Carries | Needs JS? |
| ---: | --- | --- | --- |
| 1 | `<script type="application/ld+json">` | The complete `schema.org/Recipe` — all 20 steps | No |
| 2 | `window.__INITIAL_STATE__` hydration blob | Everything route 1 has **plus** nutrition, which the DOM fetches over XHR | No |
| 3 | Open Graph / Twitter / `product:price:*` meta tags | Title, description, image, publish dates, price | No |
| 4 | Microdata (`itemscope` / `itemprop`) | Only what is *rendered* — so it stops where lazy loading does | No |
| 5 | `data-qty` / `data-unit` / `data-scalable` | Parsed quantities, no regex over `"2 tbsp"` needed | No |

`tests/hidden-data.spec.js` asserts the routes **agree with each other** and with
the API, and that all five survive with JavaScript disabled in the browser.

This is the lesson the fixture exists to teach: guard 6 withholds seventeen
steps from a raw HTTP client, and route 1 hands all twenty back in the same
response — because SEO requires it. Real recipe sites ship this contradiction
every day.

### The hidden API

The endpoints the page's own JavaScript calls are subject to **none** of the
presentation-layer guards, because those guards exist to make HTML hard to parse
and JSON is not HTML:

| Bypassed | What the API does instead |
| --- | --- |
| 1 `js-render` | Returns rendered values; no engine needed |
| 6 `lazy-load` | All 20 steps in one GET, no scrolling |
| 31 `dom-randomization` | Stable keys — two calls are byte-identical |
| 57 `fragmentation` | `qty` is a number, not spans with hidden decoys |
| 58 `ssr-variance` | Fixed shape, so a selector written once keeps working |

It is also a *compute* leak: `/api/recipe?yield=8` performs the scaling, including
which ingredients refuse to scale, so a scraper never reimplements that logic.
Hardening pages while leaving their feeding endpoint open is the most common
real-world hole this project models.

---

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Router for guards 0–46 |
| `routes-frontier.js` | Router for guards 47–83 |
| `lib/risk.js` | **Weighted scoring + escalation ladder (47)** |
| `lib/tokens.js` | HMAC tokens, signed cursors, proof-of-work, canaries (27, 30, 37, 41) |
| `lib/ratelimit.js` | Sliding window, token bucket, tarpit (40) |
| `lib/headers.js` | Header presence / ordering / Client Hints (32, 33) |
| `lib/session.js` | Cookie sessions + CSRF (34) |
| `lib/websocket.js` | Minimal RFC 6455 server, no deps (39) |
| `lib/netstub.js` | Tier 2 stubs (42–46) |
| `lib/labyrinth.js` | Maze, compression bomb, poisoning (52–54) |
| `lib/pngtext.js` | Bitmap-font PNG encoder (55, 56) |
| `lib/accounts.js` | Accounts, quota, device binding + attestation stubs (59, 61, 62) |
| `lib/mtls.js` | Mutual-TLS listener; certs generated on demand (60) |
| `lib/apishape.js` | Persisted queries, request signing, binary protocol (63–65) |
| `lib/sensor.js` | **Encrypted single-use sensor blob (83)** |
| `src/antidebug.src.js` → `antidebug.js` | Anti-debug source and its packed build (49, 50) |
| `tools/generate-cipher-font.py` | Rewrites a font's `cmap` (28) |
| `tools/make-wasm.js` | Hand-assembles the wasm module (51) |
| `tools/obfuscate.js` | Packs the bundle + writes `integrity.json` (50) |
| `ai.txt`, `llms.txt`, `robots.txt` | Declarative layer (70) |
| `tests/*.spec.js` | 192 Playwright tests across all guards, the recipe fixture and the crawl graph |
| `index.js` | Programmatic entry point — `start({ port })` for embedding |
| `bin/scraping-guards.js` | CLI: `serve`, `urls`, `flags` |
| `Dockerfile` | Run the target with no Node toolchain |
| `docs/TIER3-COMMERCIAL.md` | Managed bot-defense options and costs |

### Regenerating build artifacts

```bash
npm run build   # wasm/challenge.wasm + antidebug.js + integrity.json
npm run font    # fonts/cipher.woff2  (needs: pip install fonttools brotli)
```

Both are deterministic — rebuilding produces byte-identical output.
`certs/` is generated on demand by guard 60 and is **gitignored**; private keys
are never committed, even test ones.

---

## Three things to be clear about

**1. This is not "every known guard."** Anti-scraping is adversarial and
evolving, and no canonical list exists. This is a broad working cross-section.
The deliberate gaps are per-session generated challenge VMs, commercial-grade
obfuscation, and the one capability you cannot self-host at any effort level —
**cross-customer intelligence**, where a vendor recognises a scraper's
fingerprint from other properties before it ever reaches you.

**2. The obfuscation is packing, not protection.** Guard 50 uses base64 +
chunk shuffling. Real products use control-flow flattening, opaque predicates
and per-session VMs. It raises the cost of a first look; it will not stop a
determined analyst, and nothing that runs in the client ever can. The honesty
note lives in `tools/obfuscate.js` and a test asserts it stays there.

**3. This test target undercuts its own guard 31.** Every section here carries a
stable `data-guard="…"` attribute, and guard 31 randomizes class and attribute
names precisely so that selectors like that stop working. The attributes exist
because the test suite needs a reliable way to find each guard — but a real site
following this repo's own advice would not ship them. If you lift these guards,
drop the `data-guard` hooks; leaving stable selectors in place hands a scraper
exactly what guard 31 is trying to take away.

**4. Blocking without an allowlist is the most common way to hurt yourself.**
Guards 1–74 all block or degrade; guard 75 is the only one that lets anything
*through*. Turn the rest up without a verified-crawler allowlist and you will
quietly delist yourself from search — the failure is invisible until traffic
drops. If you take one thing from this repo into production, take guard 47's
proportional escalation and guard 75's allowlist, in that order.

**5. Several guards harm real users.** `anti-copy` (24), `canvas-text` (4),
`pixel-text` (56), `glyph-font` (28) and `sprite-digits` (55) are invisible or
useless to screen readers; `compression-bomb` (53) is deliberately costly to the
client. They are here because a test target should cover techniques that exist,
not because they are all advisable. In production, prefer guard 47's
proportional escalation over any blanket block, and always keep an accessible
path.

---

## Cross-checked against published guides

Guards 79–82 and the `monitor` rung came from reviewing six practitioner
sources (Apify Academy, Cloudflare, Browserless, Firecrawl, an engineer's
handbook, and the antiscraping-toolkit repo). Most of what they describe was
already covered. What was not:

| Source said | Was missing | Now |
| --- | --- | --- |
| Detection responses include redirect, empty results, and socket hangup — not just 403 | Ladder only had `block` | Guard 79 |
| Systems greylist before challenging | Ladder jumped `allow → challenge` | `monitor` rung |
| "Poisoned JSON objects" trap API clients | Honeypots were HTML-only | Guard 80 |
| Charge AI crawlers rather than block them | No monetisation path at all | Guard 81 |
| Restrict *which pages* are crawlable | robots.txt only, unenforced | Guard 82 |
| A programmatic `.click()` fires no hover first | Not checked | Guard 36 refinement |

### webscraping.fyi

A later pass over [webscraping.fyi](https://webscraping.fyi/)'s learning
material — written from the *scraper's* side, which is exactly why it was
useful — surfaced four more gaps:

| Source said | Was missing | Now |
| --- | --- | --- |
| Commercial systems ship signals as an encrypted single-use blob (`_abck`, `_px`, `reese84`, `aws-waf-token`), not readable JSON | Guard 36 posted plaintext telemetry anyone could hand-write | Guard 83 |
| Structured data hides in five places, not one | Only JSON-LD was emitted | Hydration blob, meta tags, microdata and `data-*` routes |
| `curl_cffi` / `primp` / `hrequests` reproduce a real browser ClientHello | `lib/netstub.js` called a JA3/UA mismatch "the highest-signal bot tell there is" | Corrected in place; JA3 is one weighted input, not a verdict |
| The tooling landscape is five distinct classes, not "bot vs browser" | Client matrix had four rows and no assertions | Six rows, each executed by `tests/client-classes.spec.js` |

That last correction is the useful kind: the fixture had been overstating a
guard's strength, and a source written by the people evading it said so.

Two claims in those sources are worth contradicting. Honeypots are repeatedly
shown using `display: none`; that is the *weakest* form, because scrapers
routinely filter it — guard 14 uses off-screen positioning plus `aria-hidden`
instead (see the note in `index.html`). And rotating CSS classes is presented
as a per-deploy build step; guard 31 rotates them **per request**, which is
strictly stronger and no harder to implement server-side.

## A finding from building this

Playwright-driven Chromium **fails guard 32** on header order alone. The
automation layer injects `Accept-Language` out of Chrome's natural position:

```
vanilla Chrome fetch: … user-agent, sec-ch-ua, sec-ch-ua-mobile, accept, …, accept-encoding, accept-language
under Playwright:     … user-agent, sec-ch-ua, ACCEPT-LANGUAGE, sec-ch-ua-mobile, accept, …, accept-encoding
```

The suite asserts both sides: a raw request with vanilla ordering passes, and
the same header *values* in python-requests' order are rejected. Header order is
checked over a core subset that stays stable across navigation and fetch
requests — Chrome uses different orders for each, so a single canonical list
would false-positive on real browsers.

## CI

`.github/workflows/scraping-guards.yml` runs all 192 tests on push and PR. Tests
are serial (`fullyParallel: false`) because the rate-limit, quota and connection
guards are stateful.

---

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

The one rule that matters: **a guard must be honest about what it is.** If it
cannot really work in this environment, it declares `simulated: true` and
documents what real detection would require. There are tests that enforce this,
and they are not decoration — a fixture that overstates its own capability is
worse than no fixture.

## Licence

[MIT](LICENSE). The recipes, ratings, authorship and nutrition figures are all
invented; the illustrations are generated SVG. Nothing here is scraped from
anyone.

## A word on intent

This exists so people can test scrapers and defenses against something
repeatable. The techniques it demonstrates are dual-use by nature — that is
inherent to the subject, not a property of this repo — but a few things are
worth stating plainly:

- Several guards **actively harm disabled users** (see caveat 5 above). They are
  catalogued because they exist in the wild, not because they are advisable.
- The adversarial guards (labyrinth, compression bomb, poisoning) are aimed at
  traffic you have already classified as automated, on infrastructure you own.
  The compression bomb is capped at 10 MB by design.
- If you are on the scraping side: `robots.txt`, `ai.txt` and `llms.txt` here
  say no. A fixture is a fine place to ignore that; a real site is not.
