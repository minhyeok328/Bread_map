import {
  expect,
  test
} from "@playwright/test";
import {
  installNetworkFixture
} from "./fixtures/store-api";

test("list and Kakao marker share one selection and snapshot detail", async ({
  page
}) => {
  const network = await installNetworkFixture(page);
  await page.goto("/");

  await page.getByLabel("지역").fill("마포구");
  await page.getByLabel("메뉴").fill("소금빵");
  await page.getByRole("button", { name: "빵집 찾기" }).click();

  await expect(
    page.getByRole("heading", { name: "확인된 빵집 2곳" })
  ).toBeVisible();
  await expect(page.locator(".result-card")).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: "지도 마커: 메이플 베이크"
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "지도 마커: 리버 사워도우"
    })
  ).toBeVisible();

  await page
    .locator('.result-card[data-store-id="store-maple"]')
    .click();
  await expect(
    page.locator(
      '.store-detail[data-store-id="store-maple"]'
    )
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "메이플 베이크" })
  ).toBeVisible();
  await expect(
    page
      .locator(
        '.store-detail[data-store-id="store-maple"] .evidence-warning'
      )
  ).toHaveText(
    "최근 리뷰 근거가 부족해 확인된 메뉴와 방문 조건을 중심으로 표시합니다."
  );

  await page
    .getByRole("button", { name: "검색 결과로 돌아가기" })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "지도 마커: 리버 사워도우"
    })
    .click();
  await expect(
    page.locator(
      '.store-detail[data-store-id="store-river"]'
    )
  ).toBeVisible();
  await expect(
    page.getByText("표시할 수 있는 검수 메뉴가 아직 없어요.")
  ).toBeVisible();
  await expect(
    page.getByText("표시할 수 있는 최근 리뷰가 아직 없어요.")
  ).toBeVisible();

  expect(network.searchBodies).toHaveLength(1);
  expect(network.searchBodies[0]).toMatchObject({
    query: {
      region: "마포구",
      menuName: "소금빵",
      origin: null,
      maxDistanceM: null
    },
    dataSnapshotVersion: null
  });
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

test("chat is nonmodal, disabled, mutually exclusive, and restores focus", async ({
  page
}) => {
  const network = await installNetworkFixture(page);
  await page.goto("/");
  const map = page.locator(".map-region");
  const before = await map.boundingBox();
  const fab = page.getByRole("button", {
    name: "빵빵이에게 물어보기"
  });

  await expect(fab).toBeVisible();
  await fab.click();

  await expect(fab).toBeHidden();
  const chat = page.getByRole("region", { name: "빵빵이" });
  await expect(chat).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const close = page.getByRole("button", {
    name: "빵빵이 닫기"
  });
  await expect(close).toBeFocused();
  await expect(
    chat.getByText(
      "챗봇 기능은 다음 단계에서 제공할 예정이에요."
    )
  ).toBeVisible();
  await expect(chat.locator("textarea")).toBeDisabled();
  await expect(
    chat.getByRole("button", { name: "이 가게의 대표 메뉴" })
  ).toBeDisabled();
  await expect(
    chat.getByRole("button", { name: "방문 전 확인할 점" })
  ).toBeDisabled();

  const after = await map.boundingBox();
  expect(after).toEqual(before);

  await page.keyboard.press("Escape");
  await expect(chat).toBeHidden();
  await expect(fab).toBeVisible();
  await expect(fab).toBeFocused();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

test("map failure keeps the complete list, address, and detail path", async ({
  page
}) => {
  const network = await installNetworkFixture(page, {
    mapFailure: true
  });
  await page.goto("/");

  await expect(
    page.getByText("지도를 불러오지 못했어요")
  ).toBeVisible();
  await expect(
    page.getByText("가게 목록과 주소는 계속 볼 수 있어요.")
  ).toBeVisible();

  await page.getByLabel("지역").fill("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).click();
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page
    .locator('.result-card[data-store-id="store-maple"]')
    .click();
  await expect(
    page
      .locator(
        '.store-detail[data-store-id="store-maple"]'
      )
      .getByText("서울특별시 마포구 월드컵로 10")
  ).toBeVisible();

  await page
    .getByRole("button", { name: "검색 결과로 돌아가기" })
    .first()
    .click();
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "지도 다시 시도" })
    .click();
  await expect(
    page.getByText("지도를 불러오지 못했어요")
  ).toBeVisible();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

test("partial and empty searches expose truthful recovery states", async ({
  page
}) => {
  await installNetworkFixture(page, {
    searchVariant: "PARTIAL"
  });
  await page.goto("/");
  await page.getByLabel("지역").fill("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).click();
  await expect(
    page.getByText(
      "리뷰 검색을 사용할 수 없어 메뉴·카테고리·지역 조건으로 결과를 표시합니다."
    )
  ).toBeVisible();
  await expect(page.locator(".result-card")).toHaveCount(2);

  const emptyPage = await page.context().newPage();
  await installNetworkFixture(emptyPage, {
    searchVariant: "EMPTY"
  });
  await emptyPage.goto("/");
  await emptyPage.getByLabel("지역").fill("없는 지역");
  await emptyPage
    .getByRole("button", { name: "빵집 찾기" })
    .click();
  await expect(
    emptyPage.getByRole("heading", {
      name: "현재 조건과 데이터에서는 확인된 후보를 찾지 못했어요"
    })
  ).toBeVisible();
  await expect(
    emptyPage.getByRole("link", {
      name: "지역 또는 거리 범위를 한 단계 넓히기"
    })
  ).toBeVisible();
  await expect(emptyPage.locator(".result-card")).toHaveCount(0);
});

test("keyboard flow and drawer collapse preserve search and selection", async ({
  page
}) => {
  await installNetworkFixture(page);
  await page.goto("/");

  const region = page.getByLabel("지역");
  await region.focus();
  await page.keyboard.type("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).focus();
  await page.keyboard.press("Enter");
  const firstResult = page.locator(".result-card").first();
  await expect(firstResult).toBeVisible();
  await firstResult.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "메이플 베이크" })
  ).toBeVisible();

  await page
    .getByRole("button", { name: "검색 결과로 돌아가기" })
    .first()
    .click();
  await expect(firstResult).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "검색 패널 접기" })
    .click();
  await page
    .getByRole("button", { name: "검색 패널 펼치기" })
    .click();
  await expect(region).toHaveValue("마포구");
  await expect(firstResult).toHaveAttribute("aria-pressed", "true");
});

test("mobile marker selection reveals the shared store detail", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const network = await installNetworkFixture(page);
  await page.goto("/");

  await page.getByLabel("지역").fill("마포구");
  await page.getByRole("button", { name: "빵집 찾기" }).click();
  await page.getByRole("button", { name: "지도 보기" }).click();
  await page
    .getByRole("button", { name: "지도 마커: 메이플 베이크" })
    .click();

  await expect(
    page.locator('.store-detail[data-store-id="store-maple"]')
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "메이플 베이크" })
  ).toBeVisible();
  expect(network.forbiddenRequests).toEqual([]);
  expect(network.unexpectedExternalRequests).toEqual([]);
});

for (const viewport of [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1_024 },
  { name: "desktop", width: 1_440, height: 900 },
  { name: "wide", width: 1_920, height: 1_080 },
  { name: "desktop-200-percent-equivalent", width: 720, height: 450 }
]) {
  test(`${viewport.name} viewport has no document overflow`, async ({
    page
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height
    });
    await installNetworkFixture(page);
    await page.goto("/");

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.innerWidth
    );

    if (viewport.width < 768) {
      await expect(
        page.getByRole("button", { name: "지도 보기" })
      ).toBeVisible();
      await page
        .getByRole("button", { name: "지도 보기" })
        .click();
      await expect(
        page
          .getByRole("region", { name: "검색 결과 지도" })
          .getByRole("button", { name: "목록 보기" })
      ).toBeVisible();
    }
  });
}

test("reduced motion removes transforms and bounds remaining animation", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installNetworkFixture(page);
  await page.goto("/");

  const fab = page.getByRole("button", {
    name: "빵빵이에게 물어보기"
  });
  const mascotMotion = await fab.locator("img").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.animationDuration,
      iterations: style.animationIterationCount,
      transform: style.transform
    };
  });
  expect(mascotMotion.duration).toBe("0.08s");
  expect(mascotMotion.iterations).toBe("1");
  expect(mascotMotion.transform).toBe("none");

  await fab.click();
  const chatMotion = await page
    .getByRole("region", { name: "빵빵이" })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.animationDuration,
        transform: style.transform
      };
    });
  expect(chatMotion.duration).toBe("0.08s");
  expect(chatMotion.transform).toBe("none");
});
