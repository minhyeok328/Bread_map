import { describe, expect, it } from "vitest";
import {
  calculateAdjustedRating,
  calculateCompleteness,
  calculateGlobalRatingMean,
  calculateRoundedDistanceM,
  deriveOpeningState,
  deriveReviewStatus,
  distanceUpperBoundM,
  validateBusinessHours
} from "./derive-candidate.js";
import type {
  BusinessHourFact,
  RecommendationCandidateFacts
} from "./search-types.js";

function atKst(value: string): number {
  return Date.parse(`${value}+09:00`);
}

function hour(
  overrides: Partial<BusinessHourFact> = {}
): BusinessHourFact {
  return {
    intervalId: "hours_1",
    weekday: 1,
    sequence: 0,
    opensMinute: 600,
    closesMinute: 1080,
    closesNextDay: false,
    evidenceId: "hours_evidence_1",
    ...overrides
  };
}

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
    normalizedPhone: null,
    latitudeE7: 0,
    longitudeE7: 0,
    menus: [],
    storeAliases: [],
    businessHours: [],
    reviewAggregate: {
      count: 0,
      latestPublishedDate: null,
      ratedCount: 0,
      ratingSumBasisPoints: 0
    },
    ...overrides
  };
}

describe("deriveOpeningState", () => {
  it.each([
    ["2026-07-26T11:00:00", 0],
    ["2026-07-27T11:00:00", 1],
    ["2026-07-28T11:00:00", 2],
    ["2026-07-29T11:00:00", 3],
    ["2026-07-30T11:00:00", 4],
    ["2026-07-31T11:00:00", 5],
    ["2026-08-01T11:00:00", 6]
  ])("uses Asia/Seoul weekday for %s", (time, weekday) => {
    expect(
      deriveOpeningState(
        [
          hour({
            intervalId: `hours_${weekday}`,
            weekday
          })
        ],
        atKst(time)
      )
    ).toBe("OPEN");
  });

  it("treats opens as inclusive and closes as exclusive", () => {
    const hours = [hour()];
    expect(
      deriveOpeningState(hours, atKst("2026-07-27T10:00:00"))
    ).toBe("OPEN");
    expect(
      deriveOpeningState(hours, atKst("2026-07-27T17:59:59"))
    ).toBe("OPEN");
    expect(
      deriveOpeningState(hours, atKst("2026-07-27T18:00:00"))
    ).toBe("CLOSED");
  });

  it("carries an overnight interval into the next weekday", () => {
    const hours = [
      hour({
        opensMinute: 1320,
        closesMinute: 120,
        closesNextDay: true
      })
    ];
    expect(
      deriveOpeningState(hours, atKst("2026-07-27T22:00:00"))
    ).toBe("OPEN");
    expect(
      deriveOpeningState(hours, atKst("2026-07-28T01:59:59"))
    ).toBe("OPEN");
    expect(
      deriveOpeningState(hours, atKst("2026-07-28T02:00:00"))
    ).toBe("CLOSED");
  });

  it("returns unknown only when no verified schedule exists", () => {
    expect(
      deriveOpeningState([], atKst("2026-07-27T11:00:00"))
    ).toBe("UNKNOWN");
    expect(
      deriveOpeningState(
        [hour({ weekday: 2 })],
        atKst("2026-07-27T11:00:00")
      )
    ).toBe("CLOSED");
  });
});

describe("business hour validation", () => {
  it("rejects same-day and week-boundary overlaps", () => {
    expect(() =>
      validateBusinessHours([
        hour(),
        hour({
          intervalId: "hours_2",
          sequence: 1,
          opensMinute: 1000,
          closesMinute: 1200
        })
      ])
    ).toThrow("BUSINESS_HOURS_OVERLAP");
    expect(() =>
      validateBusinessHours([
        hour({
          intervalId: "hours_saturday",
          weekday: 6,
          opensMinute: 1380,
          closesMinute: 60,
          closesNextDay: true
        }),
        hour({
          intervalId: "hours_sunday",
          weekday: 0,
          opensMinute: 30,
          closesMinute: 120
        })
      ])
    ).toThrow("BUSINESS_HOURS_OVERLAP");
  });

  it("accepts adjacent intervals", () => {
    expect(
      validateBusinessHours([
        hour({ closesMinute: 900 }),
        hour({
          intervalId: "hours_2",
          sequence: 1,
          opensMinute: 900,
          closesMinute: 1080
        })
      ])
    ).toBe(true);
  });
});

describe("distance derivation", () => {
  it("rounds Haversine distance once", () => {
    expect(
      calculateRoundedDistanceM(
        { latitudeE7: 0, longitudeE7: 0 },
        { latitudeE7: 0, longitudeE7: 10000000 }
      )
    ).toBe(111195);
  });

  it.each([
    [null, null],
    [0, 250],
    [1, 250],
    [250, 250],
    [251, 500],
    [111195, 111250]
  ])("buckets %s to %s", (distance, expected) => {
    expect(distanceUpperBoundM(distance)).toBe(expected);
  });
});

describe("review, completeness and rating derivation", () => {
  it.each([
    [0, "INSUFFICIENT"],
    [1, "INSUFFICIENT"],
    [2, "INSUFFICIENT"],
    [3, "AVAILABLE"]
  ])("maps review count %s", (count, expected) => {
    expect(deriveReviewStatus(count)).toBe(expected);
  });

  it("uses the exact integer completeness weights", () => {
    expect(calculateCompleteness(candidate(), "UNKNOWN")).toBe(0);
    expect(
      calculateCompleteness(
        candidate({
          normalizedPhone: "0212345678",
          menus: [
            {
              menuId: "menu_1",
              name: "소금빵",
              normalizedName: "소금빵",
              category: "SALT_BREAD",
              evidenceId: "menu_evidence_1",
              aliases: []
            }
          ],
          reviewAggregate: {
            count: 3,
            latestPublishedDate: "2026-07-30",
            ratedCount: 0,
            ratingSumBasisPoints: 0
          }
        }),
        "OPEN"
      )
    ).toBe(10000);
  });

  it("uses the rated global mean and fixed no-rating fallback", () => {
    expect(
      calculateGlobalRatingMean([
        candidate({
          reviewAggregate: {
            count: 2,
            latestPublishedDate: "2026-07-30",
            ratedCount: 2,
            ratingSumBasisPoints: 9000
          }
        })
      ])
    ).toBe(4500);
    expect(calculateGlobalRatingMean([candidate()])).toBe(4000);
    expect(
      calculateAdjustedRating(
        {
          count: 1,
          latestPublishedDate: "2026-07-30",
          ratedCount: 1,
          ratingSumBasisPoints: 5000
        },
        4500
      )
    ).toBe(4583);
  });
});
