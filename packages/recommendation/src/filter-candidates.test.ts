import {
  RECOMMENDATION_VERSION,
  type StructuredSearchInput
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import { filterCandidates } from "./filter-candidates.js";
import { normalizeStructuredSearchQuery } from "./normalize-query.js";
import type {
  DerivedCandidateFacts,
  ReviewEvidenceFact
} from "./search-types.js";

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

function candidate(
  overrides: Partial<DerivedCandidateFacts> = {}
): DerivedCandidateFacts {
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
        menuId: "menu_salt",
        name: "소금빵",
        normalizedName: "소금빵",
        category: "SALT_BREAD",
        evidenceId: "evidence_menu_salt",
        aliases: [
          {
            aliasId: "alias_sio",
            alias: "시오빵",
            normalizedAlias: "시오빵",
            evidenceId: "evidence_alias_sio"
          }
        ]
      }
    ],
    storeAliases: [
      {
        aliasId: "alias_region",
        aliasType: "REGION",
        alias: "홍대입구",
        normalizedAlias: "홍대입구",
        evidenceId: "evidence_region"
      },
      {
        aliasId: "alias_store",
        aliasType: "STORE_NAME",
        alias: "한강제과",
        normalizedAlias: "한강제과",
        evidenceId: "evidence_store"
      }
    ],
    businessHours: [],
    reviewAggregate: {
      count: 3,
      latestPublishedDate: "2026-07-30",
      ratedCount: 3,
      ratingSumBasisPoints: 13500
    },
    openingState: "OPEN",
    distanceM: 500,
    reviewStatus: "AVAILABLE",
    completeness: 10000,
    adjustedRating: 4500,
    ...overrides
  };
}

function evidence(
  storeId = "store_1"
): ReviewEvidenceFact {
  return {
    reviewId: `review_${storeId}`,
    storeId,
    publishedDate: "2026-07-30",
    snippet: "소금빵이 바삭해요",
    internalRank: -1.5,
    termPriority: 0
  };
}

describe("filterCandidates", () => {
  it.each([
    {
      name: "region",
      search: input({ region: "종로구" }),
      reason: "REGION_MISMATCH"
    },
    {
      name: "store name",
      search: input({ storeName: "다른 가게" }),
      reason: "STORE_NAME_MISMATCH"
    },
    {
      name: "excluded category",
      search: input({
        categories: [
          { category: "SALT_BREAD", mode: "EXCLUDE" }
        ]
      }),
      reason: "EXCLUDED_CATEGORY"
    },
    {
      name: "missing included category",
      search: input({
        categories: [{ category: "PASTRY", mode: "INCLUDE" }]
      }),
      reason: "INCLUDED_CATEGORY_MISSING"
    },
    {
      name: "closed now",
      search: input({ openNow: true }),
      value: candidate({ openingState: "UNKNOWN" }),
      reason: "NOT_OPEN"
    },
    {
      name: "distance",
      search: input({
        origin: { latitudeE7: 0, longitudeE7: 0 },
        maxDistanceM: 499
      }),
      reason: "DISTANCE_EXCEEDED"
    },
    {
      name: "review status",
      search: input({ reviewEvidenceStatus: "INSUFFICIENT" }),
      reason: "REVIEW_STATUS_MISMATCH"
    },
    {
      name: "menu",
      search: input({ menuName: "바게트" }),
      reason: "MENU_MISMATCH"
    }
  ])("applies the primary $name exclusion", ({
    search,
    value = candidate(),
    reason
  }) => {
    const result = filterCandidates({
      candidates: [value],
      query: normalizeStructuredSearchQuery(search),
      reviewEvidenceByStore: new Map(),
      ftsAvailable: true
    });

    expect(result.candidates).toEqual([]);
    expect(
      result.reasonCounts[
        reason as keyof typeof result.reasonCounts
      ]
    ).toBe(1);
    expect(
      Object.values(result.reasonCounts).reduce(
        (total, count) => total + count,
        0
      )
    ).toBe(1);
  });

  it("matches approved field-scoped aliases", () => {
    const result = filterCandidates({
      candidates: [candidate()],
      query: normalizeStructuredSearchQuery(
        input({
          region: "홍대 입구",
          storeName: "한강 제과",
          menuName: "시오빵"
        })
      ),
      reviewEvidenceByStore: new Map(),
      ftsAvailable: false
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      verifiedMenuMatch: true,
      regionMatch: true,
      storeNameMatch: true
    });
  });

  it("uses a real FTS hit for menu fallback but never fabricates it", () => {
    const value = candidate({ menus: [] });
    const query = normalizeStructuredSearchQuery(
      input({ menuName: "소금빵" })
    );

    expect(
      filterCandidates({
        candidates: [value],
        query,
        reviewEvidenceByStore: new Map([
          ["store_1", evidence()]
        ]),
        ftsAvailable: true
      }).candidates
    ).toHaveLength(1);
    expect(
      filterCandidates({
        candidates: [value],
        query,
        reviewEvidenceByStore: new Map(),
        ftsAvailable: false
      }).candidates
    ).toEqual([]);
  });

  it("does not restore a hard-excluded store with FTS or rating", () => {
    const result = filterCandidates({
      candidates: [
        candidate({
          adjustedRating: 5000,
          reviewAggregate: {
            count: 100,
            latestPublishedDate: "2026-07-30",
            ratedCount: 100,
            ratingSumBasisPoints: 500000
          }
        })
      ],
      query: normalizeStructuredSearchQuery(
        input({
          menuName: "소금빵",
          categories: [
            { category: "SALT_BREAD", mode: "EXCLUDE" }
          ]
        })
      ),
      reviewEvidenceByStore: new Map([
        ["store_1", evidence()]
      ]),
      ftsAvailable: true
    });

    expect(result.candidates).toEqual([]);
    expect(result.reasonCounts.EXCLUDED_CATEGORY).toBe(1);
  });
});
