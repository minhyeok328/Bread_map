import {
  RECOMMENDATION_VERSION,
  type StoreDetailResponse,
  type StructuredSearchItem,
  type StructuredSearchResult
} from "@bread-map/contracts";
import type {
  Page,
  Route
} from "@playwright/test";
import { fakeKakaoSdkSource } from "./kakao-sdk";

export const E2E_SNAPSHOT =
  `search-data-v1_${"e".repeat(64)}`;

const reasonCounts = {
  REGION_MISMATCH: 0,
  STORE_NAME_MISMATCH: 0,
  EXCLUDED_CATEGORY: 0,
  INCLUDED_CATEGORY_MISSING: 0,
  NOT_OPEN: 0,
  DISTANCE_EXCEEDED: 0,
  REVIEW_STATUS_MISMATCH: 0,
  MENU_MISMATCH: 0
} as const;

const items: StructuredSearchItem[] = [
  {
    storeId: "store-maple",
    bakeryId: "bakery-maple",
    displayName: "메이플 베이크",
    normalizedAddress: "서울특별시 마포구 월드컵로 10",
    seoulDistrict: "마포구",
    latitudeE7: 375_560_000,
    longitudeE7: 1_269_100_000,
    distanceUpperBoundM: 1_250,
    openingState: "OPEN",
    representativeMenus: [
      {
        menuId: "menu-maple-salt",
        name: "소금빵",
        category: "SALT_BREAD",
        evidenceId: "evidence-maple-salt"
      }
    ],
    categories: ["SALT_BREAD"],
    review: {
      status: "INSUFFICIENT",
      count: 2,
      latestPublishedDate: "2026-07-29",
      snippet: "버터 향과 바삭한 밑면이 인상적이에요."
    },
    reasonCodes: ["MENU_MATCH", "REGION_MATCH", "OPEN_NOW"],
    warningCodes: ["INSUFFICIENT_REVIEWS"]
  },
  {
    storeId: "store-river",
    bakeryId: "bakery-river",
    displayName: "리버 사워도우",
    normalizedAddress: "서울특별시 마포구 희우정로 22",
    seoulDistrict: "마포구",
    latitudeE7: 375_530_000,
    longitudeE7: 1_269_000_000,
    distanceUpperBoundM: 1_500,
    openingState: "UNKNOWN",
    representativeMenus: [
      {
        menuId: "menu-river-sourdough",
        name: "사워도우",
        category: "FERMENTED_BREAD",
        evidenceId: "evidence-river-sourdough"
      }
    ],
    categories: ["FERMENTED_BREAD"],
    review: {
      status: "INSUFFICIENT",
      count: 0,
      latestPublishedDate: null,
      snippet: null
    },
    reasonCodes: ["REGION_MATCH", "VERIFIED_DATA"],
    warningCodes: [
      "INSUFFICIENT_REVIEWS",
      "OPENING_HOURS_UNKNOWN"
    ]
  }
];

export function createSearchResult(
  variant: "COMPLETE" | "PARTIAL" | "EMPTY" = "COMPLETE"
): StructuredSearchResult {
  const resultItems = variant === "EMPTY" ? [] : items;
  return {
    status: variant === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    partialReason:
      variant === "PARTIAL" ? "FTS_UNAVAILABLE" : null,
    items: resultItems,
    metadata: {
      searchContractVersion: "structured-search-v1",
      recommendationVersion: RECOMMENDATION_VERSION,
      dataSnapshotVersion: E2E_SNAPSHOT,
      catalogPublishId: "catalog-e2e",
      searchEvidencePublishId: "evidence-e2e",
      reviewPublishVersionId: "reviews-e2e",
      sourceBasisDate: "2026-07-30",
      ftsIndexVersion:
        variant === "PARTIAL"
          ? null
          : "review-fts-unicode61-v1",
      aliasVersion: "search-alias-v1",
      ratingPriorVersion: "rating-prior-v1"
    },
    filterSummary: {
      initialCount: 2,
      resultCount: resultItems.length,
      reasonCounts:
        variant === "EMPTY"
          ? { ...reasonCounts, MENU_MISMATCH: 2 }
          : reasonCounts
    },
    relaxationOptions:
      variant === "EMPTY"
        ? [
            "EXPAND_REGION_OR_DISTANCE",
            "INCLUDE_INSUFFICIENT_REVIEWS"
          ]
        : []
  };
}

export function createStoreDetail(
  storeId: string
): StoreDetailResponse {
  const item = items.find(
    (candidate) => candidate.storeId === storeId
  );
  if (item === undefined) {
    throw new Error("unknown E2E store");
  }
  const hasEvidence = storeId === "store-maple";

  return {
    store: {
      storeId: item.storeId,
      bakeryId: item.bakeryId,
      displayName: item.displayName,
      normalizedAddress: item.normalizedAddress,
      seoulDistrict: item.seoulDistrict,
      normalizedPhone: null,
      latitudeE7: item.latitudeE7,
      longitudeE7: item.longitudeE7,
      openingState: item.openingState,
      latestVerifiedAtMs: 1_754_000_000_000
    },
    menus: {
      status: hasEvidence ? "AVAILABLE" : "UNAVAILABLE",
      items: hasEvidence
        ? [
            {
              menuId: "menu-maple-salt",
              name: "소금빵",
              category: "SALT_BREAD",
              evidenceId: "evidence-maple-salt",
              source: "MANUAL_VERIFIED",
              verifiedAtMs: 1_754_000_000_000
            }
          ]
        : []
    },
    businessHours: {
      status: hasEvidence ? "AVAILABLE" : "UNAVAILABLE",
      items: hasEvidence
        ? [
            {
              intervalId: "hours-maple",
              weekday: 4,
              sequence: 0,
              opensMinute: 600,
              closesMinute: 1_200,
              closesNextDay: false,
              evidenceId: "hours-maple",
              source: "MANUAL_VERIFIED",
              verifiedAtMs: 1_754_000_000_000
            }
          ]
        : []
    },
    rating: {
      averageBasisPoints: hasEvidence ? 4_500 : null,
      ratedReviewCount: hasEvidence ? 2 : 0,
      totalReviewCount: hasEvidence ? 2 : 0
    },
    reviews: {
      status: hasEvidence ? "INSUFFICIENT" : "UNAVAILABLE",
      page: 1,
      limit: 10,
      totalCount: hasEvidence ? 2 : 0,
      totalPages: hasEvidence ? 1 : 0,
      items: hasEvidence
        ? [
            {
              reviewId: "review-maple-one",
              body: "버터 향과 바삭한 밑면이 인상적이에요.",
              ratingBasisPoints: 4_500,
              publishedDate: "2026-07-29",
              provider: "KAKAO_MAP"
            },
            {
              reviewId: "review-maple-two",
              body: "담백해서 식사빵으로 잘 어울려요.",
              ratingBasisPoints: 4_500,
              publishedDate: "2026-07-28",
              provider: "KAKAO_MAP"
            }
          ]
        : []
    },
    freshness: {
      status: hasEvidence ? "CURRENT" : "WARNING",
      sourceBasisDate: "2026-07-30"
    },
    metadata: {
      dataSnapshotVersion: E2E_SNAPSHOT,
      catalogPublishId: "catalog-e2e",
      searchEvidencePublishId: hasEvidence
        ? "evidence-e2e"
        : null,
      reviewPublishVersionId: hasEvidence
        ? "reviews-e2e"
        : null,
      recommendationVersion: RECOMMENDATION_VERSION
    }
  };
}

export interface NetworkFixtureOptions {
  searchVariant?: "COMPLETE" | "PARTIAL" | "EMPTY";
  mapFailure?: boolean;
}

export interface NetworkFixture {
  searchBodies: unknown[];
  forbiddenRequests: string[];
  unexpectedExternalRequests: string[];
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

export async function installNetworkFixture(
  page: Page,
  options: NetworkFixtureOptions = {}
): Promise<NetworkFixture> {
  const searchBodies: unknown[] = [];
  const forbiddenRequests: string[] = [];
  const unexpectedExternalRequests: string[] = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      url.pathname.startsWith("/api/chat") ||
      url.pathname.startsWith("/api/routes") ||
      /openai/i.test(url.hostname)
    ) {
      forbiddenRequests.push(request.url());
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
      url.hostname === "127.0.0.1" &&
      url.pathname === "/api/stores" &&
      request.method() === "POST"
    ) {
      searchBodies.push(request.postDataJSON());
      await fulfillJson(
        route,
        createSearchResult(options.searchVariant)
      );
      return;
    }

    if (
      url.hostname === "127.0.0.1" &&
      url.pathname.startsWith("/api/stores/") &&
      request.method() === "GET"
    ) {
      const storeId = decodeURIComponent(
        url.pathname.slice("/api/stores/".length)
      );
      await fulfillJson(route, createStoreDetail(storeId));
      return;
    }

    if (
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    ) {
      await route.continue();
      return;
    }

    unexpectedExternalRequests.push(request.url());
    await route.abort("blockedbyclient");
  });

  return {
    searchBodies,
    forbiddenRequests,
    unexpectedExternalRequests
  };
}
