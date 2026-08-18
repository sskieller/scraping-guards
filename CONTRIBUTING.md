# Contributing

Thanks for taking a look. This is a test fixture, so the bar for "correct" is a
little unusual: the value is in being *precisely* and *honestly* wrong-footing.

## Running it

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

The suite boots the server itself. It is serial (`fullyParallel: false`) because
the rate-limit, quota, enumeration and connection guards are stateful.

## Adding a guard

1. Add the section to the relevant page with a `data-guard="name"` attribute.
2. Implement it. Server-side logic goes in `lib/`, routes in
   `routes-frontier.js`, client logic in the matching `guards-*.js`.
3. Give it a `FLAG-<NAME>-<id>` token — one for success, and a `-BOT` variant if
   the guard can fire.
4. Add tests covering **both** branches: what a capable client gets, and what a
   caught client gets.
5. Add a row to the README table. Its order must match the page order — there is
   a test-adjacent check for this, and the table is the reference people read.

## The honesty rules

These are the ones I would push back on in review:

- **If it cannot really work here, it is a stub.** Return `simulated: true`, and
  document in the source what real detection requires (a TLS terminator, a
  packet capture, an issuer relationship). `tests/stubs.spec.js` enforces this.
- **Say what defeats it.** Every guard has a "Defeated by" column. If the honest
  answer is "trivially, by anyone who looks", write that.
- **Do not overstate the obfuscation.** Guard 50 is packing, not protection, and
  says so. A test asserts the honesty note stays in `tools/obfuscate.js`.
- **Flag accessibility costs.** If a guard breaks screen readers or keyboard
  navigation, say so in the row and in the source comment. Honeypots must carry
  `aria-hidden="true"` and `tabindex="-1"` — an assistive-tech user tripping a
  bot trap is a bug, and it was a real one here once.

## Regenerating artifacts

```bash
npm run build   # wasm/challenge.wasm + antidebug.js + integrity.json
npm run font    # fonts/cipher.woff2 (needs: pip install fonttools brotli)
```

Both are deterministic; CI fails if the committed output does not match a fresh
build. `certs/` is generated on demand by guard 60 and is gitignored — never
commit private keys, even test ones.

## Style

Match the surrounding code: no build step, no runtime dependencies, comments
that explain *why* a guard works rather than restating what the line does.
