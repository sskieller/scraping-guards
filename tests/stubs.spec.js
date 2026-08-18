// @ts-check
/* Tier 2 guards (42-46): SIMULATED network-layer detection.
 *
 * These assert the STUB's contract, not real detection. The point of testing
 * them is (a) the allow/block branches both work, so downstream logic can be
 * exercised in CI, and (b) every response is explicitly marked `simulated:true`
 * so nothing here can be mistaken for a real control.
 */
const { test, expect, request } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const get = async (path, headers) => {
  const ctx = await request.newContext({ extraHTTPHeaders: headers || {} });
  const r = await ctx.get(BASE + path);
  const body = await r.json();
  await ctx.dispose();
  return { status: r.status(), body };
};

test("every Tier 2 endpoint marks itself simulated", async () => {
  for (const path of ["/api/net/tls", "/api/net/h2", "/api/net/os", "/api/net/ip", "/api/net/conn"]) {
    const { body } = await get(path);
    expect(body.simulated, `${path} must declare simulated:true`).toBe(true);
  }
});

/* --- 42. TLS / JA3 --- */
test.describe("42. TLS fingerprint (simulated)", () => {
  test("known bot JA3 profiles are blocked", async () => {
    for (const client of ["python-requests", "curl", "Go-http-client"]) {
      const { status, body } = await get("/api/net/tls", { "X-Sim-JA3": client });
      expect(status, client).toBe(403);
      expect(body.flag).toBe("FLAG-JA3-BOT");
      expect(body.ja3).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("a browser JA3 profile passes", async () => {
    const { status, body } = await get("/api/net/tls", { "X-Sim-JA3": "chrome" });
    expect(status).toBe(200);
    expect(body.flag).toBe("FLAG-JA3-ok");
  });
});

/* --- 43. HTTP/2 fingerprint --- */
test.describe("43. HTTP/2 fingerprint (simulated)", () => {
  test("HTTP/1.1 client claiming a Chrome UA is flagged", async () => {
    const { status, body } = await get("/api/net/h2", {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    });
    expect(status).toBe(403);
    expect(body.flag).toBe("FLAG-H2FP-BOT");
    expect(body.negotiated).toBe("HTTP/1.1");
  });

  test("forced browser fingerprint passes", async () => {
    const { status, body } = await get("/api/net/h2", { "X-Sim-H2": "browser" });
    expect(status).toBe(200);
    expect(body.flag).toBe("FLAG-H2FP-ok");
  });
});

/* --- 44. OS / TCP-IP fingerprint --- */
test.describe("44. OS fingerprint (simulated)", () => {
  test("UA claiming Windows over a Linux stack is flagged", async () => {
    const { status, body } = await get("/api/net/os", {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    });
    expect(status).toBe(403);
    expect(body.claimedByUA).toBe("Windows");
    expect(body.observedStack).toBe("Linux");
    expect(body.flag).toBe("FLAG-OSFP-BOT");
  });

  test("consistent UA and stack passes", async () => {
    const { status, body } = await get("/api/net/os", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
    });
    expect(status).toBe(200);
    expect(body.flag).toBe("FLAG-OSFP-ok");
  });
});

/* --- 45. IP reputation / ASN --- */
test.describe("45. IP reputation (simulated)", () => {
  test("datacenter, VPN, tor and proxy IPs are blocked", async () => {
    for (const type of ["datacenter", "vpn", "tor", "proxy"]) {
      const { status, body } = await get("/api/net/ip", { "X-Sim-IP-Type": type });
      expect(status, type).toBe(403);
      expect(body.flag).toBe("FLAG-IPREP-BOT");
      expect(body.usageType).toBe(type);
    }
  });

  test("residential IPs pass", async () => {
    const { status, body } = await get("/api/net/ip", { "X-Sim-IP-Type": "residential" });
    expect(status).toBe(200);
    expect(body.flag).toBe("FLAG-IPREP-ok");
  });
});

/* --- 46. Connection limits (partly real) --- */
test("46. concurrent sockets per IP are actually counted", async () => {
  const { status, body } = await get("/api/net/conn");
  expect(status).toBe(200);
  expect(body.concurrent).toBeGreaterThanOrEqual(1);
  expect(body.max).toBe(6);
});

/* --- Guardrail: the stubs must never be mistaken for real controls --- */
test("netstub source documents what real detection requires", async () => {
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "..", "lib", "netstub.js"), "utf8");
  expect(src).toContain("TIER 2 STUBS");
  expect(src).toContain("DO NOT ship these as security controls");
  // Each stub must name the real infrastructure it stands in for.
  for (const needle of ["ClientHello", "SETTINGS frame", "p0f", "MaxMind"]) {
    expect(src, `missing rationale: ${needle}`).toContain(needle);
  }
});
