/* Programmatic entry point.
 *
 * Lets another project start the target server inside its own test suite
 * instead of shelling out:
 *
 *   const { start } = require("scraping-guards");
 *   const server = await start({ port: 0 });   // 0 = pick a free port
 *   // ... point your scraper at server.url ...
 *   await server.stop();
 *
 * Port 0 matters: it means a consuming CI job never collides with whatever
 * else is already listening.
 */
"use strict";
const path = require("path");

const recipeData = require("./lib/recipe-data");
const risk = require("./lib/risk");

/* Start the guards server. Resolves once it is actually accepting connections,
 * so a caller can point a scraper at it on the next line. */
function start({ port = 8080, mtls = true, quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const prevQuiet = process.env.SG_QUIET;
    const prevMtls = process.env.SG_NO_MTLS;
    if (quiet) process.env.SG_QUIET = "1";
    if (!mtls) process.env.SG_NO_MTLS = "1";

    // server.js reads argv/env at require time, so the module cache must be
    // clear for a second call in the same process to pick up a new port.
    delete require.cache[require.resolve("./server.js")];
    process.env.PORT = String(port);

    let mod;
    try {
      mod = require("./server.js");
    } catch (err) {
      return reject(err);
    }

    const { server, mtlsServer } = mod;
    const done = () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://localhost:${actual}`,
        mtlsPort: mtlsServer ? mtlsServer.address().port : null,
        server,
        stop: () => new Promise((res) => {
          server.close(() => {
            if (mtlsServer) mtlsServer.close(() => res());
            else res();
          });
        }),
      });
      if (prevQuiet === undefined) delete process.env.SG_QUIET; else process.env.SG_QUIET = prevQuiet;
      if (prevMtls === undefined) delete process.env.SG_NO_MTLS; else process.env.SG_NO_MTLS = prevMtls;
    };

    if (server.listening) done();
    else {
      server.once("listening", done);
      server.once("error", reject);
    }
  });
}

module.exports = {
  start,
  /* The catalogue and guard metadata, so a consuming test can assert against
   * the same source of truth this project renders from rather than
   * hardcoding expectations that will drift. */
  recipes: recipeData,
  risk,
  root: __dirname,
};
