# Scraping Guards Test Page

A self-contained target for testing scrapers and anti-scraping defenses in CI.
**46 guards** across three tiers, each emitting a `FLAG-<NAME>-<id>` token so a
test can assert exactly what a given class of client can and cannot reach.

| Tier | Guards | Status |
| --- | --- | --- |
| **0–1 — application layer** | 0–41 | **Fully implemented** — real defenses |
| **2 — network layer** | 42–46 | **Simulated stubs** — a Node server cannot observe TLS/TCP; every response is marked `simulated: true` |
| **3 — managed services** | — | Not code. See [`docs/TIER3-COMMERCIAL.md`](docs/TIER3-COMMERCIAL.md) for what to install and what it costs |

## Layout

| File | Purpose |
| --- | --- |
| `index.html` / `guards.js` / `guards.css` | Guards 0–25 |
| `advanced.html` / `guards-advanced.js` | Guards 26–46 |
| `cipher.css` + `fonts/cipher.woff2` | Glyph-substitution cipher font (guard 28) |
| `tools/generate-cipher-font.py` | Regenerates that font by rewriting a font's `cmap` |
| `server.js` | Router for every HTTP-dependent guard |
| `lib/tokens.js` | HMAC-signed tokens, signed cursors, proof-of-work, canaries |
| `lib/ratelimit.js` | Sliding window, token bucket, tarpit |
| `lib/headers.js` | Header presence / ordering / Client Hints, referer |
| `lib/session.js` | Cookie sessions + CSRF double-submit |
| `lib/websocket.js` | Minimal RFC 6455 server (no deps) |
| `lib/netstub.js` | **Tier 2 stubs** — documents what real detection needs |
| `tests/guards.spec.js` | Guards 0–25 |
| `tests/advanced.spec.js` | Guards 26–41 |
| `tests/stubs.spec.js` | Guards 42–46 + stub-honesty guardrails |

## Run

```bash
cd scraping-guards
npm install
npx playwright install --with-deps chromium
npm test                 # boots server.js, runs all 56 tests

npm run serve            # http://localhost:8080  → index.html
                         # http://localhost:8080/advanced.html → tiers 1 & 2
npm run font             # regenerate cipher.woff2 (needs: pip install fonttools brotli)
```

## Flag convention

- `FLAG-<NAME>-<id>` — content a sufficiently capable client *should* extract.
- `FLAG-<NAME>-BOT` / `-429` / `-DONOTFOLLOW` — a guard **firing** on a bot.
- `FLAG-DECOY-FAKE-*` — poison; a correct scraper must **not** treat it as real.

## Guard catalog

### Tier 0–1 · Application layer (implemented)

| # | `data-guard` | Technique | Defeated by |
| --- | --- | --- | --- |
| 0 | `baseline` | Plain server-rendered text (control) | Any HTTP client |
| 1 | `js-render` | Content injected by JS | JS execution |
| 2 | `base64` | Base64 payload decoded at runtime | JS execution |
| 3 | `rot13` | ROT13 payload decoded at runtime | JS execution |
| 4 | `canvas-text` | Text drawn to `<canvas>` as pixels | OCR / vision |
| 5 | `shadow-dom` | Content in a shadow root | Shadow-aware query |
| 6 | `lazy-load` | IntersectionObserver on scroll | Scrolling a real browser |
| 7 | `time-gated` | Appears after `setTimeout` | Waiting after load |
| 8 | `click-reveal` | Revealed on click | Simulated interaction |
| 9 | `css-pseudo` | Text in CSS `::after` (external sheet) | Computed-style read |
| 10 | `css-reversed` | Stored backwards, flipped by CSS | Reversing the string |
| 11 | `css-order` | DOM scrambled, reordered by flex `order` | Rendering CSS |
| 12 | `zero-width` | U+200B breaks substring matches | Stripping zero-width chars |
| 13 | `email-obfuscation` | Entity-encoded + JS-assembled | JS execution |
| 14 | `honeypot-link` | Off-screen link → 403 | **Not following hidden links** |
| 15 | `honeypot-field` | Hidden form field → 400 if filled | **Leaving hidden fields blank** |
| 16 | `decoy-data` | Hidden fake flag beside the real one | Respecting CSS visibility |
| 17 | `webdriver` | `navigator.webdriver` | Patching the flag |
| 18 | `headless` | UA / plugins / languages heuristics | Stealth profile |
| 19 | `webgl` | SwiftShader / llvmpipe renderer | Real or spoofed GPU |
| 20 | `canvas-fp` | Canvas fingerprint hash | Randomized fingerprint |
| 21 | `behavior` | Requires pointer movement | Synthesized input |
| 22 | `fetch-token` | Static `X-Scrape-Token` header | Replaying the header |
| 23 | `iframe` | Nested document | Descending into frames |
| 24 | `anti-copy` | Blocks copy / select / context menu | Reading the DOM |
| 25 | `rate-limit` | Fixed-window 429 | Throttling / IP rotation |
| **26** | `captcha-interstitial` | Canvas challenge gates `/gated`; single-use, cookie-bound | OCR + arithmetic |
| **27** | `proof-of-work` | SHA-256 with 4 leading zero hex chars; single-use | Burning CPU per page |
| **28** | `glyph-font` | Font `cmap` rewritten so DOM text ≠ rendered text | Reversing the cipher |
| **29** | `aes-crypto` | AES-GCM payload, PBKDF2 key derived in-browser | Running `crypto.subtle` |
| **30** | `signed-token` | HMAC-signed, 3-second TTL | Re-issuing per request |
| **31** | `dom-randomization` | Class/attribute names regenerated per request | Structural selectors |
| **32** | `header-validation` | `Sec-Fetch-*`, Client Hints, **header ordering** | Exact browser header emulation |
| **33** | `referer-origin` | Same-origin `Referer` required | Setting Referer |
| **34** | `cookie-session` | Session cookie + CSRF double-submit | Stateful session handling |
| **35** | `automation-artifacts` | `cdc_`, CDP, AudioContext, WebRTC, tz-vs-locale | Full stealth patching |
| **36** | `behavior-advanced` | Path curvature, sampling jitter, keystroke cadence, fill time | Realistic input synthesis |
| **37** | `cursor-pagination` | HMAC-signed cursors; flag only on last page | Walking pages in order |
| **38** | `sse-transport` | Content over Server-Sent Events | Holding the stream open |
| **39** | `websocket-transport` | Content over a WS protocol upgrade | Speaking the protocol |
| **40** | `ratelimit-advanced` | Sliding window, token bucket, **tarpit** | Distributed slow crawling |
| **41** | `canary-token` | Per-client watermark on every response | (Not defeatable — it's forensic) |

### Tier 2 · Network layer (simulated stubs)

Each returns `simulated: true` and names the infrastructure real detection needs.
Force either branch with a header, so CI can exercise both paths.

| # | `data-guard` | Simulates | Test hook | Real requirement |
| --- | --- | --- | --- | --- |
| 42 | `tls-fingerprint` | JA3/JA4 | `X-Sim-JA3: python-requests\|curl\|Go-http-client\|chrome` | ClientHello — HAProxy/Envoy/nginx-ssl-ja3 |
| 43 | `http2-fingerprint` | Akamai H2 fingerprint | `X-Sim-H2` | SETTINGS/WINDOW_UPDATE/PRIORITY frames |
| 44 | `os-fingerprint` | p0f-style TCP/IP | `X-Sim-OS` | Raw packet capture (TTL, window, MSS) |
| 45 | `ip-reputation` | ASN / VPN / Tor | `X-Sim-IP-Type: datacenter\|vpn\|tor\|residential` | MaxMind, IPQualityScore, Tor exit list |
| 46 | `connection-limit` | Concurrent sockets | — | **Partly real** — sockets counted; TLS resumption is not |

`tests/stubs.spec.js` asserts that every stub declares `simulated: true` and that
`lib/netstub.js` still documents its real-world requirement — so a stub can never
quietly be mistaken for a working control.

## Expected test matrix

- **Naive scraper (raw HTML, no JS)** — gets only `baseline` and the *encoded*
  blobs, and is **poisoned** by the decoy flag. Cannot reach any JS, canvas,
  shadow-DOM, iframe, encrypted, or API-gated flag.
- **JS-capable browser** — resolves guards 1–13, 22–23, 26–41.
- **Stock automation (Playwright/Selenium defaults)** — trips `webdriver`,
  `headless`, `webgl`, `automation-artifacts`, and **header ordering**.

### A real finding from building this

Playwright-driven Chromium **fails guard 32** on header order alone. The
automation layer injects `Accept-Language` out of Chrome's natural position:

```
vanilla Chrome fetch: … user-agent, sec-ch-ua, sec-ch-ua-mobile, accept, …, accept-encoding, accept-language
under Playwright:     … user-agent, sec-ch-ua, ACCEPT-LANGUAGE, sec-ch-ua-mobile, accept, …, accept-encoding
```

The suite asserts both sides of this: a raw request with vanilla ordering passes,
and the same header *values* in python-requests' order are rejected. Header order
is checked over a core subset that is stable across navigation and fetch requests
— Chrome uses different orders for each, so a single canonical list would
false-positive on real browsers.

## CI

`.github/workflows/scraping-guards.yml` runs the whole suite on push/PR. Tests are
serial (`fullyParallel: false`) because the rate-limit and connection guards are
stateful.
