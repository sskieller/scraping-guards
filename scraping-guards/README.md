# Scraping Guards Test Page

A self-contained target for testing scrapers and anti-scraping defenses in CI.
**71 guards** (plus one control), each emitting a `FLAG-<NAME>-<id>` token so a
test can assert exactly what a given class of client can and cannot reach.

Point your scraper at it and see how far it gets. Or lift the guards and test
your own defenses against them.

```bash
cd scraping-guards
npm install
npx playwright install --with-deps chromium
npm test          # boots server.js, runs all 91 tests
npm run serve     # http://localhost:8080
```

| Page | Guards | What lives there |
| --- | --- | --- |
| [`index.html`](index.html) | 0–25 | Obfuscation, honeypots, basic bot detection |
| [`advanced.html`](advanced.html) | 26–46 | Challenges, crypto, transports, fingerprint stubs |
| [`frontier.html`](frontier.html) | 47–71 | Risk engine, adversarial responses, identity, API shape |

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
| **47** | **`risk-engine`** | real | **Weighted signal scoring with proportional escalation: `allow → challenge → tarpit → block`** | `FLAG-RISK-ALLOW-2b6d` | Suppressing enough signal *mass* at once |
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

| Client | Reaches | Caught by |
| --- | --- | --- |
| **`curl` / `requests`** (raw HTML) | Guard 0, plus the *encoded* blobs of 2, 3, 10 | 14, 15, 32, 33, 48, 67 — and poisoned by 16 and 54 |
| **Headless browser** (JS, no stealth) | 1–13, 22–23, 26–41, 51, 55–58, 63–70 | 17, 18, 19, 32, 35 |
| **Stealth browser** | Most of the above | 48, 60, 66 remain hard; 47 aggregates whatever leaks |
| **Compliant crawler** (obeys robots) | Public pages | Avoids 14 and 52 by construction — which is the point |

A raw `curl` request scores **83** on the risk engine (guard 47) — `http-library-ua`
45 + `missing-sec-fetch` 20 + `no-referer` 10 + `no-languages` 8 — which lands in
the **block** band.

---

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Router for guards 0–46 |
| `routes-frontier.js` | Router for guards 47–71 |
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
| `src/antidebug.src.js` → `antidebug.js` | Anti-debug source and its packed build (49, 50) |
| `tools/generate-cipher-font.py` | Rewrites a font's `cmap` (28) |
| `tools/make-wasm.js` | Hand-assembles the wasm module (51) |
| `tools/obfuscate.js` | Packs the bundle + writes `integrity.json` (50) |
| `ai.txt`, `llms.txt`, `robots.txt` | Declarative layer (70) |
| `tests/*.spec.js` | 91 Playwright tests across all guards |
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

**3. Several guards harm real users.** `anti-copy` (24), `canvas-text` (4),
`pixel-text` (56), `glyph-font` (28) and `sprite-digits` (55) are invisible or
useless to screen readers; `compression-bomb` (53) is deliberately costly to the
client. They are here because a test target should cover techniques that exist,
not because they are all advisable. In production, prefer guard 47's
proportional escalation over any blanket block, and always keep an accessible
path.

---

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

`.github/workflows/scraping-guards.yml` runs all 91 tests on push and PR. Tests
are serial (`fullyParallel: false`) because the rate-limit, quota and connection
guards are stateful.
