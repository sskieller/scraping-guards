/* Client-side logic for the scraping-guards test page.
 * Each block realizes one guard; tokens are FLAG-<NAME>-<id> so tests can assert them. */
(function () {
  "use strict";

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  /* 1. JS-rendered content */
  set("js-slot", "FLAG-JSRENDER-7f3a");

  /* 2. Base64 decode */
  (function () {
    const el = document.getElementById("b64-slot");
    if (el) el.textContent = atob(el.dataset.enc);
  })();

  /* 3. ROT13 decode */
  (function () {
    const el = document.getElementById("rot-slot");
    if (!el) return;
    el.textContent = el.dataset.enc.replace(/[a-z]/gi, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
  })();

  /* 4. Canvas text */
  (function () {
    const c = document.getElementById("canvas-slot");
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    ctx.font = "20px monospace";
    ctx.fillStyle = "#3498db";
    ctx.fillText(atob(c.dataset.enc), 8, 26);
  })();

  /* 5. Shadow DOM */
  (function () {
    const host = document.getElementById("shadow-host");
    if (!host || !host.attachShadow) return;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<span class="flag">FLAG-SHADOW-c7e0</span>';
  })();

  /* 6. Lazy load on scroll */
  (function () {
    const slot = document.getElementById("lazy-slot");
    if (!slot) return;
    if (!("IntersectionObserver" in window)) { slot.textContent = "FLAG-LAZY-1b8f"; return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { slot.textContent = "FLAG-LAZY-1b8f"; io.disconnect(); }
      });
    });
    io.observe(slot);
  })();

  /* 7. Time-gated */
  setTimeout(() => set("timed-slot", "FLAG-TIMED-5c2a"), 1200);

  /* 8. Click to reveal */
  (function () {
    const btn = document.getElementById("reveal-btn");
    if (btn) btn.addEventListener("click", () => set("reveal-slot", "FLAG-CLICK-9d63"));
  })();

  /* 13. Email assembly (defeats harvesters that only read literal text) */
  (function () {
    const el = document.getElementById("email-slot");
    if (el) el.textContent = el.textContent + String.fromCharCode(46) + "com"; // ".com"
  })();

  /* 17. navigator.webdriver */
  (function () {
    const bot = navigator.webdriver === true;
    const el = document.getElementById("wd-verdict");
    if (!el) return;
    el.textContent = bot ? "BOT: navigator.webdriver=true (FLAG-WEBDRIVER-BOT)" : "HUMAN: webdriver=false";
    el.className = "verdict " + (bot ? "bot" : "human");
  })();

  /* 18. Headless heuristics */
  (function () {
    const signals = [];
    if (/Headless/i.test(navigator.userAgent)) signals.push("UA:Headless");
    if ((navigator.plugins || []).length === 0) signals.push("no-plugins");
    if (!navigator.languages || navigator.languages.length === 0) signals.push("no-languages");
    if (!window.chrome && /Chrome/.test(navigator.userAgent)) signals.push("no-chrome-obj");
    const bot = signals.length >= 2;
    const el = document.getElementById("headless-verdict");
    if (!el) return;
    el.textContent = bot ? "BOT: " + signals.join(", ") + " (FLAG-HEADLESS-BOT)" : "HUMAN: " + (signals.join(", ") || "clean");
    el.className = "verdict " + (bot ? "bot" : "human");
  })();

  /* 19. WebGL renderer */
  (function () {
    const el = document.getElementById("webgl-verdict");
    if (!el) return;
    let renderer = "unavailable";
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    } catch (_) {}
    const bot = /swiftshader|llvmpipe|mesa|software/i.test(renderer);
    el.textContent = (bot ? "BOT" : "HUMAN") + ": renderer=" + renderer + (bot ? " (FLAG-WEBGL-BOT)" : "");
    el.className = "verdict " + (bot ? "bot" : "human");
  })();

  /* 20. Canvas fingerprint hash */
  (function () {
    const el = document.getElementById("fp-verdict");
    if (!el) return;
    let hash = 0;
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("scrape-guard-\u{1F512}", 2, 2);
      const data = c.toDataURL();
      for (let i = 0; i < data.length; i++) hash = (hash * 31 + data.charCodeAt(i)) | 0;
    } catch (_) {}
    el.textContent = "canvas-fp=" + (hash >>> 0).toString(16) + " (FLAG-CANVASFP-" + (hash >>> 0).toString(16).slice(0, 4) + ")";
    el.className = "verdict";
  })();

  /* 21. Behavioral gate */
  (function () {
    const slot = document.getElementById("behavior-slot");
    if (!slot) return;
    let moves = 0;
    const onMove = (e) => {
      // Synthetic events often lack movementX/Y or come in a single burst.
      if (typeof e.movementX === "number") moves++;
      if (moves >= 3) {
        slot.textContent = "FLAG-BEHAVIOR-2f8e";
        window.removeEventListener("mousemove", onMove);
      }
    };
    window.addEventListener("mousemove", onMove);
  })();

  /* 22. Token-gated fetch */
  (function () {
    const slot = document.getElementById("api-slot");
    if (!slot) return;
    fetch("api/protected", { headers: { "X-Scrape-Token": "issued-by-js-42" } })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => { slot.textContent = t.trim(); })
      .catch((e) => { slot.textContent = "[blocked: " + e + "]"; });
  })();

  /* 24. Anti-copy */
  (function () {
    const section = document.querySelector('[data-guard="anti-copy"]');
    if (!section) return;
    ["copy", "cut", "contextmenu", "selectstart"].forEach((evt) =>
      section.addEventListener(evt, (e) => e.preventDefault())
    );
  })();
})();
