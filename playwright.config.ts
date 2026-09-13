import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/nuxt",
  testMatch: "browser.playwright.ts",
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.NUXT_MULTI_APP_TEST_URL,
    headless: true,
    // These checks need only page and request APIs, so use Playwright's smallest Chromium build.
    channel: "chromium-headless-shell",
    launchOptions: {
      args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"],
    },
  },
})
