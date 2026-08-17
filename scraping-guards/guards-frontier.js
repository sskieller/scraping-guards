/* Client-side logic for guards 47-71. */
(function () {
  "use strict";
  const out = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  const j = (r) => r.json();
  const SID = document.body.dataset.sid;

  /* --- 47. Risk engine --- */
  fetch(`/api/risk/evaluate?sid=${SID}`).then(j).then((r) =>
    out("risk-out", `score=${r.score} action=${r.action} (${r.description})\n` +
      (r.breakdown.length ? r.breakdown.map((b) => `  +${b.weight} ${b.signal}`).join("\n") : "  no signals"))
  );

  /* --- 48. Subresource verification --- */
  // Deliberately delayed: the CSS/font/image must have been requested first.
  setTimeout(() => {
    fetch(`/api/subresource/verify?sid=${SID}`).then(j).then((r) =>
      out("subresource-out", `${r.flag}\nseen: ${r.seen.join(", ") || "none"}` +
        (r.missing.length ? `\nmissing: ${r.missing.join(", ")}` : ""))
    );
  }, 700);

  /* --- 49/50. Anti-debug + integrity --- */
  (function () {
    const ad = window.__SG_ANTIDEBUG;
    out("antidebug-out", ad ? `${ad.flag}\nsignals: ${ad.signals.join(", ") || "none"}` : "[antidebug.js not loaded]");
  })();

  (async function () {
    try {
      const manifest = await fetch("/api/integrity").then(j);
      const src = await fetch("antidebug.js").then((r) => r.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", src);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const expected = manifest["antidebug.js"].sha256;
      out("integrity-out", hex === expected
        ? `FLAG-INTEGRITY-0f5c (sha256 matches manifest)`
        : `FLAG-INTEGRITY-TAMPERED\n  served: ${hex.slice(0, 16)}…\n  expected: ${expected.slice(0, 16)}…`);
    } catch (e) { out("integrity-out", "[integrity check failed: " + e + "]"); }
  })();

  /* --- 51. WASM challenge --- */
  (async function () {
    try {
      const src = await WebAssembly.instantiateStreaming
        ? WebAssembly.instantiateStreaming(fetch("wasm/challenge.wasm"))
        : WebAssembly.instantiate(await fetch("wasm/challenge.wasm").then((r) => r.arrayBuffer()));
      const inst = (await src).instance;
      const ct = atob(document.getElementById("wasm-ct").textContent);
      let plain = "";
      for (let i = 0; i < ct.length; i++) plain += String.fromCharCode(inst.exports.solve(ct.charCodeAt(i)));
      out("wasm-out", plain);
    } catch (e) { out("wasm-out", "[wasm failed: " + e + "]"); }
  })();

  /* --- 52. Labyrinth (we only peek; we do not crawl it) --- */
  fetch("/maze/demo").then((r) => r.text()).then((html) => {
    const links = (html.match(/href="\/maze\//g) || []).length;
    out("maze-out", `one maze page returned ${links} further maze links — it never ends`);
  });

  /* --- 53. Compression bomb --- */
  fetch("/api/bomb").then((r) => {
    const expanded = r.headers.get("X-Expanded-Bytes");
    return r.text().then((t) => out("bomb-out", expanded
      ? `served: ${expanded} bytes expanded (ratio ${r.headers.get("X-Compression-Ratio")}x)`
      : `not served — ${JSON.parse(t).note}`));
  });

  /* --- 54. Poisoning --- */
  fetch("/api/records").then(j).then((r) =>
    out("poison-out", r.flag ? `${r.flag} (genuine)` : `poisoned: ${r.records.map((x) => x.id).join(", ")}`)
  );

  /* --- 59. Accounts + quota --- */
  (async function () {
    const device = "dev-" + (navigator.hardwareConcurrency || 0);
    const login = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password", device }),
    }).then(j);
    if (!login.ok) return out("account-out", "login failed: " + login.reason);
    const hit = await fetch("/api/account/content", {
      headers: { "X-API-Key": login.apiKey, "X-Device": device },
    }).then(j);
    const wrongDevice = await fetch("/api/account/content", {
      headers: { "X-API-Key": login.apiKey, "X-Device": "other-device" },
    }).then(j);
    out("account-out", `${hit.flag} used ${hit.used}/${hit.quota}\nwrong device → ${wrongDevice.reason}`);
  })();

  /* --- 61/62. Attestation + PAT stubs --- */
  fetch("/api/attest", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "play.abcdefgh12345", platform: "android" }),
  }).then(j).then((r) => out("attest-out", `${r.flag} verdict=${r.verdict} (simulated)`));

  fetch("/api/pat").then(j).then((r) => out("pat-out", `${r.flag} (simulated) — ${r.realRequirement}`));

  /* --- 63. Persisted queries --- */
  (async function () {
    const hashes = await fetch("/api/graphql/hashes").then(j);
    const ok = await fetch("/api/graphql", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: hashes.summary }),
    }).then(j);
    const adhoc = await fetch("/api/graphql", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ users { email } }" }),
    }).then(j);
    out("graphql-out", `persisted → ${ok.data.summary.flag}\nad-hoc → ${adhoc.reason}`);
  })();

  /* --- 64. Request signing --- */
  (async function () {
    // The browser cannot hold the server secret, so this demo just shows the
    // rejection path; tests exercise the valid path with the shared secret.
    const r = await fetch("/api/signed-request", { method: "POST", body: "{}" }).then(j);
    out("reqsign-out", `unsigned → ${r.reason} (${r.flag})`);
  })();

  /* --- 65. Binary protocol --- */
  (async function () {
    const seed = "sess-" + SID;
    const buf = new Uint8Array(await fetch(`/api/binary?seed=${seed}`).then((r) => r.arrayBuffer()));
    // Walk the TLV without knowing the field names.
    const fields = [];
    let off = 0;
    while (off + 3 <= buf.length) {
      const kl = buf[off], vl = (buf[off + 1] << 8) | buf[off + 2];
      const key = String.fromCharCode(...buf.slice(off + 3, off + 3 + kl));
      const val = String.fromCharCode(...buf.slice(off + 3 + kl, off + 3 + kl + vl));
      fields.push(`${key}=${val}`);
      off += 3 + kl + vl;
    }
    out("binproto-out", `opaque keys this session:\n  ${fields.join("\n  ")}`);
  })();

  /* --- 66. Navigation graph --- */
  (async function () {
    // Record a human-plausible path: real dwell times between pages.
    const paths = ["/", "/advanced.html", "/frontier.html"];
    for (const path of paths) {
      await fetch(`/api/nav/visit?sid=${SID}&path=${encodeURIComponent(path)}`);
      await new Promise((r) => setTimeout(r, 180));
    }
    const score = await fetch(`/api/nav/score?sid=${SID}`).then(j);
    out("nav-out", `${score.flag} visits=${score.visits} gaps=${score.gaps.join(",")}ms`);
  })();

  /* --- 67. Conditional requests --- */
  (async function () {
    await fetch(`/api/etag-resource?sid=${SID}`);
    await fetch(`/api/etag-resource?sid=${SID}`); // browser revalidates automatically
    const v = await fetch(`/api/etag/verify?sid=${SID}`).then(j);
    out("etag-out", `${v.flag} served=${v.served} conditional=${v.conditional}`);
  })();

  /* --- 68. CSS fingerprint (no JS involved in the collection) --- */
  setTimeout(() => {
    fetch(`/api/cssfp/report?sid=${SID}`).then(j).then((r) =>
      out("cssfp-out", `${r.flag} buckets=[${r.buckets.join(", ")}]\n${r.note}`)
    );
  }, 800);

  /* --- 69. Extended fingerprint surfaces --- */
  (async function () {
    const bits = [];
    // Font enumeration by measured width.
    try {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;left:-9999px;font-size:72px";
      probe.textContent = "mmmmmmmmmmlli";
      document.body.appendChild(probe);
      const widths = {};
      for (const f of ["monospace", "serif", "sans-serif", "Arial", "Courier New", "Georgia"]) {
        probe.style.fontFamily = f;
        widths[f] = probe.offsetWidth;
      }
      probe.remove();
      const distinct = new Set(Object.values(widths)).size;
      bits.push(`fonts=${distinct} distinct widths`);
    } catch (_) { bits.push("fonts=unavailable"); }

    // Media codec support.
    const v = document.createElement("video");
    const codecs = ["video/mp4; codecs=avc1.42E01E", "video/webm; codecs=vp9", "audio/ogg; codecs=opus"]
      .map((c) => `${c.split(";")[0].split("/")[1]}:${v.canPlayType(c) || "no"}`);
    bits.push("codecs=" + codecs.join(","));

    // Speech synthesis voices — often empty in headless.
    const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    bits.push(`voices=${voices.length}`);

    // Timer resolution — reduced/jittered under some hardening.
    let minDelta = Infinity;
    for (let i = 0; i < 200; i++) {
      const a = performance.now(), b = performance.now();
      if (b > a) minDelta = Math.min(minDelta, b - a);
    }
    bits.push(`timerRes=${minDelta === Infinity ? "n/a" : minDelta.toFixed(4) + "ms"}`);

    // WebGPU adapter presence.
    bits.push(`webgpu=${"gpu" in navigator ? "present" : "absent"}`);

    // Clock skew between the JS clock and the server's Date header.
    try {
      const r = await fetch("/robots.txt", { method: "HEAD" });
      const serverDate = Date.parse(r.headers.get("date") || "");
      if (serverDate) bits.push(`clockSkew=${Math.abs(Date.now() - serverDate) < 5000 ? "ok" : "large"}`);
    } catch (_) { /* ignore */ }

    out("fpsurface-out", "FLAG-FPSURFACE-4a8e\n  " + bits.join("\n  "));
  })();

  /* --- 70. AI declarative layer --- */
  (async function () {
    const [ai, llms, robots] = await Promise.all([
      fetch("/ai.txt").then((r) => r.text()),
      fetch("/llms.txt").then((r) => r.text()),
      fetch("/robots.txt").then((r) => r.text()),
    ]);
    const blocked = (robots.match(/^User-agent: (GPTBot|ClaudeBot|CCBot|Google-Extended|Bytespider|PerplexityBot)/gmi) || []).length;
    out("ai-out", `FLAG-AIDECLARE-2f70\n  ai.txt: ${ai.length} bytes, TDM-Reservation present=${/TDM-Reservation/.test(ai)}` +
      `\n  llms.txt: ${llms.length} bytes\n  robots.txt: ${blocked} named AI crawlers disallowed`);
  })();

  /* --- 72. Subtle perturbation --- */
  fetch("/api/prices").then(j).then((r) =>
    out("perturb-out", r.flag
      ? `${r.flag} — genuine catalogue`
      : "perturbed (no marker, by design):\n  " +
        r.records.map((x) => `${x.sku} ${x.price} stock=${x.stockLevel}/${x.inStock}`).join("\n  "))
  );

  /* --- 73. Per-character rendering --- */
  (async function () {
    const { slots } = await fetch("/api/perchar").then(j);
    const wrap = document.getElementById("perchar-wrap");
    if (!wrap) return;
    // Slots arrive shuffled; CSS `order` is what makes them readable.
    for (const slot of slots) {
      const c = document.createElement("canvas");
      c.width = 14; c.height = 22;
      c.style.order = String(slot.order);
      const ctx = c.getContext("2d");
      ctx.font = "16px monospace";
      ctx.fillStyle = "#2980b9";
      ctx.fillText(String.fromCharCode(slot.code ^ 0x5a), 1, 16);
      wrap.appendChild(c);
    }
    out("perchar-out", `${slots.length} single-character canvases, DOM order shuffled`);
  })();

  /* --- 74. Tiered field-level access --- */
  (async function () {
    const anon = await fetch("/api/tiered").then(j);
    const login = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pro", password: "pro-password" }),
    }).then(j);
    const pro = await fetch("/api/tiered", { headers: { "X-API-Key": login.apiKey } }).then(j);
    out("tiered-out",
      `anonymous → ${anon.fields.join(", ")}\n` +
      `pro       → ${pro.fields.join(", ")}\n${pro.flag}`);
  })();

  /* --- 71. QUIC stub --- */
  fetch("/api/net/quic").then(j).then((r) => out("quic-out", `${r.flag} negotiated=${r.negotiated} (simulated)`));
})();
