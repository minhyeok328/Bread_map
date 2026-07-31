import { expect, test } from "@playwright/test";
import {
  installLocalMvpNetworkGuard
} from "./fixtures/local-mvp-network";
import {
  createLocalMvpSession
} from "./fixtures/local-mvp-session";

test("disabled chat stays local, sends nothing and restores focus", async ({
  context,
  page
}) => {
  const session = await createLocalMvpSession("chat");
  await context.addCookies([session.cookie]);
  const network = await installLocalMvpNetworkGuard(page);
  await page.goto("/");

  const fab = page.getByRole("button", {
    name: "빵빵이에게 물어보기"
  });
  await fab.click();
  const chat = page.getByRole("region", { name: "빵빵이" });
  await expect(chat).toBeVisible();
  await expect(chat.locator("textarea")).toBeDisabled();
  await expect(
    chat.getByRole("button", { name: "이 가게의 대표 메뉴" })
  ).toBeDisabled();
  await expect(
    chat.getByRole("button", { name: "방문 전 확인할 점" })
  ).toBeDisabled();
  await expect(chat.locator("form")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(fab).toBeFocused();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});
