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
  "PAUSED_OPERATOR",
  "PAUSED_BUDGET",
  "SUCCEEDED",
  "PARTIAL",
  "STOPPED_POLICY",
  "STOPPED_ACCESS",
  "FAILED_FINAL"
]);

export const reviewStoreCollectionModeSchema = z.enum([
  "INITIAL_BACKFILL",
  "INCREMENTAL",
  "BACKFILL_FALLBACK"
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

export const reviewCollectionSummarySchema = z
  .object({
    runId: z.string().min(1),
    status: reviewCollectionRunStatusSchema,
    storeCount: countSchema,
    initialBackfillStoreCount: countSchema,
    incrementalStoreCount: countSchema,
    backfillFallbackStoreCount: countSchema,
    collectedCount: countSchema,
    duplicateCount: countSchema,
    rejectedPiiCount: countSchema,
    failedStoreCount: countSchema
  })
  .refine(
    (summary) =>
      summary.initialBackfillStoreCount +
        summary.incrementalStoreCount +
        summary.backfillFallbackStoreCount ===
      summary.storeCount,
    {
      message: "review collection mode counts must equal storeCount",
      path: ["storeCount"]
    }
  );

export type KakaoDiscoverySummary = z.infer<
  typeof kakaoDiscoverySummarySchema
>;
export type ReviewCollectionSummary = z.infer<
  typeof reviewCollectionSummarySchema
>;
