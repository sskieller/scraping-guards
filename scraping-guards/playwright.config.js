// @ts-check
const { defineConfig } = require("@playwright/test");

const PORT = process.env.PORT || 8080;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false, // rate-limit test is stateful; keep it serial
  // The html reporter is what produces playwright-report/, which CI uploads as
  // an artifact — without it the upload step finds nothing. `open: never` keeps
  // it from trying to launch a browser on the runner.
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // In CI, `playwright install` provides the matching browser and this is unset.
    // Set PW_EXECUTABLE_PATH to run against a preinstalled Chromium locally.
    launchOptions: process.env.PW_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_EXECUTABLE_PATH }
      : undefined,
  },
  // Boot the guards server for the duration of the run.
  webServer: {
    command: `node server.js ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
