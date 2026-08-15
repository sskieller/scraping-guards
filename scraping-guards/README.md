# Scraping Guards Test Page

A single self-contained page that implements **25 anti-scraping guards**, plus a
zero-dependency server for the ones that need HTTP and a Playwright suite that
asserts each guard's behavior in CI.

Use it to test a scraper (does it defeat / respect these guards?) or to test
your own guards (do they still trip a stock automated browser?).

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | The test page — every guard is a `<section data-guard="…">`. |
| `guards.js` | Client-side logic for JS/obfuscation/bot-detection guards. |
| `frame.html` | Nested document for the iframe guard. |
| `robots.txt` | Crawl policy + honeypot declaration. |
| `server.js` | Static server + token API, honeypot trap/field, rate limiter. |
| `tests/guards.spec.js` | Playwright assertions for the whole matrix. |
| `playwright.config.js` | Boots `server.js` and runs the suite. |
| `.github/workflows/scraping-guards.yml` | CI entry point. |

## Run locally

```bash
cd scraping-guards
npm install
npx playwright install --with-deps chromium
npm test            # boots server.js automatically and runs the suite
# or serve it and poke by hand:
npm run serve       # http://localhost:8080
```

## The flag convention

Every protected payload is a token shaped `FLAG-<NAME>-<id>`. Tests assert
exactly which flags each class of client can reach, so a failure points
straight at the broken guard.

- `FLAG-<NAME>-<id>` — content a capable client *should* extract.
- `FLAG-<NAME>-BOT` / `-429` / `-DONOTFOLLOW` — a guard *firing* on a bot.
- `FLAG-DECOY-FAKE-*` — poison; a correct scraper must **not** treat it as real.

## Guard catalog

| # | `data-guard` | Technique | Defeated by |
| --- | --- | --- | --- |
| 0 | `baseline` | Plain server-rendered text (control) | Any HTTP client |
| 1 | `js-render` | Content injected by JS | JS execution |
| 2 | `base64` | Base64 payload decoded at runtime | JS execution |
| 3 | `rot13` | ROT13 payload decoded at runtime | JS execution |
| 4 | `canvas-text` | Text drawn to `<canvas>` as pixels | OCR / vision only |
| 5 | `shadow-dom` | Content in a shadow root | Shadow-aware DOM query |
| 6 | `lazy-load` | IntersectionObserver on scroll | Scrolling a real browser |
| 7 | `time-gated` | Appears after `setTimeout` | Waiting after load |
| 8 | `click-reveal` | Revealed on click | Simulated interaction |
| 9 | `css-pseudo` | Text in CSS `::after` content | Computed-style read |
| 10 | `css-reversed` | Stored backwards, flipped by CSS | Reversing the string |
| 11 | `css-order` | DOM scrambled, reordered by flex `order` | Rendering CSS |
| 12 | `zero-width` | U+200B chars break substring matches | Stripping zero-width chars |
| 13 | `email-obfuscation` | Entity-encoded + JS-assembled address | JS execution |
| 14 | `honeypot-link` | Off-screen link → `/trap` 403 | **Not following hidden links** |
| 15 | `honeypot-field` | Hidden form field → 400 if filled | **Leaving hidden fields blank** |
| 16 | `decoy-data` | Hidden fake flag next to the real one | Respecting CSS visibility |
| 17 | `webdriver` | `navigator.webdriver` check | Patching the flag |
| 18 | `headless` | UA/plugins/languages/`chrome` heuristics | Full stealth profile |
| 19 | `webgl` | SwiftShader/llvmpipe renderer check | Real/spoofed GPU |
| 20 | `canvas-fp` | Canvas fingerprint hash | Randomized fingerprint |
| 21 | `behavior` | Requires real mouse movement | Synthesized human input |
| 22 | `fetch-token` | API needs `X-Scrape-Token` header | Replaying the header |
| 23 | `iframe` | Content in a nested document | Descending into frames |
| 24 | `anti-copy` | Blocks copy/select/context-menu | Reading DOM directly |
| 25 | `rate-limit` | `429` after N hits/window per IP | Throttling / IP rotation |

## Expected test matrix

- **Naive scraper (raw HTML, no JS)** — sees only `baseline`, the reversed/
  base64 *blobs* (not decoded), and gets **poisoned** by the decoy fake flag.
  Cannot see any JS/canvas/shadow/iframe/API flag.
- **JS-capable browser** — resolves guards 1–13, 22, 23; canvas stays pixels-only.
- **Stock automation (Playwright/Selenium default)** — trips `webdriver` and
  (in headless) `headless`/`webgl`; server-side honeypots and the rate limiter
  fire regardless of client.

The Playwright suite encodes exactly these expectations, so CI goes red the
moment a guard stops working.
