import {
  RECOMMENDATION_VERSION,
  type StructuredSearchInput
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import { normalizeStructuredSearchQuery } from "./normalize-query.js";
import { rankCandidates } from "./rank-candidates.js";
import type { RankableCandidate } from "./search-types.js";

const dataVersion = `search-data-v1_${"a".repeat(64)}`;

function input(
  overrides: Partial<StructuredSearchInput> = {}
): StructuredSearchInput {
  return {
    region: null,
    storeName: null,
    menuName: null,
    categories: [],
    openNow: false,
    origin: null,
    maxDistanceM: null,
    reviewEvidenceStatus: "ANY",
    sortMode: "RELEVANCE",
    dataSnapshotVersion: dataVersion,
    recommendationVersion: RECOMMENDATION_VERSION,
    ...overrides
  };
}

function rankable(
  storeId: string,
  overrides: Partial<RankableCandidate> = {}
): RankableCandidate {
  return {
    storeId,
    bakeryId: `bakery_${storeId}`,
    displayName: storeId,
    normalizedName: storeId,
    normalizedAddress: "서울특별시 마포구 월드컵로 1",
    seoulDistrict: "마포구",
    normalizedPhone: null,
    latitudeE7: 375634614,
    longitudeE7: 1269014494,
    menus: [],
    storeAliases: [],
    businessHours: [],
    reviewAggregate: {
      count: 3,
      latestPublishedDate: "2026-07-20",
      ratedCount: 3,
      ratingSumBasisPoints: 12000
    },
    openingState: "OPEN",
    distanceM: 500,
    reviewStatus: "AVAILABLE",
    completeness: 5000,
    adjustedRating: 4000,
    verifiedMenuMatch: false,
    includedCategoryMatchCount: 0,
    regionMatch: false,
    storeNameMatch: false,
    reviewEvidence: null,
    usableFtsEvidence: false,
    ...overrides
  };
}

describe("rankCandidates", () => {
  it("applies every relevance key before the final store ID", () => {
    const candidates = [
      rankable("store_id_tie_b"),
      rankable("store_rating", { adjustedRating: 4100 }),
      rankable("store_completeness", {
        completeness: 6000,
        adjustedRating: 1000
      }),
      rankable("store_distance", {
        distanceM: 400,
        completeness: 1000
      }),
      rankable("store_open", {
        openingState: "OPEN",
        distanceM: 900
      }),
      rankable("store_review_date", {
        reviewAggregate: {
          count: 4,
          latestPublishedDate: "2026-07-30",
          ratedCount: 0,
          ratingSumBasisPoints: 0
        }
      }),
      rankable("store_review_count", {
        reviewAggregate: {
          count: 5,
          latestPublishedDate: "2026-07-01",
          ratedCount: 0,
          ratingSumBasisPoints: 0
        }
      }),
      rankable("store_fts", {
        reviewEvidence: {
          reviewId: "review_1",
          storeId: "store_fts",
          publishedDate: "2026-07-30",
          snippet: "소금빵",
          internalRank: -2,
          termPriority: 0
        },
        usableFtsEvidence: true
      }),
      rankable("store_category", {
        includedCategoryMatchCount: 1
      }),
      rankable("store_menu", { verifiedMenuMatch: true }),
      rankable("store_id_tie_a")
    ];

    expect(
      rankCandidates(
        candidates,
        normalizeStructuredSearchQuery(input())
      ).map((candidate) => candidate.storeId)
    ).toEqual([
      "store_menu",
      "store_category",
      "store_fts",
      "store_review_count",
      "store_review_date",
      "store_distance",
      "store_completeness",
      "store_rating",
      "store_id_tie_a",
      "store_id_tie_b",
      "store_open"
    ]);
  });

  it("keeps FTS and review evidence ahead of distance mode", () => {
    const query = normalizeStructuredSearchQuery(
      input({
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        },
        sortMode: "DISTANCE"
      })
    );
    const evidence = rankable("store_far_with_fts", {
      distanceM: 2000,
      reviewEvidence: {
        reviewId: "review_1",
        storeId: "store_far_with_fts",
        publishedDate: "2026-07-30",
        snippet: "소금빵",
        internalRank: -1,
        termPriority: 0
      },
      usableFtsEvidence: true
    });
    const close = rankable("store_close", { distanceM: 10 });

    expect(
      rankCandidates([close, evidence], query).map(
        (candidate) => candidate.storeId
      )
    ).toEqual(["store_far_with_fts", "store_close"]);
  });

  it("uses distance before opening only inside visit conditions", () => {
    const query = normalizeStructuredSearchQuery(
      input({
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        },
        sortMode: "DISTANCE"
      })
    );
    expect(
      rankCandidates(
        [
          rankable("store_open_far", {
            distanceM: 500,
            openingState: "OPEN"
          }),
          rankable("store_closed_close", {
            distanceM: 100,
            openingState: "CLOSED"
          })
        ],
        query
      ).map((candidate) => candidate.storeId)
    ).toEqual(["store_closed_close", "store_open_far"]);
  });

  it("does not let insufficient review FTS or rating invert stronger keys", () => {
    const query = normalizeStructuredSearchQuery(input());
    const stronger = rankable("store_stronger", {
      completeness: 6000,
      adjustedRating: 1000
    });
    const weaker = rankable("store_weaker", {
      reviewStatus: "INSUFFICIENT",
      reviewAggregate: {
        count: 2,
        latestPublishedDate: "2026-07-30",
        ratedCount: 2,
        ratingSumBasisPoints: 10000
      },
      reviewEvidence: {
        reviewId: "review_weak",
        storeId: "store_weaker",
        publishedDate: "2026-07-30",
        snippet: "소금빵",
        internalRank: -100,
        termPriority: 0
      },
      usableFtsEvidence: false,
      completeness: 5000,
      adjustedRating: 5000
    });
    expect(
      rankCandidates([weaker, stronger], query).map(
        (candidate) => candidate.storeId
      )
    ).toEqual(["store_stronger", "store_weaker"]);
  });
});
