// @ts-check
const { defineConfig } = require("@playwright/test");

const PORT = process.env.PORT || 8080;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false, // rate-limit test is stateful; keep it serial
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
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
