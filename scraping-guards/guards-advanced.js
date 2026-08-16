/* Client-side logic for Tier 1 guards (26-41) and the Tier 2 stub readouts.
 * Each block mirrors one <section data-guard="…"> in advanced.html. */
(function () {
  "use strict";

  const out = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const j = (r) => r.json();

  /* --- 26. CAPTCHA interstitial --- */
  let captchaId = null;
  async function newCaptcha() {
    const c = await fetch("/api/captcha/new").then(j);
    captchaId = c.id;
    const cv = document.getElementById("captcha-canvas");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#888";
    // Noise, so naive OCR has to work for it.
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2, 1);
    ctx.fillStyle = "#111";
    ctx.font = "22px monospace";
    ctx.fillText(`${c.a} + ${c.b} = ?`, 14, 30);
    out("captcha-out", "[challenge issued — solve it]");
  }
  document.getElementById("captcha-new")?.addEventListener("click", newCaptcha);
  document.getElementById("captcha-submit")?.addEventListener("click", async () => {
    const answer = document.getElementById("captcha-answer").value;
    const r = await fetch("/api/captcha/solve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: captchaId, answer: Number(answer) }),
    }).then(j);
    if (!r.ok) return out("captcha-out", "rejected: " + r.reason);
    const gated = await fetch("/gated").then((x) => x.text());
    out("captcha-out", "solved — /gated returned: " + gated);
  });
  newCaptcha();

  /* --- 27. Proof-of-work --- */
  document.getElementById("pow-run")?.addEventListener("click", async () => {
    out("pow-out", "solving…");
    const { challenge, difficulty } = await fetch("/api/pow/challenge").then(j);
    const target = "0".repeat(difficulty);
    const enc = new TextEncoder();
    const t0 = performance.now();
    let nonce = 0, hex = "";
    // Brute force until the digest has `difficulty` leading zeros.
    for (;;) {
      const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${challenge}:${nonce}`));
      hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex.startsWith(target)) break;
      nonce++;
    }
    const ms = Math.round(performance.now() - t0);
    const r = await fetch("/api/pow/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, nonce }),
    }).then(j);
    out("pow-out", `nonce=${nonce} in ${ms}ms → ${r.ok ? r.flag : "rejected: " + r.reason}`);
  });

  /* --- 29. AES-GCM decrypt via crypto.subtle --- */
  (async function () {
    try {
      const { iv, data } = await fetch("/api/aes").then(j);
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey("raw", enc.encode("scrape-guard-passphrase"), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("sg-salt-v1"), iterations: 100000, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
      );
      const b2b = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b2b(iv) }, key, b2b(data));
      out("aes-out", new TextDecoder().decode(plain));
    } catch (e) { out("aes-out", "[decrypt failed: " + e + "]"); }
  })();

  /* --- 30. Signed expiring token --- */
  (async function () {
    const { token } = await fetch("/api/token/issue").then(j);
    const ok = await fetch("/api/token/content?token=" + encodeURIComponent(token)).then(j);
    const forged = await fetch("/api/token/content?token=" + encodeURIComponent(token.split(".")[0] + ".forged")).then(j);
    out("token-out", `valid → ${ok.flag}\nforged → ${forged.reason}`);
  })();

  /* --- 32. Header validation --- */
  fetch("/api/headers/check").then(j).then((r) =>
    out("headers-out", r.bot ? `BOT: ${r.signals.join(", ")}` : `OK: ${r.flag}`)
  ).catch((e) => out("headers-out", String(e)));

  /* --- 33. Referer validation --- */
  fetch("/api/referer/check").then(j).then((r) =>
    out("referer-out", r.ok ? `OK: ${r.flag}` : `BLOCKED: ${r.reason}`)
  ).catch((e) => out("referer-out", String(e)));

  /* --- 34. Session + CSRF --- */
  (async function () {
    const { csrf } = await fetch("/api/session/new").then(j);
    const good = await fetch("/api/session/content", { method: "POST", headers: { "X-CSRF-Token": csrf } }).then(j);
    const bad = await fetch("/api/session/content", { method: "POST" }).then(j);
    out("session-out", `with CSRF → ${good.flag}\nwithout → ${bad.reason}`);
  })();

  /* --- 35. Deep automation artifacts --- */
  (function () {
    const signals = [];
    // Selenium/ChromeDriver leaves cdc_ properties on document/window.
    const keys = Object.keys(window).concat(Object.keys(document));
    if (keys.some((k) => /^\$?cdc_|^\$?wdc_|^_selenium|^_phantom|^callPhantom/.test(k))) signals.push("selenium-artifact");
    if (window.__playwright || window.__puppeteer || window.__nightmare) signals.push("automation-global");
    // A CDP-attached page often has an oversized Error.stack cost or a patched console.
    if (navigator.webdriver) signals.push("navigator.webdriver");
    // Hardware claims that no real consumer device reports.
    if (navigator.hardwareConcurrency === 0 || navigator.hardwareConcurrency > 128) signals.push("odd-hardwareConcurrency");
    if ("deviceMemory" in navigator && navigator.deviceMemory < 1) signals.push("odd-deviceMemory");
    // Timezone vs locale consistency.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const lang = (navigator.language || "").toLowerCase();
      if (tz.startsWith("America/") && lang.startsWith("zh")) signals.push("tz-locale-mismatch");
      if (!tz) signals.push("no-timezone");
    } catch (_) { signals.push("intl-unavailable"); }
    // AudioContext fingerprint — headless stacks often differ or throw.
    let audioFp = "n/a";
    try {
      const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (AC) { const ctx = new AC(1, 44100, 44100); audioFp = String(ctx.sampleRate); }
      else signals.push("no-audiocontext");
    } catch (_) { signals.push("audiocontext-throws"); }
    // WebRTC availability (used for local-IP leak checks in the wild).
    if (!window.RTCPeerConnection) signals.push("no-webrtc");

    out("artifacts-out",
      (signals.length ? `BOT SIGNALS: ${signals.join(", ")} (FLAG-ARTIFACTS-BOT)` : "clean (FLAG-ARTIFACTS-a72f)") +
      `\naudio=${audioFp} cores=${navigator.hardwareConcurrency} mem=${navigator.deviceMemory ?? "?"}`);
  })();

  /* --- 36. Advanced behavioral telemetry --- */
  (function () {
    const moves = [], keys = [];
    let firstInteraction = null;
    window.addEventListener("mousemove", (e) => {
      if (moves.length < 60) moves.push({ x: e.clientX, y: e.clientY, t: Math.round(performance.now()) });
    });
    const input = document.getElementById("behavior-input");
    input?.addEventListener("keydown", () => {
      if (firstInteraction === null) firstInteraction = performance.now();
      keys.push(Math.round(performance.now()));
    });
    document.getElementById("behavior-submit")?.addEventListener("click", async () => {
      const formMs = firstInteraction === null ? 0 : Math.round(performance.now() - firstInteraction);
      const r = await fetch("/api/behavior/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves, keys, formMs }),
      }).then(j);
      out("behavior-out", r.bot ? `BOT: ${r.signals.join(", ")}` : `HUMAN: ${r.flag}`);
    });
  })();

  /* --- 37. Signed-cursor pagination --- */
  document.getElementById("cursor-run")?.addEventListener("click", async () => {
    let cursor = null, log = [], flag = null;
    for (let i = 0; i < 10; i++) {
      const r = await fetch("/api/items" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")).then(j);
      log.push(`page ${r.page}: ${r.items.join(", ")}`);
      if (r.flag) flag = r.flag;
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    const forged = await fetch("/api/items?cursor=forged.cursor").then(j);
    out("cursor-out", log.join("\n") + `\n${flag}\nforged cursor → ${forged.reason}`);
  });

  /* --- 38. SSE transport --- */
  (function () {
    if (!window.EventSource) return out("sse-out", "[EventSource unsupported]");
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.flag) { out("sse-out", d.flag); es.close(); }
    };
    es.onerror = () => es.close();
  })();

  /* --- 39. WebSocket transport --- */
  (function () {
    try {
      const sock = new WebSocket(`ws://${location.host}/ws`);
      sock.onopen = () => sock.send("give-me-the-flag");
      sock.onmessage = (e) => { out("ws-out", JSON.parse(e.data).flag || e.data); sock.close(); };
      sock.onerror = () => out("ws-out", "[ws error]");
    } catch (e) { out("ws-out", String(e)); }
  })();

  /* --- 40. Advanced rate limiting --- */
  document.getElementById("rate-run")?.addEventListener("click", async () => {
    await fetch("/api/rate/reset");
    const lines = [];
    for (const kind of ["sliding", "bucket"]) {
      let limitedAt = null;
      for (let i = 1; i <= 10 && limitedAt === null; i++) {
        const r = await fetch(`/api/rate/${kind}`);
        if (r.status === 429) limitedAt = i;
      }
      lines.push(`${kind}: 429 after ${limitedAt} requests`);
    }
    const t0 = performance.now();
    for (let i = 0; i < 6; i++) await fetch("/api/rate/tarpit");
    lines.push(`tarpit: 6 requests took ${Math.round(performance.now() - t0)}ms (no 429, just slower)`);
    out("rate-out", lines.join("\n"));
  });

  /* --- 41. Canary watermark --- */
  fetch("/api/canary").then(j).then((r) => out("canary-out", `${r.flag} canary=${r.canary}`));

  /* --- 42-46. Tier 2 stub readouts --- */
  const stubs = [["/api/net/tls", "tls-out"], ["/api/net/h2", "h2-out"], ["/api/net/os", "os-out"],
                 ["/api/net/ip", "ip-out"], ["/api/net/conn", "conn-out"]];
  stubs.forEach(([path, id]) =>
    fetch(path).then(j).then((r) => out(id, JSON.stringify(r))).catch((e) => out(id, String(e)))
  );
})();
