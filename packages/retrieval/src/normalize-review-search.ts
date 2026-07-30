export type ReviewQueryValidationErrorCode =
  | "REVIEW_QUERY_EMPTY"
  | "REVIEW_QUERY_TOO_LONG"
  | "REVIEW_QUERY_LIMIT_INVALID"
  | "REVIEW_QUERY_STORE_IDS_INVALID"
  | "REVIEW_STORE_ID_INVALID";

export class ReviewQueryValidationError extends Error {
  readonly code: ReviewQueryValidationErrorCode;

  constructor(code: ReviewQueryValidationErrorCode) {
    super(code);
    this.name = "ReviewQueryValidationError";
    this.code = code;
  }
}

export function normalizeReviewText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildReviewFtsQuery(value: string): string {
  if (value.length > 200) {
    throw new ReviewQueryValidationError("REVIEW_QUERY_TOO_LONG");
  }
  const normalized = normalizeReviewText(value);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    throw new ReviewQueryValidationError("REVIEW_QUERY_EMPTY");
  }
  return tokens
    .map((token) => `"${token.replace(/"/gu, "\"\"")}"`)
    .join(" AND ");
}

export function parseReviewLimit(
  value: number | undefined,
  fallback: number
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ReviewQueryValidationError(
      "REVIEW_QUERY_LIMIT_INVALID"
    );
  }
  return limit;
}

export function parseStoreId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ReviewQueryValidationError("REVIEW_STORE_ID_INVALID");
  }
  return normalized;
}

export function parseStoreIds(
  values: readonly string[] | undefined
): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (values.length < 1 || values.length > 100) {
    throw new ReviewQueryValidationError(
      "REVIEW_QUERY_STORE_IDS_INVALID"
    );
  }
  return [...new Set(values.map(parseStoreId))];
}
