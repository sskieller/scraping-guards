/* Minimal zero-dependency static server that also implements the server-side
 * scraping guards: token-gated API, honeypot trap, honeypot form field, and
 * per-IP rate limiting. Node >=18.
 *
 *   node server.js [port]   # default 8080
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// GUARD 25: per-IP rate limiting for /api/rated.
const RATE = { windowMs: 10_000, max: 5, hits: new Map() };
function rateLimited(ip) {
  const now = Date.now();
  const rec = RATE.hits.get(ip) || { count: 0, reset: now + RATE.windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + RATE.windowMs; }
  rec.count++;
  RATE.hits.set(ip, rec);
  return rec.count > RATE.max;
}

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // GUARD 14: honeypot trap. Any hit here = a bot that ignored robots.txt and
  // followed an off-screen link. Real clients never reach it.
  if (pathname === "/trap") {
    return send(res, 403, "BOT DETECTED (honeypot). FLAG-TRAP-DONOTFOLLOW\n");
  }

  // GUARD 22: token-gated content.
  if (pathname === "/api/protected") {
    if (req.headers["x-scrape-token"] !== "issued-by-js-42") {
      return send(res, 401, "missing/invalid X-Scrape-Token\n");
    }
    return send(res, 200, "FLAG-APITOKEN-8b04");
  }

  // GUARD 25: rate-limited endpoint.
  if (pathname === "/api/rated") {
    if (rateLimited(ip)) {
      res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "10" });
      return res.end("429 Too Many Requests (FLAG-RATELIMIT-429)\n");
    }
    return send(res, 200, "ok");
  }

  // GUARD 15: honeypot form field. A filled `website` field means a bot.
  if (pathname === "/submit" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const filled = new URLSearchParams(raw).get("website");
      if (filled) return send(res, 400, "BOT DETECTED (honeypot field). FLAG-HPFIELD-BOT\n");
      return send(res, 200, "accepted");
    });
    return;
  }

  // Static files.
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "forbidden");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "not found");
    send(res, 200, data, MIME[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(PORT, () => console.log(`scraping-guards server on http://localhost:${PORT}`));
