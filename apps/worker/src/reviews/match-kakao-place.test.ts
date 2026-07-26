import { describe, expect, it } from "vitest";
import {
  matchKakaoObservation,
  type KakaoMatchObservation,
  type KakaoMatchStore
} from "./match-kakao-place.js";

const observation: KakaoMatchObservation = {
  normalizedName: "fixturebakery",
  normalizedAddress: "서울특별시 마포구 Fixture로 1",
  normalizedPhone: "0200000000",
  latitudeE7: 375600000,
  longitudeE7: 1269000000
};

function store(
  overrides: Partial<KakaoMatchStore> = {}
): KakaoMatchStore {
  return {
    storeId: "store_fixture",
    normalizedName: "fixturebakery",
    normalizedAddress: "서울특별시 마포구 Fixture로 1",
    normalizedPhone: "0200000000",
    latitudeE7: 375600000,
    longitudeE7: 1269000000,
    catalogStatus: "published",
    ...overrides
  };
}

describe("Kakao place matching", () => {
  it("matches one strong published candidate as eligible", () => {
    expect(
      matchKakaoObservation(observation, [store()])
    ).toMatchObject({
      status: "MATCHED_ELIGIBLE",
      storeId: "store_fixture",
      signals: {
        addressExact: true,
        nameExact: true,
        phoneExact: true,
        coordinateDistanceMeters: 0
      }
    });
  });

  it("matches one strong non-published candidate as excluded", () => {
    expect(
      matchKakaoObservation(observation, [
        store({ catalogStatus: "excluded" })
      ])
    ).toMatchObject({
      status: "MATCHED_EXCLUDED",
      storeId: "store_fixture"
    });
  });

  it("keeps two strong candidates ambiguous", () => {
    expect(
      matchKakaoObservation(observation, [
        store(),
        store({ storeId: "store_duplicate" })
      ])
    ).toEqual({
      status: "AMBIGUOUS",
      storeId: null,
      signals: {
        candidateCount: 2,
        reasonCode: "MULTIPLE_STRONG_MATCHES"
      }
    });
  });

  it("does not match partial signals", () => {
    expect(
      matchKakaoObservation(observation, [
        store({ normalizedName: "differentbakery" })
      ])
    ).toEqual({
      status: "UNMATCHED",
      storeId: null,
      signals: {
        candidateCount: 1,
        reasonCode: "INSUFFICIENT_SIGNALS"
      }
    });
  });

  it("treats a conflicting phone as ambiguous despite close coordinates", () => {
    expect(
      matchKakaoObservation(
        { ...observation, normalizedPhone: "0299999999" },
        [store()]
      )
    ).toEqual({
      status: "AMBIGUOUS",
      storeId: null,
      signals: {
        candidateCount: 1,
        reasonCode: "PHONE_CONFLICT"
      }
    });
  });
});
