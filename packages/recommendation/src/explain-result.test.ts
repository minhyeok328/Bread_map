import {
  RECOMMENDATION_VERSION,
  structuredSearchItemSchema,
  type StructuredSearchInput
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import {
  buildPublicSearchItem,
  buildRelaxationOptions
} from "./explain-result.js";
import { normalizeStructuredSearchQuery } from "./normalize-query.js";
import type { RankableCandidate } from "./search-types.js";

const dataVersion = `search-data-v1_${"a".repeat(64)}`;

function input(
  overrides: Partial<StructuredSearchInput> = {}
): StructuredSearchInput {
  return {
    region: "마포구",
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

function candidate(
  overrides: Partial<RankableCandidate> = {}
): RankableCandidate {
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
        menuId: "menu_b",
        name: "크루아상",
        normalizedName: "크루아상",
        category: "PASTRY",
        evidenceId: "evidence_b",
        aliases: []
      },
      {
        menuId: "menu_a",
        name: "소금빵",
        normalizedName: "소금빵",
        category: "SALT_BREAD",
        evidenceId: "evidence_a",
        aliases: [
          {
            aliasId: "alias_sio",
            alias: "시오빵",
            normalizedAlias: "시오빵",
            evidenceId: "evidence_sio"
          }
        ]
      },
      {
        menuId: "menu_c",
        name: "식빵",
        normalizedName: "식빵",
        category: "LOAF_BREAD",
        evidenceId: "evidence_c",
        aliases: []
      },
      {
        menuId: "menu_d",
        name: "바게트",
        normalizedName: "바게트",
        category: "BAGUETTE",
        evidenceId: "evidence_d",
        aliases: []
      }
    ],
    storeAliases: [],
    businessHours: [],
    reviewAggregate: {
      count: 2,
      latestPublishedDate: "2026-07-30",
      ratedCount: 2,
      ratingSumBasisPoints: 9000
    },
    openingState: "OPEN",
    distanceM: 251,
    reviewStatus: "INSUFFICIENT",
    completeness: 8500,
    adjustedRating: 4429,
    verifiedMenuMatch: true,
    includedCategoryMatchCount: 1,
    regionMatch: true,
    storeNameMatch: false,
    reviewEvidence: {
      reviewId: "review_1",
      storeId: "store_1",
      publishedDate: "2026-07-30",
      snippet: "시오빵이 바삭해요",
      internalRank: -1.2,
      termPriority: 0
    },
    usableFtsEvidence: false,
    ...overrides
  };
}

describe("buildPublicSearchItem", () => {
  it("returns stable public evidence without exact/internal scores", () => {
    const item = buildPublicSearchItem(
      candidate(),
      normalizeStructuredSearchQuery(input()),
      true
    );

    expect(item).toMatchObject({
      storeId: "store_1",
      distanceUpperBoundM: 500,
      representativeMenus: [
        { menuId: "menu_a", evidenceId: "evidence_a" },
        { menuId: "menu_d", evidenceId: "evidence_d" },
        { menuId: "menu_c", evidenceId: "evidence_c" }
      ],
      review: {
        status: "INSUFFICIENT",
        count: 2,
        snippet: "시오빵이 바삭해요"
      },
      warningCodes: ["INSUFFICIENT_REVIEWS"]
    });
    expect(item.reasonCodes).toEqual([
      "MENU_MATCH",
      "CATEGORY_MATCH",
      "REGION_MATCH",
      "OPEN_NOW",
      "NEARBY",
      "RECENT_REVIEW",
      "VERIFIED_DATA"
    ]);
    expect(JSON.stringify(item)).not.toMatch(
      /origin|distanceM|internalRank|completeness|adjustedRating|score/
    );
    expect(
      structuredSearchItemSchema.safeParse(item).success
    ).toBe(true);
  });

  it("removes review text and adds a truthful FTS warning", () => {
    const item = buildPublicSearchItem(
      candidate(),
      normalizeStructuredSearchQuery(input()),
      false
    );
    expect(item.review.snippet).toBeNull();
    expect(item.warningCodes).toEqual([
      "INSUFFICIENT_REVIEWS",
      "FTS_UNAVAILABLE"
    ]);
  });

  it("bounds long upstream display fields to the public contract", () => {
    const item = buildPublicSearchItem(
      candidate({
        displayName: "긴".repeat(201),
        normalizedAddress: "주".repeat(501),
        reviewEvidence: {
          reviewId: "review_long",
          storeId: "store_1",
          publishedDate: "2026-07-30",
          snippet: "후".repeat(501),
          internalRank: -1,
          termPriority: 0
        }
      }),
      normalizeStructuredSearchQuery(input()),
      true
    );

    expect(item.displayName).toHaveLength(200);
    expect(item.normalizedAddress).toHaveLength(500);
    expect(item.review.snippet).toHaveLength(500);
    expect(
      structuredSearchItemSchema.safeParse(item).success
    ).toBe(true);
  });
});

describe("buildRelaxationOptions", () => {
  it("returns only applicable codes in approved order for empty results", () => {
    expect(
      buildRelaxationOptions(
        normalizeStructuredSearchQuery(
          input({ reviewEvidenceStatus: "AVAILABLE" })
        ),
        0
      )
    ).toEqual([
      "EXPAND_REGION_OR_DISTANCE",
      "DISABLE_OPEN_NOW",
      "INCLUDE_INSUFFICIENT_REVIEWS",
      "EXPAND_ADJACENT_CATEGORY"
    ]);
    expect(
      buildRelaxationOptions(
        normalizeStructuredSearchQuery(input()),
        1
      )
    ).toEqual([]);
  });
});
