import { z } from "zod";

const countSchema = z.number().int().nonnegative();

export const kakaoDiscoveryRunStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "COMPLETE",
  "PARTIAL",
  "STOPPED_POLICY",
  "STOPPED_ACCESS",
  "FAILED_FINAL"
]);

export const kakaoPlaceObservationStatusSchema = z.enum([
  "MATCHED_ELIGIBLE",
  "MATCHED_EXCLUDED",
  "UNMATCHED",
  "AMBIGUOUS",
  "CATEGORY_REJECTED"
]);

export const reviewCollectionRunStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "PAUSED",
  "SUCCEEDED",
  "STOPPED_POLICY",
  "STOPPED_ACCESS",
  "FAILED_FINAL"
]);

export const kakaoDiscoverySummarySchema = z.object({
  runId: z.string().min(1),
  status: kakaoDiscoveryRunStatusSchema,
  observedCount: countSchema,
  matchedEligibleCount: countSchema,
  matchedExcludedCount: countSchema,
  unmatchedCount: countSchema,
  ambiguousCount: countSchema
});

export const reviewCollectionSummarySchema = z.object({
  runId: z.string().min(1),
  status: reviewCollectionRunStatusSchema,
  storeCount: countSchema,
  collectedCount: countSchema,
  duplicateCount: countSchema,
  rejectedPiiCount: countSchema,
  failedStoreCount: countSchema
});

export type KakaoDiscoverySummary = z.infer<
  typeof kakaoDiscoverySummarySchema
>;
export type ReviewCollectionSummary = z.infer<
  typeof reviewCollectionSummarySchema
>;
