import { createHash, createHmac } from "node:crypto";

export interface FingerprintReviewInput {
  provider: "KAKAO_MAP";
  storeId: string;
  normalizedNickname: string;
  publishedDate: string;
  normalizedDeidentifiedText: string;
}

export class ReviewFingerprintError extends Error {
  readonly code = "REVIEW_FINGERPRINT_INVALID";

  constructor() {
    super("REVIEW_FINGERPRINT_INVALID");
    this.name = "ReviewFingerprintError";
  }
}

export function normalizeNickname(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ko-KR");
}

export function fingerprintReview(
  input: FingerprintReviewInput,
  hmacKey: Buffer
): Buffer {
  if (
    hmacKey.length !== 32 ||
    input.provider !== "KAKAO_MAP" ||
    input.storeId.trim() === "" ||
    input.normalizedNickname.trim() === "" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(input.publishedDate) ||
    input.normalizedDeidentifiedText.trim() === ""
  ) {
    throw new ReviewFingerprintError();
  }
  const canonical = JSON.stringify([
    input.provider,
    input.storeId,
    input.normalizedNickname,
    input.publishedDate,
    input.normalizedDeidentifiedText
  ]);
  return createHmac("sha256", hmacKey).update(canonical).digest();
}

export function createReviewId(
  storeId: string,
  fingerprint: Buffer
): string {
  if (storeId.trim() === "" || fingerprint.length !== 32) {
    throw new ReviewFingerprintError();
  }
  return `review_${createHash("sha256")
    .update(storeId)
    .update(fingerprint)
    .digest("hex")
    .slice(0, 24)}`;
}
