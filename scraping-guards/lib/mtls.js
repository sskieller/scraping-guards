/* Guard 60: mutual TLS — the client must present a certificate signed by our CA.
 *
 * This one is genuinely real, not a stub: Node terminates TLS itself, so it can
 * require and verify a client certificate. It is the strongest control in the
 * whole suite for machine-to-machine APIs — possession of a private key cannot
 * be faked by a headless browser or spoofed by header manipulation.
 *
 * Certificates are generated on demand with openssl into certs/ (gitignored) —
 * private keys must never be committed, even test ones.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const CERT_DIR = path.join(path.dirname(__dirname), "certs");

function have(...names) {
  return names.every((n) => fs.existsSync(path.join(CERT_DIR, n)));
}

/* Generate a CA, a server cert, and one client cert. Returns false if openssl
 * is unavailable, so callers can degrade instead of crashing. */
function ensureCerts() {
  if (have("ca.pem", "server-key.pem", "server-cert.pem", "client-key.pem", "client-cert.pem")) return true;
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const ssl = (args) => execFileSync("openssl", args, { cwd: CERT_DIR, stdio: "pipe" });
  try {
    // CA
    ssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca-key.pem", "-out", "ca.pem",
         "-days", "365", "-subj", "/CN=ScrapeGuard Test CA"]);
    // Server
    ssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server-key.pem", "-out", "server.csr",
         "-subj", "/CN=localhost"]);
    ssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem",
         "-CAcreateserial", "-out", "server-cert.pem", "-days", "365"]);
    // Client
    ssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client-key.pem", "-out", "client.csr",
         "-subj", "/CN=authorised-client"]);
    ssl(["x509", "-req", "-in", "client.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem",
         "-CAcreateserial", "-out", "client-cert.pem", "-days", "365"]);
    return true;
  } catch (err) {
    return false;
  }
}

/* Start an HTTPS listener that REQUIRES a client certificate from our CA. */
function start(port) {
  if (!ensureCerts()) return null;
  const read = (f) => fs.readFileSync(path.join(CERT_DIR, f));

  const server = https.createServer(
    {
      key: read("server-key.pem"),
      cert: read("server-cert.pem"),
      ca: read("ca.pem"),
      requestCert: true,
      // false would reject at the TLS layer with an opaque error; letting the
      // handshake complete lets us return a readable 401 instead.
      rejectUnauthorized: false,
    },
    (req, res) => {
      const cert = req.socket.getPeerCertificate();
      const authorised = req.socket.authorized;
      res.setHeader("Content-Type", "application/json");
      if (!authorised || !cert || !Object.keys(cert).length) {
        res.writeHead(401);
        return res.end(JSON.stringify({
          ok: false,
          reason: req.socket.authorizationError || "no-client-certificate",
          flag: "FLAG-MTLS-REFUSED",
        }));
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, subject: cert.subject && cert.subject.CN, flag: "FLAG-MTLS-4e77" }));
    }
  );
  server.listen(port);
  return server;
}

module.exports = { start, ensureCerts, CERT_DIR };
