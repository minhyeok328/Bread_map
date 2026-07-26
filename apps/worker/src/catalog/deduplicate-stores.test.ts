import {
  canonicalStoreCandidateSchema,
  normalizedStoreCandidateSchema
} from "@bread-map/contracts";
import { storeDeduplicationFixture } from "@bread-map/testkit";
import { describe, expect, it } from "vitest";
import { deduplicateStores } from "./deduplicate-stores.js";

function candidate(
  candidateId: string,
  overrides: Record<string, unknown> = {}
) {
  return normalizedStoreCandidateSchema.parse({
    ...storeDeduplicationFixture.candidates[0],
    candidateId,
    sourceRecordId: `record_${candidateId}`,
    sourceRowId: `row_${candidateId}`,
    managementNumber: `MNG-${candidateId}`,
    ...overrides
  });
}

describe("store deduplication", () => {
  it("matches the fixture answer table and records every merge signal", () => {
    const candidates = storeDeduplicationFixture.candidates.map(
      (candidate) => normalizedStoreCandidateSchema.parse(candidate)
    );
    const result = deduplicateStores(candidates);

    expect(
      result.matches.map(
        ({
          leftCandidateId,
          rightCandidateId,
          scoreBasisPoints,
          status,
          evidence
        }) => ({
          leftCandidateId,
          rightCandidateId,
          scoreBasisPoints,
          status,
          evidence
        })
      )
    ).toEqual(storeDeduplicationFixture.expectedMatches);
    expect(
      result.stores.map((store) => store.sourceCandidateIds)
    ).toEqual(storeDeduplicationFixture.expectedGroups);

    for (const match of result.matches) {
      expect(Object.keys(match.evidence).sort()).toEqual([
        "address",
        "coordinate",
        "name",
        "phone"
      ]);
    }
    for (const store of result.stores) {
      expect(() =>
        canonicalStoreCandidateSchema.parse(store)
      ).not.toThrow();
    }
  });

  it("is independent of staging row input order", () => {
    const candidates = storeDeduplicationFixture.candidates.map(
      (candidate) => normalizedStoreCandidateSchema.parse(candidate)
    );
    const forward = deduplicateStores(candidates);
    const reverse = deduplicateStores([...candidates].reverse());

    expect(reverse).toEqual(forward);
  });

  it("applies the 0.92 auto-merge and 0.75 review boundaries exactly", () => {
    const atAutoMergeBoundary = deduplicateStores([
      candidate("boundary_auto_left", {
        normalizedName: "abcdefghijklmnop",
        normalizedBrandName: "abcdefghijklmnop"
      }),
      candidate("boundary_auto_right", {
        normalizedName: "abcdefghXYZQRSTU",
        normalizedBrandName: "abcdefghXYZQRSTU"
      })
    ]).matches[0];
    const atAdminReviewBoundary = deduplicateStores([
      candidate("boundary_review_left", {
        coordinates: null
      }),
      candidate("boundary_review_right", {
        coordinates: null
      })
    ]).matches[0];

    expect(atAutoMergeBoundary).toMatchObject({
      scoreBasisPoints: 9200,
      status: "auto_merge",
      evidence: {
        name: {
          similarityBasisPoints: 4667,
          matched: false
        }
      }
    });
    expect(atAdminReviewBoundary).toMatchObject({
      scoreBasisPoints: 7500,
      status: "admin_review",
      evidence: {
        coordinate: {
          available: false,
          matched: false,
          distanceMeters: null
        }
      }
    });
  });

  it("routes a strong match with an address conflict to review", () => {
    const result = deduplicateStores([
      candidate("conflict_left"),
      candidate("conflict_right", {
        displayAddress: "서울특별시 마포구 월드컵로 99",
        normalizedAddress: "서울특별시 마포구 월드컵로 99"
      })
    ]);

    expect(result.matches[0]).toMatchObject({
      scoreBasisPoints: 6000,
      status: "admin_review",
      evidence: {
        address: {
          matched: false,
          conflict: true
        }
      }
    });
  });

  it("keeps distant same-brand branches separate", () => {
    const result = deduplicateStores([
      candidate("branch_left", {
        displayName: "소금빵 연구소 본점",
        normalizedName: "소금빵연구소본점",
        normalizedBrandName: "소금빵연구소",
        normalizedPhone: "0211111111"
      }),
      candidate("branch_right", {
        displayName: "소금빵 연구소 강남점",
        normalizedName: "소금빵연구소강남점",
        normalizedBrandName: "소금빵연구소",
        displayAddress: "서울특별시 강남구 테헤란로 99",
        normalizedAddress: "서울특별시 강남구 테헤란로 99",
        seoulDistrict: "강남구",
        normalizedPhone: "0222222222",
        coordinates: {
          latitudeE7: 374971000,
          longitudeE7: 1270276000,
          crs: "EPSG:4326"
        }
      })
    ]);

    expect(result.matches[0]).toMatchObject({
      scoreBasisPoints: 1500,
      status: "separate",
      evidence: {
        address: {
          conflict: true
        },
        coordinate: {
          matched: false
        },
        phone: {
          conflict: true
        },
        name: {
          matched: true
        }
      }
    });
    expect(result.stores).toHaveLength(2);
    expect(
      result.stores.every((store) => store.mergeStatus === "distinct")
    ).toBe(true);
  });

  it("applies the 50m evidence and 100m candidate-distance boundaries", () => {
    const baseCoordinates = {
      latitudeE7: 375600000,
      longitudeE7: 1269000000,
      crs: "EPSG:4326"
    } as const;
    const coordinateOnlyOverrides = {
      displayAddress: "서울특별시 강남구 테헤란로 99",
      normalizedAddress: "서울특별시 강남구 테헤란로 99",
      seoulDistrict: "강남구",
      normalizedPhone: "0222222222",
      displayName: "완전히 다른 상호",
      normalizedName: "완전히다른상호",
      normalizedBrandName: "완전히다른상호"
    };
    const withinFifty = deduplicateStores([
      candidate("distance_50_left", {
        coordinates: baseCoordinates
      }),
      candidate("distance_50_right", {
        ...coordinateOnlyOverrides,
        coordinates: {
          ...baseCoordinates,
          latitudeE7: baseCoordinates.latitudeE7 + 4496
        }
      })
    ]);
    const withinOneHundred = deduplicateStores([
      candidate("distance_100_left", {
        coordinates: baseCoordinates
      }),
      candidate("distance_100_right", {
        ...coordinateOnlyOverrides,
        coordinates: {
          ...baseCoordinates,
          latitudeE7: baseCoordinates.latitudeE7 + 8993
        }
      })
    ]);
    const beyondOneHundred = deduplicateStores([
      candidate("distance_over_100_left", {
        coordinates: baseCoordinates
      }),
      candidate("distance_over_100_right", {
        ...coordinateOnlyOverrides,
        coordinates: {
          ...baseCoordinates,
          latitudeE7: baseCoordinates.latitudeE7 + 8994
        }
      })
    ]);

    expect(withinFifty.matches[0]!.evidence.coordinate).toMatchObject(
      {
        matched: true
      }
    );
    expect(
      withinFifty.matches[0]!.evidence.coordinate.distanceMeters
    ).toBeLessThanOrEqual(50);
    expect(withinOneHundred.matches).toHaveLength(1);
    expect(
      withinOneHundred.matches[0]!.evidence.coordinate
        .distanceMeters
    ).toBeLessThanOrEqual(100);
    expect(
      withinOneHundred.matches[0]!.evidence.coordinate.matched
    ).toBe(false);
    expect(beyondOneHundred.matches).toHaveLength(0);
  });
});
