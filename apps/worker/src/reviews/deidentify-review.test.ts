import { describe, expect, it } from "vitest";
import { deidentifyReview } from "./deidentify-review.js";

describe("review deidentification", () => {
  it.each([
    ["문의는 test@example.com", "문의는 [redacted]"],
    ["전화 010-1234-5678", "전화 [redacted]"],
    ["https://example.com 방문", "[redacted] 방문"],
    ["인스타 @bakery_user", "인스타 [redacted]"],
    ["주문번호 12345678901234", "주문번호 [redacted]"]
  ])("redacts direct identifiers", (input, expected) => {
    expect(deidentifyReview(input)).toEqual({
      accepted: true,
      text: expected
    });
  });

  it.each([
    "직원 김민수님이 제 병원 진단을 이야기했어요",
    "계좌번호와 카드번호가 그대로 적혀 있어요",
    "사장 박지영씨와 고소 분쟁 중입니다"
  ])("rejects sensitive or unsafe identity context", (input) => {
    expect(deidentifyReview(input)).toEqual({
      accepted: false,
      reasonCode: "REJECTED_PII"
    });
  });

  it("normalizes Unicode and rejects an empty redacted body", () => {
    expect(deidentifyReview("  빵이   맛있어요  ")).toEqual({
      accepted: true,
      text: "빵이 맛있어요"
    });
    expect(deidentifyReview("test@example.com")).toEqual({
      accepted: false,
      reasonCode: "REJECTED_EMPTY"
    });
  });
});
