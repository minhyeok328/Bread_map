import { openAppDatabase } from "@bread-map/app-db";
import { expect, test } from "@playwright/test";
import {
  installLocalMvpNetworkGuard
} from "./fixtures/local-mvp-network";
import {
  createLocalMvpSession
} from "./fixtures/local-mvp-session";

test.beforeEach(async ({ context }) => {
  const session = await createLocalMvpSession("search");
  await context.addCookies([session.cookie]);
});

test("real SQLite search and detail keep one snapshot and public evidence", async ({
  page
}) => {
  const network = await installLocalMvpNetworkGuard(page);
  await page.goto("/");
  await page.getByLabel("지역").fill("마포구");
  await page.getByLabel("메뉴").fill("소금빵");
  await page.getByRole("button", { name: "빵집 찾기" }).click();

  await expect(
    page.getByRole("heading", { name: "확인된 빵집 1곳" })
  ).toBeVisible();
  await page
    .locator('.result-card[data-store-id="store_a"]')
    .click();
  await expect(
    page.locator('.store-detail[data-store-id="store_a"]')
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "한강 빵집" })
  ).toBeVisible();
  const detail = page.locator(
    '.store-detail[data-store-id="store_a"]'
  );
  await expect(
    detail.getByText("소금빵", { exact: true }).last()
  ).toBeVisible();
  await expect(detail.getByText("소금빵이 바삭해요")).toBeVisible();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

test("map failure keeps real search, sparse-review store and detail path", async ({
  page
}) => {
  const network = await installLocalMvpNetworkGuard(page, {
    mapFailure: true
  });
  await page.goto("/");
  await expect(page.getByText("지도를 불러오지 못했어요")).toBeVisible();
  await page.getByLabel("지역").fill("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).click();
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page
    .locator('.result-card[data-store-id="store_b"]')
    .click();
  await expect(
    page.locator('.store-detail[data-store-id="store_b"]')
  ).toBeVisible();
  await expect(
    page
      .locator('.store-detail[data-store-id="store_b"]')
      .getByText(
        "최근 리뷰 근거가 부족해 확인된 메뉴와 방문 조건을 중심으로 표시합니다."
      )
  ).toBeVisible();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

test("FTS outage returns a truthful partial UI through the real API", async ({
  page
}) => {
  const appPath = process.env.LOCAL_MVP_APP_SQLITE_PATH;
  if (appPath === undefined) {
    throw new Error("LOCAL_MVP_APP_SQLITE_PATH_REQUIRED");
  }
  const database = openAppDatabase({ path: appPath });
  try {
    database.client
      .prepare(
        `UPDATE fts_index_state
            SET status = 'SUPERSEDED', active_slot = NULL
          WHERE active_slot = 1`
      )
      .run();
  } finally {
    database.close();
  }

  try {
    await installLocalMvpNetworkGuard(page);
    await page.goto("/");
    await page.getByLabel("메뉴").fill("소금빵");
    await page.getByRole("button", { name: "빵집 찾기" }).click();
    await expect(
      page.getByText(
        "리뷰 검색을 사용할 수 없어 메뉴·카테고리·지역 조건으로 결과를 표시합니다."
      )
    ).toBeVisible();
    await expect(page.locator(".result-card")).toHaveCount(1);
  } finally {
    const restored = openAppDatabase({ path: appPath });
    try {
      restored.client
        .prepare(
          `UPDATE fts_index_state
              SET status = 'ACTIVE', active_slot = 1
            WHERE state_id = 'fts_active'`
        )
        .run();
    } finally {
      restored.close();
    }
  }
});

test("OAuth failure exposes only a stable error ID and leaves search usable", async ({
  page
}) => {
  await installLocalMvpNetworkGuard(page);
  await page.goto(
    "/?error=OAuthCallback&error_description=sentinel-provider-secret"
  );
  const alert = page.locator(
    '[role="alert"][data-error-id="AUTH-OAUTH-FAILED"]'
  );
  await expect(alert).toContainText("카카오 로그인을 완료하지 못했어요");
  await expect(alert).toContainText("AUTH-OAUTH-FAILED");
  await expect(page.locator("body")).not.toContainText(
    "sentinel-provider-secret"
  );
  await page.getByLabel("지역").fill("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).click();
  await expect(page.locator(".result-card")).toHaveCount(2);
});
