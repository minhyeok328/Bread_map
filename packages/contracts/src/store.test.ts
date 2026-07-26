import { describe, expect, it } from "vitest";
import {
  brandEligibilityEvidenceSchema,
  catalogPublishSummarySchema,
  eligibilityDecisionSchema,
  normalizedStoreCandidateSchema,
  storeMatchCandidateSchema
} from "./store.js";

describe("store contracts", () => {
  it("accepts a normalized Seoul candidate with application identity", () => {
    expect(
      normalizedStoreCandidateSchema.parse({
        candidateId: "candidate_fixture",
        snapshotId: "snapshot_fixture",
        sourceRecordId: "record_fixture",
        sourceRowId: "source_row_fixture",
        managementNumber: "SEOUL-FIXTURE-001",
        displayName: "소금빵 연구소 본점",
        normalizedName: "소금빵연구소본점",
        normalizedBrandName: "소금빵연구소",
        branchName: "본점",
        displayAddress: "서울특별시 마포구 월드컵로 1",
        normalizedAddress: "서울특별시 마포구 월드컵로 1",
        seoulDistrict: "마포구",
        normalizedPhone: "0212345678",
        coordinates: {
          latitudeE7: 375600000,
          longitudeE7: 1269000000,
          crs: "EPSG:4326"
        },
        businessStatus: "active",
        normalizationVersion: "store-normalization-v1",
        reviewReasonCodes: []
      })
    ).toMatchObject({
      normalizedBrandName: "소금빵연구소",
      businessStatus: "active"
    });
  });

  it("requires address, coordinate, phone and name evidence for every match", () => {
    expect(
      storeMatchCandidateSchema.parse({
        matchId: "match_fixture",
        leftCandidateId: "candidate_left",
        rightCandidateId: "candidate_right",
        scoreBasisPoints: 10000,
        status: "auto_merge",
        matcherVersion: "store-matcher-v1",
        evidence: {
          address: {
            available: true,
            matched: true,
            conflict: false,
            left: "서울특별시 마포구 월드컵로 1",
            right: "서울특별시 마포구 월드컵로 1"
          },
          coordinate: {
            available: true,
            matched: true,
            distanceMeters: 0
          },
          phone: {
            available: true,
            matched: true,
            conflict: false,
            left: "0212345678",
            right: "0212345678"
          },
          name: {
            available: true,
            matched: true,
            similarityBasisPoints: 10000
          }
        }
      })
    ).toMatchObject({ status: "auto_merge" });

    expect(() =>
      storeMatchCandidateSchema.parse({
        matchId: "match_missing_phone",
        leftCandidateId: "candidate_left",
        rightCandidateId: "candidate_right",
        scoreBasisPoints: 8000,
        status: "admin_review",
        matcherVersion: "store-matcher-v1",
        evidence: {
          address: {
            available: true,
            matched: true,
            conflict: false,
            left: "서울특별시 마포구 월드컵로 1",
            right: "서울특별시 마포구 월드컵로 1"
          },
          coordinate: {
            available: true,
            matched: true,
            distanceMeters: 0
          },
          name: {
            available: true,
            matched: true,
            similarityBasisPoints: 10000
          }
        }
      })
    ).toThrow();
  });

  it("requires explicit reasons on every eligibility decision", () => {
    expect(
      eligibilityDecisionSchema.parse({
        decisionId: "decision_fixture",
        bakeryId: "bakery_fixture",
        storeIds: ["store_fixture"],
        classification: "INDEPENDENT_SINGLE",
        status: "eligible",
        reasons: [
          {
            code: "ADMIN_APPROVED",
            evidenceRefs: [
              "fixture://admin/independent-single"
            ]
          }
        ],
        ruleVersion: "store-eligibility-v1"
      })
    ).toMatchObject({
      classification: "INDEPENDENT_SINGLE",
      status: "eligible"
    });

    expect(() =>
      eligibilityDecisionSchema.parse({
        decisionId: "decision_without_reasons",
        bakeryId: "bakery_fixture",
        storeIds: ["store_fixture"],
        classification: "UNCERTAIN_REVIEW_REQUIRED",
        status: "admin_review",
        reasons: [],
        ruleVersion: "store-eligibility-v1"
      })
    ).toThrow();
  });

  it.each([
    {
      name: "FTC no-match",
      input: {
        ftcStatus: "not_found",
        ftcEvidenceRefs: [],
        adminReviewStatus: "pending",
        adminEvidenceRefs: []
      }
    },
    {
      name: "admin approval",
      input: {
        ftcStatus: "unavailable",
        ftcEvidenceRefs: [],
        adminReviewStatus: "approved",
        adminEvidenceRefs: []
      }
    }
  ] as const)(
    "rejects $name without an evidence reference",
    ({ input }) => {
      expect(() =>
        brandEligibilityEvidenceSchema.parse({
          brandKey: "brand_fixture",
          displayName: "Fixture Bakery",
          sourceManagementNumbers: ["MNG-FIXTURE-001"],
          operatorEvidenceRefs: [],
          independenceEvidenceRefs: [
            "fixture://independent/brand_fixture"
          ],
          ...input
        })
      ).toThrow();
    }
  );

  it("validates nonnegative catalog publication counts", () => {
    expect(
      catalogPublishSummarySchema.parse({
        publishId: "publish_fixture",
        snapshotId: "snapshot_fixture",
        status: "SUCCEEDED",
        candidateCount: 3,
        publishedCount: 2,
        excludedCount: 0,
        adminReviewCount: 1,
        normalizationVersion: "store-normalization-v1",
        matcherVersion: "store-matcher-v1",
        eligibilityVersion: "store-eligibility-v1"
      })
    ).toMatchObject({
      publishedCount: 2,
      adminReviewCount: 1
    });
  });
});
