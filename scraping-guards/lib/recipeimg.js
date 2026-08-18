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

/* Dish illustrations by category. A catalogue where every card showed the same
 * picture would look wrong, and the cards are the crawler's entry points — they
 * should look like distinct pages, because they are. */
function shapeFor(category, r) {
  const grain = (n, spread, size) => Array.from({ length: n }, () => {
    const px = (r() - 0.5) * spread, py = (r() - 0.5) * spread * 0.75;
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(size * (0.6 + r())).toFixed(1)}" fill="#fff" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  }).join("");

  switch (category) {
    case "Pasta": { // a nest of strands in a shallow bowl
      const strands = Array.from({ length: 9 }, (_, i) => {
        const y = -34 + i * 8 + (r() - 0.5) * 4;
        return `<path d="M-70,${y.toFixed(1)} C-30,${(y - 16).toFixed(1)} 30,${(y + 16).toFixed(1)} 70,${y.toFixed(1)}" stroke="hsl(44 62% ${(56 + r() * 8).toFixed(0)}%)" stroke-width="5" fill="none" stroke-linecap="round"/>`;
      }).join("");
      return `<ellipse rx="92" ry="74" fill="#f2efe6"/><ellipse rx="76" ry="60" fill="hsl(38 30% 82%)"/>${strands}
        <ellipse rx="30" ry="18" fill="hsl(24 42% 38%)" opacity="0.85"/>${grain(8, 90, 2)}`;
    }
    case "Sides": { // roasted batons on a plate
      const batons = Array.from({ length: 6 }, (_, i) => {
        const x = -60 + i * 24, rot = (r() - 0.5) * 26;
        return `<g transform="translate(${x} ${((r() - 0.5) * 18).toFixed(1)}) rotate(${rot.toFixed(1)})"><rect x="-8" y="-40" width="16" height="80" rx="8" fill="hsl(${(20 + r() * 12).toFixed(0)} 70% ${(48 + r() * 10).toFixed(0)}%)"/></g>`;
      }).join("");
      return `<ellipse rx="92" ry="74" fill="#f4f1ea"/><ellipse rx="78" ry="62" fill="#e8e3d6"/>${batons}${grain(10, 110, 2)}`;
    }
    case "Breakfast": { // a stack of pancakes, side-on
      const stack = Array.from({ length: 5 }, (_, i) =>
        `<ellipse cy="${(24 - i * 13).toFixed(0)}" rx="${(70 - i * 2).toFixed(0)}" ry="15" fill="hsl(${(26 + r() * 8).toFixed(0)} 48% ${(40 + i * 3).toFixed(0)}%)"/>`
      ).join("");
      return `<ellipse cy="34" rx="92" ry="26" fill="#f2efe6"/>${stack}
        <ellipse cy="-30" rx="34" ry="12" fill="#fdfbf5" opacity="0.92"/>${grain(6, 70, 2)}`;
    }
    case "Preserving": { // a jar
      return `<rect x="-52" y="-58" width="104" height="120" rx="14" fill="hsl(200 18% 86%)" opacity="0.55"/>
        <rect x="-46" y="-30" width="92" height="88" rx="10" fill="hsl(${(330 + r() * 20).toFixed(0)} 42% 46%)"/>
        <rect x="-56" y="-70" width="112" height="20" rx="7" fill="#7d8288"/>${grain(12, 80, 2.4)}`;
    }
    case "Dessert": { // scoops in a coupe
      const scoops = [[-26, -6], [24, -10], [0, 12]].map(([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="${(30 + r() * 5).toFixed(1)}" fill="hsl(${(32 + r() * 8).toFixed(0)} 40% ${(66 + r() * 8).toFixed(0)}%)"/>`
      ).join("");
      return `<ellipse rx="88" ry="70" fill="#f4f1ea"/><ellipse rx="72" ry="56" fill="#ece6d8"/>${scoops}${grain(14, 100, 2.2)}`;
    }
    default: { // Baking — a knotted bun, top-down
      const tone = 26 + Math.round(r() * 12);
      return `<ellipse rx="88" ry="70" fill="hsl(${tone} 62% 46%)"/>
        <ellipse rx="70" ry="54" fill="hsl(${tone} 60% 52%)"/>
        <path d="M-62,-14 C-30,-42 30,-42 62,-14 C30,10 -30,10 -62,-14 Z" fill="hsl(${tone} 55% 38%)" opacity="0.7"/>
        <path d="M-58,16 C-26,-8 26,-8 58,16 C26,38 -26,38 -58,16 Z" fill="hsl(${tone} 55% 41%)" opacity="0.6"/>
        <ellipse rx="26" ry="20" fill="hsl(${tone} 58% 56%)" opacity="0.85"/>${grain(14, 150, 3)}`;
    }
  }
}

/* Hero: a tray of whatever the dish is, top-down. */
function hero({ width = 1200, height = 630, seed = "hero", category = "Baking" } = {}) {
  const r = rand(seed);
  const buns = [];
  const cols = 4, rows = 3;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = 190 + col * 275 + (r() - 0.5) * 26;
      const cy = 150 + row * 175 + (r() - 0.5) * 20;
      const rot = (r() - 0.5) * 40;
      buns.push(`
      <g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot.toFixed(1)})">
        <ellipse rx="88" ry="70" fill="#000" opacity="0.10" transform="translate(5 9)"/>
        ${shapeFor(category, r)}
      </g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Stylised illustration of ${category.toLowerCase()} plated on a dark tray">
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
