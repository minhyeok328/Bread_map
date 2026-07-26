export type DeidentifiedReview =
  | { accepted: true; text: string }
  | {
      accepted: false;
      reasonCode: "REJECTED_PII" | "REJECTED_EMPTY";
    };

const namedPersonPattern =
  /(?:사장|직원|알바|손님)\s*[가-힣]{2,4}(?:씨|님)/u;
const sensitiveContextPattern =
  /주민등록|계좌번호|카드번호|병원|진단|약물|성폭력|고소|분쟁|신고/u;

const identifierPatterns = [
  /(?:https?:\/\/|www\.)[^\s]+/giu,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
  /\b\d(?:[\s-]?\d){11,}\b/gu,
  /(?:\+?82[-\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5])[-\s]?\d{3,4}[-\s]?\d{4}/gu,
  /\+\d[\d\s().-]{7,}\d/gu,
  /(?<![\p{L}\p{N}])@[A-Za-z0-9._]{2,}/gu
] as const;

function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function deidentifyReview(body: string): DeidentifiedReview {
  const normalized = normalizeWhitespace(body);
  if (normalized === "") {
    return { accepted: false, reasonCode: "REJECTED_EMPTY" };
  }
  if (
    namedPersonPattern.test(normalized) ||
    sensitiveContextPattern.test(normalized)
  ) {
    return { accepted: false, reasonCode: "REJECTED_PII" };
  }

  let redacted = normalized;
  for (const pattern of identifierPatterns) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  redacted = normalizeWhitespace(redacted);
  const nonRedactedContent = redacted
    .replace(/\[redacted\]/gu, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
  if (nonRedactedContent === "") {
    return { accepted: false, reasonCode: "REJECTED_EMPTY" };
  }
  return { accepted: true, text: redacted };
}
