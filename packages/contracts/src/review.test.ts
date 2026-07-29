import { describe, expect, it } from "vitest";
import {
  kakaoDiscoverySummarySchema,
  reviewCollectionSummarySchema
} from "./review.js";

describe("Feature 4 contracts", () => {
  it("accepts non-sensitive summaries", () => {
    expect(
      kakaoDiscoverySummarySchema.parse({
        runId: "discovery_1",
        status: "COMPLETE",
        observedCount: 10,
        matchedEligibleCount: 4,
        matchedExcludedCount: 3,
        unmatchedCount: 2,
        ambiguousCount: 1
      })
    ).toMatchObject({ status: "COMPLETE", observedCount: 10 });

    expect(
      reviewCollectionSummarySchema.parse({
        runId: "reviews_1",
        status: "PAUSED_BUDGET",
        storeCount: 3,
        initialBackfillStoreCount: 1,
        incrementalStoreCount: 2,
        backfillFallbackStoreCount: 0,
        collectedCount: 25,
        duplicateCount: 4,
        rejectedPiiCount: 1,
        failedStoreCount: 0
      })
    ).toMatchObject({
      status: "PAUSED_BUDGET",
      collectedCount: 25
    });
  });

  it("rejects negative counts and unknown states", () => {
    expect(() =>
      kakaoDiscoverySummarySchema.parse({
        runId: "x",
        status: "DONE",
        observedCount: -1,
        matchedEligibleCount: 0,
        matchedExcludedCount: 0,
        unmatchedCount: 0,
        ambiguousCount: 0
      })
    ).toThrow();
  });

  it("rejects superseded states and invalid review mode counts", () => {
    const validSummary = {
      runId: "reviews_1",
      status: "SUCCEEDED",
      storeCount: 3,
      initialBackfillStoreCount: 1,
      incrementalStoreCount: 1,
      backfillFallbackStoreCount: 1,
      collectedCount: 25,
      duplicateCount: 4,
      rejectedPiiCount: 1,
      failedStoreCount: 0
    };

    expect(() =>
      reviewCollectionSummarySchema.parse({
        ...validSummary,
        status: "PAUSED"
      })
    ).toThrow();
    expect(() =>
      reviewCollectionSummarySchema.parse({
        ...validSummary,
        incrementalStoreCount: -1
      })
    ).toThrow();
    expect(() =>
      reviewCollectionSummarySchema.parse({
        ...validSummary,
        backfillFallbackStoreCount: 0
      })
    ).toThrow();
  });
});
