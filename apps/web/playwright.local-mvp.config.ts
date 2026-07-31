import { defineConfig, devices } from "@playwright/test";

const port = 3_000;
const baseURL = `http://127.0.0.1:${port}`;
const appPath = process.env.LOCAL_MVP_APP_SQLITE_PATH;
const authSecret = process.env.LOCAL_MVP_AUTH_SECRET;

if (appPath === undefined || appPath.length === 0) {
  throw new Error("LOCAL_MVP_APP_SQLITE_PATH_REQUIRED");
}
if (authSecret === undefined || authSecret.length < 32) {
  throw new Error("LOCAL_MVP_AUTH_SECRET_REQUIRED");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "search-and-detail.spec.ts",
    "favorites-isolation.spec.ts",
    "chat-shell.spec.ts"
  ],
  outputDir: "../../test-results/local-mvp/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    channel: "chrome",
    headless: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command:
      `pnpm start --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      APP_SQLITE_PATH: appPath,
      AUTH_SECRET: authSecret,
      AUTH_URL: baseURL,
      NEXT_PUBLIC_KAKAO_MAP_APP_KEY:
        "local-mvp-playwright-map-identifier"
    }
  }
});
