/* Procedural SVG illustrations for the recipe page.
 *
 * Deliberately stylised illustrations, not synthetic photographs — a fake photo
 * of a real-looking dish would be a small dishonesty in a repo that is
 * otherwise careful about what is real. These are obviously drawings.
 *
 * Generated rather than committed so there are no binary assets to keep in
 * sync, and deterministic so the tests can assert on them.
 */
"use strict";
const crypto = require("crypto");

function rand(seed) {
  let h = crypto.createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) { h = crypto.createHash("sha256").update(h).digest(); i = 0; }
    const v = h.readUInt32BE(i) / 0xffffffff;
    i += 4;
    return v;
  };
}

/* Hero: a tray of knotted buns, top-down. */
function hero({ width = 1200, height = 630, seed = "hero" } = {}) {
  const r = rand(seed);
  const buns = [];
  const cols = 4, rows = 3;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = 190 + col * 275 + (r() - 0.5) * 26;
      const cy = 150 + row * 175 + (r() - 0.5) * 20;
      const rot = (r() - 0.5) * 40;
      const tone = 26 + Math.round(r() * 12); // baked-colour variation
      buns.push(`
      <g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot.toFixed(1)})">
        <ellipse rx="88" ry="70" fill="#000" opacity="0.10" transform="translate(5 9)"/>
        <ellipse rx="88" ry="70" fill="hsl(${tone} 62% 46%)"/>
        <ellipse rx="70" ry="54" fill="hsl(${tone} 60% 52%)"/>
        <path d="M-62,-14 C-30,-42 30,-42 62,-14 C30,10 -30,10 -62,-14 Z" fill="hsl(${tone} 55% 38%)" opacity="0.7"/>
        <path d="M-58,16 C-26,-8 26,-8 58,16 C26,38 -26,38 -58,16 Z" fill="hsl(${tone} 55% 41%)" opacity="0.6"/>
        <ellipse rx="26" ry="20" fill="hsl(${tone} 58% 56%)" opacity="0.85"/>
        ${Array.from({ length: 14 }, () => {
          const px = (r() - 0.5) * 150, py = (r() - 0.5) * 116;
          return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(2 + r() * 2.4).toFixed(1)}" fill="#fff" opacity="${(0.5 + r() * 0.45).toFixed(2)}"/>`;
        }).join("")}
      </g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Illustration of a tray of knotted cardamom buns scattered with pearl sugar">
  <defs>
    <linearGradient id="tray" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2b30"/><stop offset="1" stop-color="#17171b"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#tray)"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="3"/>
  ${buns.join("")}
</svg>`;
}

/* Step diagram: the twist-and-knot shaping from step 17. */
function knotDiagram({ width = 900, height = 300 } = {}) {
  const panel = (x, label, inner) => `
    <g transform="translate(${x} 0)">
      <rect x="10" y="14" width="270" height="230" rx="12" fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.16"/>
      ${inner}
      <text x="145" y="270" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17" fill="#e8e8ea">${label}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Three-panel diagram: cut a strip, twist it, then wind and tuck it into a knot">
  <rect width="${width}" height="${height}" fill="#17171b"/>
  ${panel(0, "1 — cut a 3 cm strip", `
    <rect x="60" y="70" width="170" height="34" rx="6" fill="#d9a441"/>
    <rect x="60" y="104" width="170" height="16" rx="4" fill="#8a5a2b"/>
    <rect x="60" y="120" width="170" height="34" rx="6" fill="#d9a441"/>
  `)}
  ${panel(300, "2 — twist 4–5 times", `
    <path d="M60,112 C100,58 140,166 180,112 C205,80 220,140 240,112"
          stroke="#d9a441" stroke-width="26" fill="none" stroke-linecap="round"/>
    <path d="M60,112 C100,58 140,166 180,112 C205,80 220,140 240,112"
          stroke="#8a5a2b" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="16 22"/>
  `)}
  ${panel(600, "3 — wind and tuck under", `
    <circle cx="145" cy="112" r="58" fill="none" stroke="#d9a441" stroke-width="26"/>
    <path d="M145,54 C205,74 205,150 145,170" stroke="#c9922f" stroke-width="26" fill="none" stroke-linecap="round"/>
    <path d="M118,150 C130,182 168,182 180,156" stroke="#8a5a2b" stroke-width="18" fill="none" stroke-linecap="round"/>
  `)}
</svg>`;
}

module.exports = { hero, knotDiagram };
