import type { Page } from "@playwright/test";
import { fakeKakaoSdkSource } from "./kakao-sdk";

export interface LocalMvpNetworkGuard {
  forbiddenRequests: string[];
  unexpectedExternalRequests: string[];
}

export async function installLocalMvpNetworkGuard(
  page: Page,
  options: { mapFailure?: boolean } = {}
): Promise<LocalMvpNetworkGuard> {
  const forbiddenRequests: string[] = [];
  const unexpectedExternalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.startsWith("/api/chat") ||
      url.pathname.startsWith("/api/routes") ||
      /openai/iu.test(url.hostname)
    ) {
      forbiddenRequests.push(url.toString());
      await route.abort("blockedbyclient");
      return;
    }
    if (
      url.hostname === "dapi.kakao.com" &&
      url.pathname === "/v2/maps/sdk.js"
    ) {
      if (options.mapFailure === true) {
        await route.abort("failed");
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: fakeKakaoSdkSource
        });
      }
      return;
    }
    if (
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    ) {
      await route.continue();
      return;
    }
    unexpectedExternalRequests.push(url.toString());
    await route.abort("blockedbyclient");
  });
  return { forbiddenRequests, unexpectedExternalRequests };
}
