import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "rm -rf .relay-e2e-data && RELAY_DATA_DIR=$PWD/.relay-e2e-data RELAY_ORIGIN=http://127.0.0.1:3100 pnpm --filter @relay/web exec next dev -H 127.0.0.1 -p 3100",
    url: "http://127.0.0.1:3100/setup",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
