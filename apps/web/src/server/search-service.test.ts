import type {
  StructuredSearchInput,
  StructuredSearchResult
} from "@bread-map/contracts";
import { StoreSearchError } from "@bread-map/retrieval";
import { describe, expect, it, vi } from "vitest";
import { AUTH_ORIGIN } from "../auth-config.js";
import {
  createStoreSearchRouteHandlers,
  createStoreSearchService
} from "./search-service.js";

const dataSnapshotVersion = `search-data-v1_${"a".repeat(64)}`;
const explicitSnapshotVersion = `search-data-v1_${"b".repeat(64)}`;
const requestTimeMs = Date.parse("2026-07-30T12:00:00+09:00");

function validRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    query: {
      region: "마포구",
      storeName: null,
      menuName: null,
      categories: [],
      openNow: false,
      origin: {
        latitudeE7: 375600001,
        longitudeE7: 1269000001
      },
      maxDistanceM: 5000,
      reviewEvidenceStatus: "ANY",
      sortMode: "DISTANCE",
      recommendationVersion: "recommendation-v1"
    },
    dataSnapshotVersion: null,
    ...overrides
  };
}

function searchResult(): StructuredSearchResult {
  return {
    status: "COMPLETE",
    partialReason: null,
    items: [
      {
        storeId: "store_a",
        bakeryId: "bakery_a",
        displayName: "한강 빵집",
        normalizedAddress: "서울특별시 마포구 월드컵로 1",
        seoulDistrict: "마포구",
        latitudeE7: 375634614,
        longitudeE7: 1269014494,
        distanceUpperBoundM: 250,
        openingState: "OPEN",
        representativeMenus: [],
        categories: [],
        review: {
          status: "INSUFFICIENT",
          count: 1,
          latestPublishedDate: "2026-07-30",
          snippet: null
        },
        reasonCodes: ["REGION_MATCH", "NEARBY", "VERIFIED_DATA"],
        warningCodes: ["INSUFFICIENT_REVIEWS"]
      }
    ],
    metadata: {
      searchContractVersion: "structured-search-v1",
      recommendationVersion: "recommendation-v1",
      dataSnapshotVersion,
      catalogPublishId: "publish_active",
      searchEvidencePublishId: "evidence_active",
      reviewPublishVersionId: "reviews_active",
      sourceBasisDate: "2026-07-30",
      ftsIndexVersion: "review-fts-unicode61-v1",
      aliasVersion: "search-alias-v1",
      ratingPriorVersion: "rating-prior-v1"
    },
    filterSummary: {
      initialCount: 1,
      resultCount: 1,
      reasonCounts: {
        REGION_MISMATCH: 0,
        STORE_NAME_MISMATCH: 0,
        EXCLUDED_CATEGORY: 0,
        INCLUDED_CATEGORY_MISSING: 0,
        NOT_OPEN: 0,
        DISTANCE_EXCEEDED: 0,
        REVIEW_STATUS_MISMATCH: 0,
        MENU_MISMATCH: 0
      }
    },
    relaxationOptions: []
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

function post(body: string, origin = AUTH_ORIGIN): Request {
  return new Request(`${AUTH_ORIGIN}/api/stores`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body
  });
}

function createService(
  options: {
    execute?: (
      input: StructuredSearchInput,
      atMs: number
    ) => StructuredSearchResult;
  } = {}
) {
  const resolveCurrentDataVersion = vi.fn(
    () => dataSnapshotVersion
  );
  const executeSearch = vi.fn(
    options.execute ??
      (() => searchResult())
  );
  return {
    service: createStoreSearchService({
      now: () => requestTimeMs,
      resolveCurrentDataVersion,
      executeSearch
    }),
    resolveCurrentDataVersion,
    executeSearch
  };
}

describe("store search service", () => {
  it("bootstraps the current version and keeps exact origin request-local", () => {
    const mocks = createService();

    const result = mocks.service.search(validRequest());

    expect(mocks.resolveCurrentDataVersion).toHaveBeenCalledExactlyOnceWith(
      requestTimeMs
    );
    expect(mocks.executeSearch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        dataSnapshotVersion,
        origin: {
          latitudeE7: 375600001,
          longitudeE7: 1269000001
        }
      }),
      requestTimeMs
    );
    expect(JSON.stringify(result)).not.toContain("375600001");
    expect(JSON.stringify(result)).not.toContain("1269000001");
  });

  it("keeps an explicit snapshot pinned without resolving a replacement", () => {
    const mocks = createService();

    mocks.service.search(
      validRequest({
        dataSnapshotVersion: explicitSnapshotVersion
      })
    );

    expect(mocks.resolveCurrentDataVersion).not.toHaveBeenCalled();
    expect(mocks.executeSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSnapshotVersion: explicitSnapshotVersion
      }),
      requestTimeMs
    );
  });
});

describe("POST /api/stores", () => {
  it("rejects a missing Origin before authentication or body parsing", async () => {
    const resolvePrincipal = vi.fn(async () => principal());
    const mocks = createService();
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal,
      service: mocks.service
    });

    const response = await handlers.POST(
      new Request(`${AUTH_ORIGIN}/api/stores`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json"
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ORIGIN_REQUIRED" }
    });
    expect(resolvePrincipal).not.toHaveBeenCalled();
    expect(mocks.executeSearch).not.toHaveBeenCalled();
  });

  it("requires a revocable principal before parsing the request body", async () => {
    const mocks = createService();
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal: async () => null,
      service: mocks.service
    });

    const response = await handlers.POST(post("{not-json"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" }
    });
    expect(mocks.executeSearch).not.toHaveBeenCalled();
  });

  it("returns one complete result array shared by map and list consumers", async () => {
    const mocks = createService();
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: mocks.service
    });

    const response = await handlers.POST(
      post(JSON.stringify(validRequest()))
    );
    const body = (await response.json()) as {
      items: Array<{ storeId: string }>;
    };
    const listStoreIds = body.items.map((item) => item.storeId);
    const mapStoreIds = body.items.map((item) => item.storeId);

    expect(response.status).toBe(200);
    expect(listStoreIds).toEqual(["store_a"]);
    expect(mapStoreIds).toEqual(listStoreIds);
  });

  it("rejects invalid JSON and unknown or conflicting search fields", async () => {
    const mocks = createService();
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: mocks.service
    });

    const invalidJson = await handlers.POST(post("{not-json"));
    const unknownField = await handlers.POST(
      post(
        JSON.stringify(
          validRequest({
            page: 1
          })
        )
      )
    );
    const missingOriginForDistance = await handlers.POST(
      post(
        JSON.stringify({
          ...validRequest(),
          query: {
            ...(validRequest().query as Record<string, unknown>),
            origin: null
          }
        })
      )
    );

    expect(invalidJson.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(missingOriginForDistance.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: { code: "SEARCH_INPUT_INVALID" }
    });
    expect(mocks.executeSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["SEARCH_DATA_VERSION_MISMATCH", 409],
    ["SEARCH_DATA_STALE", 503],
    ["SEARCH_DATA_UNAVAILABLE", 503],
    ["SEARCH_DATABASE_UNAVAILABLE", 503]
  ] as const)("maps %s to a safe %s response", async (code, status) => {
    const sentinel = "375634614 C:\\private\\app.sqlite SELECT *";
    const mocks = createService({
      execute: () => {
        const error = new StoreSearchError(code);
        error.message = sentinel;
        throw error;
      }
    });
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: mocks.service
    });

    const response = await handlers.POST(
      post(JSON.stringify(validRequest()))
    );
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toEqual({ error: { code } });
    expect(text).not.toContain("375634614");
    expect(text).not.toContain("app.sqlite");
    expect(text).not.toContain("SELECT");
  });

  it("does not expose unexpected SQL, paths, stacks, or exact location", async () => {
    const mocks = createService({
      execute: () => {
        throw new Error(
          "SQLITE_ERROR SELECT origin FROM C:\\private\\app.sqlite 375634614"
        );
      }
    });
    const handlers = createStoreSearchRouteHandlers({
      resolvePrincipal: async () => principal(),
      service: mocks.service
    });

    const response = await handlers.POST(
      post(JSON.stringify(validRequest()))
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR" }
    });
    expect(text).not.toMatch(/SQLITE|SELECT|origin|app\.sqlite|375634614/u);
  });
});
