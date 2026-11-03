import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: "msedge",
    viewport: { width: 390, height: 490 },
    timezoneId: "Asia/Shanghai",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
