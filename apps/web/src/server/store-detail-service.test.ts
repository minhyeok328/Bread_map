import type {
  StoreDetailResponse
} from "@bread-map/contracts";
import { StoreSearchError } from "@bread-map/retrieval";
import { describe, expect, it, vi } from "vitest";
import { AUTH_ORIGIN } from "../auth-config.js";
import {
  createStoreDetailRouteHandlers,
  createStoreDetailService
} from "./store-detail-service.js";

const dataSnapshotVersion = `search-data-v1_${"a".repeat(64)}`;
const requestTimeMs = Date.parse("2026-07-30T12:00:00+09:00");

function detailResponse(): StoreDetailResponse {
  return {
    store: {
      storeId: "store_a",
      bakeryId: "bakery_a",
      displayName: "한강 빵집",
      normalizedAddress: "서울특별시 마포구 월드컵로 1",
      seoulDistrict: "마포구",
      normalizedPhone: "0212345678",
      latitudeE7: 375634614,
      longitudeE7: 1269014494,
      openingState: "OPEN",
      latestVerifiedAtMs: 100
    },
    menus: {
      status: "AVAILABLE",
      items: [
        {
          menuId: "menu_a",
          name: "소금빵",
          category: "SALT_BREAD",
          evidenceId: "menu_a",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 200
        }
      ]
    },
    businessHours: {
      status: "AVAILABLE",
      items: [
        {
          intervalId: "hours_a",
          weekday: 4,
          sequence: 0,
          opensMinute: 600,
          closesMinute: 1080,
          closesNextDay: false,
          evidenceId: "hours_a",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 200
        }
      ]
    },
    rating: {
      averageBasisPoints: 4500,
      ratedReviewCount: 3,
      totalReviewCount: 3
    },
    reviews: {
      status: "AVAILABLE",
      page: 1,
      limit: 10,
      totalCount: 3,
      totalPages: 1,
      items: [
        {
          reviewId: "review_a",
          body: "소금빵이 바삭해요",
          ratingBasisPoints: 4500,
          publishedDate: "2026-07-30",
          provider: "KAKAO_MAP"
        }
      ]
    },
    freshness: {
      status: "CURRENT",
      sourceBasisDate: "2026-07-30"
    },
    metadata: {
      dataSnapshotVersion,
      catalogPublishId: "publish_active",
      searchEvidencePublishId: "evidence_active",
      reviewPublishVersionId: "reviews_active",
      recommendationVersion: "recommendation-v1"
    }
  };
}

function principal() {
  return {
    userId: "user_a",
    sessionId: "session_a",
    authenticatedAtMs: 1,
    kakaoAccessToken: "never-return-this"
  };
}

function detailUrl(query = ""): string {
  const suffix = query === "" ? "" : `?${query}`;
  return `${AUTH_ORIGIN}/api/stores/store_a${suffix}`;
}

function validQuery(): Record<string, string> {
  return {
    dataSnapshotVersion,
    reviewPage: "1",
    reviewLimit: "10"
  };
}

describe("store detail service", () => {
  it("parses a pinned snapshot and bounded review page before reading", () => {
    const loadDetail = vi.fn(() => detailResponse());
    const service = createStoreDetailService({
      now: () => requestTimeMs,
      loadDetail
    });

    const detail = service.get(
      { storeId: "store_a" },
      validQuery()
    );

    expect(detail?.store.storeId).toBe("store_a");
    expect(loadDetail).toHaveBeenCalledExactlyOnceWith({
      storeId: "store_a",
      dataSnapshotVersion,
      reviewPage: 1,
      reviewLimit: 10,
      requestTimeMs
    });
  });
});

describe("GET /api/stores/[storeId]", () => {
  it("requires authentication before validating resource input", async () => {
    const loadDetail = vi.fn(() => detailResponse());
    const handlers = createStoreDetailRouteHandlers({
      resolvePrincipal: async () => null,
      service: createStoreDetailService({
        now: () => requestTimeMs,
        loadDetail
      })
    });

    const response = await handlers.GET(
      new Request(detailUrl("debug=true")),
      "not a valid id"
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" }
    });
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it("returns a schema-valid public detail for the selected search ID", async () => {
    const loadDetail = vi.fn(() => detailResponse());
    const handlers = createStoreDetailRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: createStoreDetailService({
        now: () => requestTimeMs,
        loadDetail
      })
    });
    const query = new URLSearchParams(validQuery());

    const response = await handlers.GET(
      new Request(detailUrl(query.toString())),
      "store_a"
    );
    const body = (await response.json()) as StoreDetailResponse;

    expect(response.status).toBe(200);
    expect(body.store.storeId).toBe("store_a");
    expect(body.metadata.dataSnapshotVersion).toBe(
      dataSnapshotVersion
    );
    expect(JSON.stringify(body)).not.toMatch(
      /nickname|fingerprint|evidenceRef|raw\.sqlite/u
    );
  });

  it.each([
    `dataSnapshotVersion=${dataSnapshotVersion}&debug=true`,
    `dataSnapshotVersion=${dataSnapshotVersion}&reviewPage=0`,
    `dataSnapshotVersion=${dataSnapshotVersion}&reviewPage=1001`,
    `dataSnapshotVersion=${dataSnapshotVersion}&reviewLimit=21`,
    `dataSnapshotVersion=${dataSnapshotVersion}&reviewLimit=01`,
    `dataSnapshotVersion=${dataSnapshotVersion}&reviewLimit=10&reviewLimit=11`
  ])("rejects invalid or ambiguous query %s", async (query) => {
    const loadDetail = vi.fn(() => detailResponse());
    const handlers = createStoreDetailRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: createStoreDetailService({
        now: () => requestTimeMs,
        loadDetail
      })
    });

    const response = await handlers.GET(
      new Request(detailUrl(query)),
      "store_a"
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SEARCH_INPUT_INVALID" }
    });
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it("returns one 404 for a missing or non-public store", async () => {
    const handlers = createStoreDetailRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: createStoreDetailService({
        now: () => requestTimeMs,
        loadDetail: () => null
      })
    });
    const query = new URLSearchParams(validQuery());

    const response = await handlers.GET(
      new Request(detailUrl(query.toString())),
      "store_hidden"
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "RESOURCE_NOT_FOUND" }
    });
  });

  it.each([
    ["SEARCH_DATA_VERSION_MISMATCH", 409],
    ["SEARCH_DATA_STALE", 503],
    ["SEARCH_DATA_UNAVAILABLE", 503],
    ["SEARCH_DATABASE_UNAVAILABLE", 503]
  ] as const)("maps %s without leaking internal detail", async (code, status) => {
    const handlers = createStoreDetailRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: createStoreDetailService({
        now: () => requestTimeMs,
        loadDetail: () => {
          const error = new StoreSearchError(code);
          error.message =
            "SELECT * FROM C:\\private\\app.sqlite 375634614";
          throw error;
        }
      })
    });
    const query = new URLSearchParams(validQuery());

    const response = await handlers.GET(
      new Request(detailUrl(query.toString())),
      "store_a"
    );
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toEqual({ error: { code } });
    expect(text).not.toMatch(/SELECT|app\.sqlite|375634614/u);
  });
});
