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
        status: "SUCCEEDED",
        storeCount: 4,
        collectedCount: 20,
        duplicateCount: 2,
        rejectedPiiCount: 1,
        failedStoreCount: 0
      })
    ).toMatchObject({ collectedCount: 20 });
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
});
