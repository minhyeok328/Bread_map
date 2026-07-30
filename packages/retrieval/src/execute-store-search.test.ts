import {
  RECOMMENDATION_VERSION,
  SEARCH_CONTRACT_VERSION,
  structuredSearchResultSchema
} from "@bread-map/contracts";
import type {
  RecommendationCandidateFacts
} from "@bread-map/recommendation";
import { describe, expect, it, vi } from "vitest";
import {
  executeStoreSearch,
  resolveCurrentSearchDataVersion,
  type ExecuteStoreSearchOptions
} from "./execute-store-search.js";
import type {
  ReviewRepository
} from "./review-repository.js";
import {
  StoreSearchError,
  type SearchSnapshotDescriptor,
  type StoreSearchRepository
} from "./store-search-repository.js";

const dataVersion = `search-data-v1_${"a".repeat(64)}`;
const requestTimeMs = Date.parse("2026-07-30T12:00:00+09:00");

const descriptor: SearchSnapshotDescriptor = {
  dataSnapshotVersion: dataVersion,
  catalogPublishId: "publish_fixture",
  catalogSnapshotId: "snapshot_fixture",
  sourceBasisDate: "2026-07-30",
  searchEvidencePublishId: "evidence_fixture",
  reviewPublishVersionId: "review_fixture",
  ftsIndexVersion: "review-fts-unicode61-v1"
};

function candidate(
  overrides: Partial<RecommendationCandidateFacts> = {}
): RecommendationCandidateFacts {
  return {
    storeId: "store_1",
    bakeryId: "bakery_1",
    displayName: "한강 빵집",
    normalizedName: "한강빵집",
    normalizedAddress: "서울특별시 마포구 월드컵로 1",
    seoulDistrict: "마포구",
    normalizedPhone: "0212345678",
    latitudeE7: 375634614,
    longitudeE7: 1269014494,
    menus: [
      {
        menuId: "menu_1",
        name: "소금빵",
        normalizedName: "소금빵",
        category: "SALT_BREAD",
        evidenceId: "menu_1",
        aliases: [
          {
            aliasId: "menu_alias_1",
            alias: "시오빵",
            normalizedAlias: "시오빵",
            evidenceId: "menu_alias_1"
          }
        ]
      }
    ],
    storeAliases: [
      {
        aliasId: "region_alias_1",
        aliasType: "REGION",
        alias: "홍대입구",
        normalizedAlias: "홍대입구",
        evidenceId: "region_alias_1"
      }
    ],
    businessHours: [
      {
        intervalId: "hours_1",
        weekday: 4,
        sequence: 0,
        opensMinute: 600,
        closesMinute: 1080,
        closesNextDay: false,
        evidenceId: "hours_1"
      }
    ],
    reviewAggregate: {
      count: 3,
      latestPublishedDate: "2026-07-30",
      ratedCount: 3,
      ratingSumBasisPoints: 13500
    },
    ...overrides
  };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    region: "홍대 입구",
    storeName: null,
    menuName: "시오빵",
    categories: [
      { category: "SALT_BREAD", mode: "INCLUDE" }
    ],
    openNow: true,
    origin: {
      latitudeE7: 375634614,
      longitudeE7: 1269014494
    },
    maxDistanceM: 5000,
    reviewEvidenceStatus: "ANY",
    sortMode: "RELEVANCE",
    dataSnapshotVersion: dataVersion,
    recommendationVersion: RECOMMENDATION_VERSION,
    ...overrides
  };
}

function repositories(options: {
  candidates?: RecommendationCandidateFacts[];
  evidenceStatus?: "AVAILABLE" | "UNAVAILABLE";
}) {
  const loadSnapshot = vi.fn(() => ({
    descriptor,
    candidates: options.candidates ?? [candidate()]
  }));
  const storeRepository: StoreSearchRepository = {
    inspectCurrentSnapshot: vi.fn(() => descriptor),
    loadSnapshot
  };
  const searchStoreEvidence = vi.fn(() =>
    options.evidenceStatus === "UNAVAILABLE"
      ? {
          status: "UNAVAILABLE" as const,
          code: "FTS_UNAVAILABLE" as const,
          hits: [] as const
        }
      : {
          status: "AVAILABLE" as const,
          hits: [
            {
              reviewId: "review_1",
              storeId: "store_1",
              publishedDate: "2026-07-30",
              snippet: "시오빵이 바삭해요",
              internalRank: -1,
              termPriority: 0
            }
          ]
        }
  );
  const reviewRepository: ReviewRepository = {
    searchReviews: vi.fn(() => ({
      status: "AVAILABLE" as const,
      hits: [] as const
    })),
    listStoreReviews: vi.fn(() => []),
    getActiveIndexState: vi.fn(() => null),
    searchStoreEvidence
  };
  return {
    storeRepository,
    reviewRepository,
    loadSnapshot,
    searchStoreEvidence
  };
}

function execute(
  overrides: Partial<ExecuteStoreSearchOptions> = {}
) {
  const defaults = repositories({});
  return executeStoreSearch({
    input: validInput(),
    requestTimeMs,
    storeRepository: defaults.storeRepository,
    reviewRepository: defaults.reviewRepository,
    ...overrides
  });
}

describe("executeStoreSearch", () => {
  it("resolves the current opaque version without exposing snapshot internals", () => {
    const mocks = repositories({});

    expect(
      resolveCurrentSearchDataVersion({
        requestTimeMs,
        storeRepository: mocks.storeRepository
      })
    ).toBe(dataVersion);
    expect(
      mocks.storeRepository.inspectCurrentSnapshot
    ).toHaveBeenCalledExactlyOnceWith(requestTimeMs);
  });

  it("returns one schema-validated complete result with bucketed distance", () => {
    const result = execute();

    expect(result).toMatchObject({
      status: "COMPLETE",
      partialReason: null,
      items: [
        {
          storeId: "store_1",
          distanceUpperBoundM: 250,
          review: {
            snippet: "시오빵이 바삭해요"
          }
        }
      ],
      metadata: {
        searchContractVersion: SEARCH_CONTRACT_VERSION,
        dataSnapshotVersion: dataVersion,
        catalogPublishId: "publish_fixture",
        searchEvidencePublishId: "evidence_fixture",
        reviewPublishVersionId: "review_fixture",
        ftsIndexVersion: "review-fts-unicode61-v1"
      },
      filterSummary: {
        initialCount: 1,
        resultCount: 1
      }
    });
    expect(structuredSearchResultSchema.safeParse(result).success).toBe(
      true
    );
    expect(JSON.stringify(result)).not.toMatch(
      /origin|distanceM|internalRank|adjustedRating|completeness|score/
    );
  });

  it("returns truthful partial structured results when FTS fails", () => {
    const mocks = repositories({
      evidenceStatus: "UNAVAILABLE"
    });
    const result = executeStoreSearch({
      input: validInput(),
      requestTimeMs,
      storeRepository: mocks.storeRepository,
      reviewRepository: mocks.reviewRepository
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.partialReason).toBe("FTS_UNAVAILABLE");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.review.snippet).toBeNull();
    expect(result.items[0]?.warningCodes).toContain(
      "FTS_UNAVAILABLE"
    );
    expect(result.items[0]?.reasonCodes).not.toContain(
      "REVIEW_EVIDENCE"
    );
  });

  it("does not call FTS or mark partial without an explicit menu", () => {
    const mocks = repositories({
      evidenceStatus: "UNAVAILABLE"
    });
    const result = executeStoreSearch({
      input: validInput({
        menuName: null,
        categories: []
      }),
      requestTimeMs,
      storeRepository: mocks.storeRepository,
      reviewRepository: mocks.reviewRepository
    });

    expect(mocks.searchStoreEvidence).not.toHaveBeenCalled();
    expect(result.status).toBe("COMPLETE");
    expect(result.partialReason).toBeNull();
  });

  it("validates request data before calling either repository", () => {
    const mocks = repositories({});

    expect(() =>
      executeStoreSearch({
        input: validInput({ debug: true }),
        requestTimeMs,
        storeRepository: mocks.storeRepository,
        reviewRepository: mocks.reviewRepository
      })
    ).toThrow("SEARCH_INPUT_INVALID");
    expect(() =>
      executeStoreSearch({
        input: validInput(),
        requestTimeMs: -1,
        storeRepository: mocks.storeRepository,
        reviewRepository: mocks.reviewRepository
      })
    ).toThrow("SEARCH_INPUT_INVALID");
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(mocks.searchStoreEvidence).not.toHaveBeenCalled();
  });

  it("preserves safe version and freshness failures", () => {
    const mocks = repositories({});
    mocks.storeRepository.loadSnapshot = () => {
      throw new StoreSearchError("SEARCH_DATA_STALE");
    };

    expect(() =>
      executeStoreSearch({
        input: validInput(),
        requestTimeMs,
        storeRepository: mocks.storeRepository,
        reviewRepository: mocks.reviewRepository
      })
    ).toThrow("SEARCH_DATA_STALE");
  });
});
