import { describe, expect, it } from "vitest";
import {
  createReviewId,
  fingerprintReview,
  normalizeNickname
} from "./fingerprint-review.js";

const hmacKey = Buffer.alloc(32, 7);

describe("review fingerprint", () => {
  it("normalizes transient nicknames without storing them in output", () => {
    expect(normalizeNickname("  Ｂaker   USER  ")).toBe(
      "baker user"
    );
  });

  it("is deterministic, 32 bytes and scoped to one store", () => {
    const input = {
      provider: "KAKAO_MAP" as const,
      storeId: "store_one",
      normalizedNickname: "fixture user",
      publishedDate: "2026-07-01",
      normalizedDeidentifiedText: "빵이 맛있어요"
    };

    const first = fingerprintReview(input, hmacKey);
    const second = fingerprintReview(input, hmacKey);
    const otherStore = fingerprintReview(
      { ...input, storeId: "store_two" },
      hmacKey
    );

    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first).not.toEqual(otherStore);
    expect(createReviewId(input.storeId, first)).toMatch(
      /^review_[a-f0-9]{24}$/
    );
  });
});
