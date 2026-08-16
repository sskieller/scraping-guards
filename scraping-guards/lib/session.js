/* Guard 34: cookie-backed sessions + CSRF double-submit.
 * Forces a scraper to maintain state instead of firing stateless GETs. */
"use strict";
const crypto = require("crypto");

const sessions = new Map(); // sid -> {csrf, created, seen}
const SESSION_TTL = 10 * 60_000;

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function createSession() {
  const sid = crypto.randomBytes(16).toString("hex");
  const csrf = crypto.randomBytes(16).toString("hex");
  sessions.set(sid, { csrf, created: Date.now(), seen: 0 });
  return { sid, csrf };
}

function getSession(req) {
  const sid = parseCookies(req).sg_session;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.created > SESSION_TTL) { sessions.delete(sid); return null; }
  s.seen++;
  return { sid, ...s };
}

// Double-submit: the CSRF value must arrive in a header AND match the one bound
// to the session cookie. A scraper replaying only the cookie fails.
function checkCsrf(req, session) {
  const sent = req.headers["x-csrf-token"];
  if (!sent) return { ok: false, reason: "missing-csrf" };
  if (sent !== session.csrf) return { ok: false, reason: "csrf-mismatch" };
  return { ok: true };
}

const cookieHeader = (sid) =>
  `sg_session=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`;

module.exports = { createSession, getSession, checkCsrf, cookieHeader, parseCookies };
