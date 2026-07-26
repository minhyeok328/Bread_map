import { describe, expect, it } from "vitest";
import {
  isApprovedBakeryTag,
  normalizeKakaoCategoryTag
} from "./normalize-kakao-category.js";

describe("Kakao category normalization", () => {
  it.each([
    ["음식점 > 간식 > 제과,베이커리", "제과,베이커리"],
    ["음식점>간식>제과, 베이커리", "제과,베이커리"],
    ["카페 > 디저트카페", "디저트카페"],
    ["음식점 > 간식 > 제과， 베이커리", "제과,베이커리"]
  ])("normalizes the last category segment", (input, expected) => {
    expect(normalizeKakaoCategoryTag(input)).toBe(expected);
  });

  it("accepts only the exact approved bakery tag", () => {
    expect(isApprovedBakeryTag("제과,베이커리")).toBe(true);
    expect(isApprovedBakeryTag("제과, 베이커리")).toBe(true);
    expect(isApprovedBakeryTag("제과,베이커리,카페")).toBe(false);
    expect(isApprovedBakeryTag("베이커리")).toBe(false);
  });
});
