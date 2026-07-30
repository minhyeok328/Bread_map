import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_VERSION,
  SEARCH_CONTRACT_VERSION,
  structuredSearchInputSchema,
  structuredSearchResultSchema
} from "./search.js";

const validInput = {
  region: "  마포구  ",
  storeName: null,
  menuName: " 소금빵 ",
  categories: [
    {
      category: "SALT_BREAD",
      mode: "INCLUDE"
    }
  ],
  openNow: false,
  origin: {
    latitudeE7: 375634614,
    longitudeE7: 1269014494
  },
  maxDistanceM: 2500,
  reviewEvidenceStatus: "ANY",
  sortMode: "RELEVANCE",
  dataSnapshotVersion: `search-data-v1_${"a".repeat(64)}`,
  recommendationVersion: RECOMMENDATION_VERSION
} as const;

function validResult() {
  return {
    status: "COMPLETE",
    partialReason: null,
    items: [
      {
        storeId: "store_1",
        bakeryId: "bakery_1",
        displayName: "한강 빵집",
        normalizedAddress: "서울특별시 마포구 월드컵로 1",
        seoulDistrict: "마포구",
        latitudeE7: 375634614,
        longitudeE7: 1269014494,
        distanceUpperBoundM: 250,
        openingState: "OPEN",
        representativeMenus: [
          {
            menuId: "menu_1",
            name: "소금빵",
            category: "SALT_BREAD",
            evidenceId: "evidence_menu_1"
          }
        ],
        categories: ["SALT_BREAD"],
        review: {
          status: "AVAILABLE",
          count: 3,
          latestPublishedDate: "2026-07-29",
          snippet: "소금빵이 바삭해요"
        },
        reasonCodes: [
          "MENU_MATCH",
          "CATEGORY_MATCH",
          "NEARBY"
        ],
        warningCodes: []
      }
    ],
    metadata: {
      searchContractVersion: SEARCH_CONTRACT_VERSION,
      recommendationVersion: RECOMMENDATION_VERSION,
      dataSnapshotVersion: `search-data-v1_${"a".repeat(64)}`,
      catalogPublishId: "publish_fixture-01",
      searchEvidencePublishId: "search_evidence_fixture",
      reviewPublishVersionId: "review_publish_fixture",
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
  } as const;
}

describe("structuredSearchInputSchema", () => {
  it("normalizes a complete valid request", () => {
    expect(structuredSearchInputSchema.parse(validInput)).toEqual({
      ...validInput,
      region: "마포구",
      menuName: "소금빵"
    });
  });

  it.each([
    {
      name: "unknown root key",
      value: { ...validInput, debug: true }
    },
    {
      name: "blank optional text",
      value: { ...validInput, menuName: "   " }
    },
    {
      name: "overlong optional text",
      value: { ...validInput, storeName: "가".repeat(101) }
    },
    {
      name: "duplicate category",
      value: {
        ...validInput,
        categories: [
          { category: "PASTRY", mode: "INCLUDE" },
          { category: "PASTRY", mode: "INCLUDE" }
        ]
      }
    },
    {
      name: "conflicting category",
      value: {
        ...validInput,
        categories: [
          { category: "PASTRY", mode: "INCLUDE" },
          { category: "PASTRY", mode: "EXCLUDE" }
        ]
      }
    },
    {
      name: "too many categories",
      value: {
        ...validInput,
        categories: [
          "FERMENTED_BREAD",
          "PASTRY",
          "SALT_BREAD",
          "BAGUETTE",
          "LOAF_BREAD",
          "SWEET_BREAD",
          "SANDWICH",
          "DESSERT",
          "PASTRY"
        ].map((category) => ({
          category,
          mode: "INCLUDE"
        }))
      }
    },
    {
      name: "distance without origin",
      value: {
        ...validInput,
        origin: null,
        maxDistanceM: 1000
      }
    },
    {
      name: "distance sort without origin",
      value: {
        ...validInput,
        origin: null,
        maxDistanceM: null,
        sortMode: "DISTANCE"
      }
    },
    {
      name: "invalid latitude",
      value: {
        ...validInput,
        origin: {
          latitudeE7: 900000001,
          longitudeE7: 1269014494
        }
      }
    },
    {
      name: "fractional longitude",
      value: {
        ...validInput,
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494.5
        }
      }
    },
    {
      name: "unsafe data version",
      value: {
        ...validInput,
        dataSnapshotVersion: "../private.sqlite"
      }
    },
    {
      name: "wrong recommendation version",
      value: {
        ...validInput,
        recommendationVersion: "recommendation-v0"
      }
    }
  ])("rejects $name", ({ value }) => {
    expect(structuredSearchInputSchema.safeParse(value).success).toBe(
      false
    );
  });
});

describe("structuredSearchResultSchema", () => {
  it("accepts the complete public result shape", () => {
    expect(structuredSearchResultSchema.parse(validResult())).toEqual(
      validResult()
    );
  });

  it("requires partial state and reason to agree", () => {
    expect(
      structuredSearchResultSchema.safeParse({
        ...validResult(),
        status: "PARTIAL",
        partialReason: null
      }).success
    ).toBe(false);
  });

  it.each([
    {
      name: "request origin",
      mutate: () => ({
        ...validResult(),
        origin: validInput.origin
      })
    },
    {
      name: "exact distance",
      mutate: () => ({
        ...validResult(),
        items: [
          {
            ...validResult().items[0],
            distanceM: 42
          }
        ]
      })
    },
    {
      name: "numeric total score",
      mutate: () => ({
        ...validResult(),
        items: [
          {
            ...validResult().items[0],
            score: 0.99
          }
        ]
      })
    },
    {
      name: "internal FTS rank",
      mutate: () => ({
        ...validResult(),
        items: [
          {
            ...validResult().items[0],
            internalRank: -1.5
          }
        ]
      })
    },
    {
      name: "completeness key",
      mutate: () => ({
        ...validResult(),
        items: [
          {
            ...validResult().items[0],
            completeness: 10000
          }
        ]
      })
    },
    {
      name: "adjusted rating",
      mutate: () => ({
        ...validResult(),
        items: [
          {
            ...validResult().items[0],
            adjustedRating: 4800
          }
        ]
      })
    }
  ])("rejects $name", ({ mutate }) => {
    expect(
      structuredSearchResultSchema.safeParse(mutate()).success
    ).toBe(false);
  });
});
