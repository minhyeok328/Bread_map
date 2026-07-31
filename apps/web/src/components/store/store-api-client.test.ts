import {
  RECOMMENDATION_VERSION,
  type StoreDetailResponse,
  type StoreSearchRequest,
  type StructuredSearchResult
} from "@bread-map/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  PublicApiError,
  readStoreDetail,
  searchStores
} from "./store-api-client.js";

const SNAPSHOT = `search-data-v1_${"a".repeat(64)}`;

function searchRequest(): StoreSearchRequest {
  return {
    query: {
      region: "마포구",
      storeName: null,
      menuName: "소금빵",
      categories: [],
      openNow: false,
      origin: null,
      maxDistanceM: null,
      reviewEvidenceStatus: "ANY",
      sortMode: "RELEVANCE",
      recommendationVersion: RECOMMENDATION_VERSION
    },
    dataSnapshotVersion: null
  };
}

function searchResult(): StructuredSearchResult {
  return {
    status: "COMPLETE",
    partialReason: null,
    items: [
      {
        storeId: "store-a",
        bakeryId: "bakery-a",
        displayName: "테스트 베이커리",
        normalizedAddress: "서울특별시 마포구 테스트로 1",
        seoulDistrict: "마포구",
        latitudeE7: 375_000_000,
        longitudeE7: 1_270_000_000,
        distanceUpperBoundM: null,
        openingState: "OPEN",
        representativeMenus: [
          {
            menuId: "menu-a",
            name: "소금빵",
            category: "SALT_BREAD",
            evidenceId: "evidence-a"
          }
        ],
        categories: ["SALT_BREAD"],
        review: {
          status: "INSUFFICIENT",
          count: 1,
          latestPublishedDate: "2026-07-29",
          snippet: "겉은 바삭하고 속은 촉촉해요."
        },
        reasonCodes: ["MENU_MATCH", "REGION_MATCH"],
        warningCodes: ["INSUFFICIENT_REVIEWS"]
      }
    ],
    metadata: {
      searchContractVersion: "structured-search-v1",
      recommendationVersion: RECOMMENDATION_VERSION,
      dataSnapshotVersion: SNAPSHOT,
      catalogPublishId: "catalog-a",
      searchEvidencePublishId: "evidence-publish-a",
      reviewPublishVersionId: "review-publish-a",
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

function detailResult(
  storeId = "store-a"
): StoreDetailResponse {
  return {
    store: {
      storeId,
      bakeryId: "bakery-a",
      displayName: "테스트 베이커리",
      normalizedAddress: "서울특별시 마포구 테스트로 1",
      seoulDistrict: "마포구",
      normalizedPhone: null,
      latitudeE7: 375_000_000,
      longitudeE7: 1_270_000_000,
      openingState: "OPEN",
      latestVerifiedAtMs: 1_754_000_000_000
    },
    menus: {
      status: "AVAILABLE",
      items: [
        {
          menuId: "menu-a",
          name: "소금빵",
          category: "SALT_BREAD",
          evidenceId: "evidence-a",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 1_754_000_000_000
        }
      ]
    },
    businessHours: {
      status: "AVAILABLE",
      items: [
        {
          intervalId: "hours-a",
          weekday: 4,
          sequence: 0,
          opensMinute: 600,
          closesMinute: 1_200,
          closesNextDay: false,
          evidenceId: "hours-a",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 1_754_000_000_000
        }
      ]
    },
    rating: {
      averageBasisPoints: 4_500,
      ratedReviewCount: 1,
      totalReviewCount: 1
    },
    reviews: {
      status: "INSUFFICIENT",
      page: 1,
      limit: 10,
      totalCount: 1,
      totalPages: 1,
      items: [
        {
          reviewId: "review-a",
          body: "겉은 바삭하고 속은 촉촉해요.",
          ratingBasisPoints: 4_500,
          publishedDate: "2026-07-29",
          provider: "KAKAO_MAP"
        }
      ]
    },
    freshness: {
      status: "CURRENT",
      sourceBasisDate: "2026-07-30"
    },
    metadata: {
      dataSnapshotVersion: SNAPSHOT,
      catalogPublishId: "catalog-a",
      searchEvidencePublishId: "evidence-publish-a",
      reviewPublishVersionId: "review-publish-a",
      recommendationVersion: RECOMMENDATION_VERSION
    }
  };
}

describe("searchStores", () => {
  it("posts the exact strict request and validates the response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(searchResult())
    );

    const result = await searchStores(searchRequest(), {
      fetch: fetchImplementation
    });

    expect(result).toEqual(searchResult());
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("/api/stores");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(searchRequest())
    });
  });

  it("rejects a successful response that violates the search contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ...searchResult(), unexpected: true })
    );

    await expect(
      searchStores(searchRequest(), { fetch: fetchImplementation })
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED"],
    [400, "SEARCH_INPUT_INVALID"],
    [409, "SEARCH_DATA_VERSION_MISMATCH"],
    [503, "SEARCH_DATA_STALE"]
  ])(
    "maps a %i public error without reflecting response detail",
    async (status, code) => {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code,
              detail: "C:\\private\\app.sqlite"
            }
          },
          { status }
        )
      );

      const error = await searchStores(searchRequest(), {
        fetch: fetchImplementation
      }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(PublicApiError);
      expect(error).toMatchObject({ code, status });
      expect(String(error)).not.toContain("app.sqlite");
    }
  );

  it("maps rejected fetches and aborts to closed public errors", async () => {
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("token at C:\\private"));
    const abortFetch = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("aborted with private detail", "AbortError")
    );

    await expect(
      searchStores(searchRequest(), { fetch: networkFetch })
    ).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    await expect(
      searchStores(searchRequest(), { fetch: abortFetch })
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });
});

describe("readStoreDetail", () => {
  it("encodes the selected store and originating snapshot", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(detailResult("store:a"))
    );

    const result = await readStoreDetail("store:a", SNAPSHOT, {
      fetch: fetchImplementation
    });

    expect(result).toEqual(detailResult("store:a"));
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/stores/store%3Aa?dataSnapshotVersion=${SNAPSHOT}&reviewPage=1&reviewLimit=10`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin"
      })
    );
  });

  it("rejects detail from another snapshot", async () => {
    const otherSnapshot = `search-data-v1_${"b".repeat(64)}`;
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...detailResult(),
        metadata: {
          ...detailResult().metadata,
          dataSnapshotVersion: otherSnapshot
        }
      })
    );

    await expect(
      readStoreDetail("store-a", SNAPSHOT, {
        fetch: fetchImplementation
      })
    ).rejects.toMatchObject({ code: "SNAPSHOT_MISMATCH" });
  });

  it("rejects detail for a different selected store", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...detailResult(),
        store: {
          ...detailResult().store,
          storeId: "store-b"
        }
      })
    );

    await expect(
      readStoreDetail("store-a", SNAPSHOT, {
        fetch: fetchImplementation
      })
    ).rejects.toMatchObject({ code: "STORE_ID_MISMATCH" });
  });

  it("rejects invalid detail responses and maps not found", async () => {
    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ store: { storeId: "store-a" } })
    );
    const missingFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "RESOURCE_NOT_FOUND" } },
        { status: 404 }
      )
    );

    await expect(
      readStoreDetail("store-a", SNAPSHOT, { fetch: invalidFetch })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      readStoreDetail("store-a", SNAPSHOT, { fetch: missingFetch })
    ).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404
    });
  });
});
