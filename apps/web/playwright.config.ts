import {
  defineConfig,
  devices
} from "@playwright/test";

const port = 3_119;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/feature9",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
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
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_KAKAO_MAP_APP_KEY:
        "playwright-local-map-identifier"
    }
  }
});
