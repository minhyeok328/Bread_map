import {
  STORE_NORMALIZATION_VERSION,
  normalizedStoreCandidateSchema
} from "@bread-map/contracts";
import { storeNormalizationCases } from "@bread-map/testkit";
import { describe, expect, it } from "vitest";
import {
  normalizeAddress,
  normalizeCoordinates,
  normalizePhone,
  normalizeStore,
  normalizeStoreName
} from "./normalize-store.js";

describe("store normalization tables", () => {
  it.each(storeNormalizationCases.address)(
    "$name",
    ({ input, expected }) => {
      expect(normalizeAddress(input)).toEqual(expected);
    }
  );

  it.each(storeNormalizationCases.phone)(
    "$name",
    ({ input, expected }) => {
      expect(normalizePhone(input)).toBe(expected);
    }
  );

  it.each(storeNormalizationCases.name)(
    "$name",
    ({ input, expected }) => {
      expect(normalizeStoreName(input)).toEqual(expected);
    }
  );

  it.each(storeNormalizationCases.coordinates)(
    "$name",
    ({ x, y, expected }) => {
      expect(normalizeCoordinates(x, y)).toEqual(expected);
    }
  );

  it("normalizes a Feature 2 staging row without requiring a phone", () => {
    const result = normalizeStore({
      snapshotId: "snapshot_fixture",
      sourceRecordId: "record_fixture",
      sourceRowId: "source_row_fixture",
      managementNumber: "SEOUL-001",
      businessName: "한강 빵집",
      roadNameAddress: "서울특별시 마포구 월드컵로 1",
      lotNumberAddress: "서울특별시 마포구 합정동 1-1",
      phone: null,
      sourceCoordinateX: "191234.125",
      sourceCoordinateY: "451234.5",
      businessStatusCode: "01",
      businessStatusName: "영업/정상",
      detailedBusinessStatusCode: "01",
      detailedBusinessStatusName: "영업",
      closedDate: null
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) {
      throw new Error("expected a normalized store candidate");
    }
    expect(() =>
      normalizedStoreCandidateSchema.parse(result.value)
    ).not.toThrow();
    expect(result.value).toMatchObject({
      normalizedName: "한강빵집",
      normalizedPhone: null,
      businessStatus: "active",
      normalizationVersion: STORE_NORMALIZATION_VERSION,
      reviewReasonCodes: []
    });
  });

  it("keeps a coordinate-less staging row for admin review", () => {
    const result = normalizeStore({
      snapshotId: "snapshot_fixture",
      sourceRecordId: "record_fixture_2",
      sourceRowId: "source_row_fixture_2",
      managementNumber: "SEOUL-002",
      businessName: "남산 베이커리",
      roadNameAddress: null,
      lotNumberAddress: "서울특별시 중구 회현동 2-2",
      phone: null,
      sourceCoordinateX: null,
      sourceCoordinateY: null,
      businessStatusCode: "01",
      businessStatusName: "영업/정상",
      detailedBusinessStatusCode: null,
      detailedBusinessStatusName: null,
      closedDate: null
    });

    expect(result).toMatchObject({
      accepted: true,
      value: {
        coordinates: null,
        reviewReasonCodes: ["COORDINATE_MISSING_OR_INVALID"]
      }
    });
  });
});
