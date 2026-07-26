import { z } from "zod";

export const STORE_NORMALIZATION_VERSION =
  "store-normalization-v1";
export const STORE_MATCHER_VERSION = "store-matcher-v1";
export const STORE_ELIGIBILITY_VERSION =
  "store-eligibility-v1";

export const eligibilityClassifications = [
  "INDEPENDENT_SINGLE",
  "DIRECT_ONLY_SMALL_CHAIN",
  "FRANCHISE",
  "CHAIN_TOO_LARGE",
  "UNCERTAIN_REVIEW_REQUIRED"
] as const;

export const eligibilityDecisionStatuses = [
  "eligible",
  "excluded",
  "admin_review"
] as const;

export const matchStatuses = [
  "auto_merge",
  "admin_review",
  "separate"
] as const;

export const normalizedCoordinatesSchema = z.object({
  latitudeE7: z.number().int().min(-900000000).max(900000000),
  longitudeE7: z
    .number()
    .int()
    .min(-1800000000)
    .max(1800000000),
  crs: z.literal("EPSG:4326")
});

export const normalizedStoreCandidateSchema = z.object({
  candidateId: z.string().min(1),
  snapshotId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  sourceRowId: z.string().min(1),
  managementNumber: z.string().min(1),
  displayName: z.string().min(1),
  normalizedName: z.string().min(1),
  normalizedBrandName: z.string().min(1),
  branchName: z.string().min(1).nullable(),
  displayAddress: z.string().min(1),
  normalizedAddress: z.string().min(1),
  seoulDistrict: z.string().regex(/^[가-힣]+구$/),
  normalizedPhone: z.string().regex(/^\d{9,11}$/).nullable(),
  coordinates: normalizedCoordinatesSchema.nullable(),
  businessStatus: z.enum(["active", "inactive", "unknown"]),
  normalizationVersion: z.string().min(1),
  reviewReasonCodes: z.array(z.string().min(1))
});

const matchAvailabilitySchema = z.object({
  available: z.boolean(),
  matched: z.boolean()
});

const matchTextSignalSchema = matchAvailabilitySchema.extend({
  conflict: z.boolean(),
  left: z.string().min(1).nullable(),
  right: z.string().min(1).nullable()
});

export const storeMatchEvidenceSchema = z.object({
  address: matchTextSignalSchema,
  coordinate: matchAvailabilitySchema.extend({
    distanceMeters: z.number().nonnegative().nullable()
  }),
  phone: matchTextSignalSchema,
  name: matchAvailabilitySchema.extend({
    similarityBasisPoints: z.number().int().min(0).max(10000)
  })
});

export const storeMatchCandidateSchema = z.object({
  matchId: z.string().min(1),
  leftCandidateId: z.string().min(1),
  rightCandidateId: z.string().min(1),
  scoreBasisPoints: z.number().int().min(0).max(10000),
  status: z.enum(matchStatuses),
  matcherVersion: z.string().min(1),
  evidence: storeMatchEvidenceSchema
});

export const canonicalStoreCandidateSchema = z.object({
  storeId: z.string().min(1),
  displayName: z.string().min(1),
  normalizedName: z.string().min(1),
  normalizedBrandName: z.string().min(1),
  normalizedAddress: z.string().min(1),
  seoulDistrict: z.string().regex(/^[가-힣]+구$/),
  normalizedPhone: z.string().regex(/^\d{9,11}$/).nullable(),
  coordinates: normalizedCoordinatesSchema.nullable(),
  businessStatus: z.enum(["active", "inactive", "unknown"]),
  sourceCandidateIds: z.array(z.string().min(1)).min(1),
  sourceRecordIds: z.array(z.string().min(1)).min(1),
  sourceManagementNumbers: z.array(z.string().min(1)).min(1),
  mergeStatus: z.enum([
    "auto_merged",
    "distinct",
    "admin_review"
  ]),
  reviewReasonCodes: z.array(z.string().min(1))
});

export const deduplicationResultSchema = z.object({
  stores: z.array(canonicalStoreCandidateSchema),
  matches: z.array(storeMatchCandidateSchema),
  matcherVersion: z.string().min(1)
});

export const brandEligibilityEvidenceSchema = z
  .object({
    brandKey: z.string().min(1),
    displayName: z.string().min(1),
    sourceManagementNumbers: z.array(z.string().min(1)).min(1),
    ftcStatus: z.enum([
      "confirmed_franchise",
      "not_found",
      "unavailable",
      "stale"
    ]),
    ftcEvidenceRefs: z.array(z.string().min(1)),
    operatorEvidenceRefs: z.array(z.string().min(1)),
    independenceEvidenceRefs: z.array(z.string().min(1)),
    adminReviewStatus: z.enum([
      "approved",
      "pending",
      "rejected"
    ]),
    adminEvidenceRefs: z.array(z.string().min(1))
  })
  .superRefine((value, context) => {
    if (
      value.ftcStatus !== "unavailable" &&
      value.ftcEvidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["ftcEvidenceRefs"],
        message: "asserted FTC status requires an evidence reference"
      });
    }
    if (
      value.adminReviewStatus !== "pending" &&
      value.adminEvidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["adminEvidenceRefs"],
        message:
          "resolved admin review requires an evidence reference"
      });
    }
  });

export const eligibilityReasonSchema = z.object({
  code: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1))
});

export const eligibilityDecisionSchema = z.object({
  decisionId: z.string().min(1),
  bakeryId: z.string().min(1),
  storeIds: z.array(z.string().min(1)).min(1),
  classification: z.enum(eligibilityClassifications),
  status: z.enum(eligibilityDecisionStatuses),
  reasons: z.array(eligibilityReasonSchema).min(1),
  ruleVersion: z.string().min(1)
});

export const catalogPublishSummarySchema = z.object({
  publishId: z.string().min(1),
  snapshotId: z.string().min(1),
  status: z.literal("SUCCEEDED"),
  candidateCount: z.number().int().nonnegative(),
  publishedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  adminReviewCount: z.number().int().nonnegative(),
  normalizationVersion: z.string().min(1),
  matcherVersion: z.string().min(1),
  eligibilityVersion: z.string().min(1)
});

export type NormalizedCoordinates = z.output<
  typeof normalizedCoordinatesSchema
>;
export type NormalizedStoreCandidate = z.output<
  typeof normalizedStoreCandidateSchema
>;
export type StoreMatchEvidence = z.output<
  typeof storeMatchEvidenceSchema
>;
export type StoreMatchCandidate = z.output<
  typeof storeMatchCandidateSchema
>;
export type CanonicalStoreCandidate = z.output<
  typeof canonicalStoreCandidateSchema
>;
export type DeduplicationResult = z.output<
  typeof deduplicationResultSchema
>;
export type BrandEligibilityEvidence = z.output<
  typeof brandEligibilityEvidenceSchema
>;
export type EligibilityReason = z.output<
  typeof eligibilityReasonSchema
>;
export type EligibilityDecision = z.output<
  typeof eligibilityDecisionSchema
>;
export type CatalogPublishSummary = z.output<
  typeof catalogPublishSummarySchema
>;
