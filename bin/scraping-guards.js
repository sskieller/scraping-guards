#!/usr/bin/env node
/* CLI for running the target from another project:
 *
 *   npx scraping-guards serve --port 8080
 *   npx scraping-guards urls          # every URL worth pointing a scraper at
 *   npx scraping-guards flags         # the expected FLAG tokens, as JSON
 */
"use strict";
const path = require("path");

const args = process.argv.slice(2);
const cmd = args[0] || "serve";

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] !== undefined) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split("=").slice(1).join("=") : fallback;
}

const USAGE = `scraping-guards — a deliberately hostile target for testing scrapers

Usage:
  scraping-guards serve [--port 8080] [--no-mtls] [--quiet]
  scraping-guards urls  [--base http://localhost:8080]
  scraping-guards flags
  scraping-guards --help

serve   Start the target. Port 0 picks a free one and prints it.
urls    Print every URL worth pointing a scraper at, one per line.
flags   Print the expected FLAG tokens as JSON, for assertions.
`;

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (cmd === "serve") {
  const port = Number(flag("port", process.env.PORT || 8080));
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    console.error(`invalid --port: ${flag("port")}`);
    process.exit(1);
  }
  if (args.includes("--no-mtls")) process.env.SG_NO_MTLS = "1";
  if (args.includes("--quiet")) process.env.SG_QUIET = "1";
  process.env.PORT = String(port);
  process.argv[2] = String(port); // server.js reads argv[2] first
  require(path.join(__dirname, "..", "server.js"));
} else if (cmd === "urls") {
  const base = flag("base", "http://localhost:8080");
  const { RECIPES } = require(path.join(__dirname, "..", "lib", "recipe-data"));
  const lines = [
    `${base}/index.html`,      // guards 0-25
    `${base}/advanced.html`,   // guards 26-46
    `${base}/frontier.html`,   // guards 47-83
    `${base}/recipes`,         // catalogue index
    ...RECIPES.map((r) => `${base}/recipe/${r.slug}`),
    `${base}/robots.txt`,
    `${base}/ai.txt`,
    `${base}/llms.txt`,
    `${base}/sitemap.xml`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
} else if (cmd === "flags") {
  // Scraped out of the source so this can never drift from what is served.
  const fs = require("fs");
  const root = path.join(__dirname, "..");
  const files = ["index.html", "advanced.html", "frontier.html", "guards.js",
    "guards-advanced.js", "guards-frontier.js", "guards.css", "cipher.css",
    "server.js", "routes-frontier.js"];
  const found = new Set();
  for (const f of files) {
    try {
      const src = fs.readFileSync(path.join(root, f), "utf8").replace(/&#8203;/g, "");
      for (const m of src.matchAll(/FLAG-[A-Z0-9]+-[A-Za-z0-9]+/g)) found.add(m[0]);
    } catch (_) { /* optional file */ }
  }
  const all = [...found].sort();
  process.stdout.write(JSON.stringify({
    count: all.length,
    success: all.filter((f) => !/-BOT$|-429$|-TRIPPED$|-TAMPERED$|-REFUSED$|-SPOOFED$|-DONOTFOLLOW$|-NONE$/.test(f)),
    fired: all.filter((f) => /-BOT$|-429$|-TRIPPED$|-TAMPERED$|-REFUSED$|-SPOOFED$|-DONOTFOLLOW$|-REJECTED$/.test(f)),
  }, null, 2) + "\n");
} else {
  console.error(`unknown command: ${cmd}\n`);
  process.stderr.write(USAGE);
  process.exit(1);
}
