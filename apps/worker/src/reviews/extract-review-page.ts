import type { ReviewDomContract } from "./review-dom-contract.js";

export interface ReviewLocatorLike {
  count(): Promise<number>;
  all(): Promise<ReviewLocatorLike[]>;
  locator(selector: string): ReviewLocatorLike;
  textContent(): Promise<string | null>;
}

export interface ReviewPageLike {
  locator(selector: string): ReviewLocatorLike;
}

export interface MemoryOnlyReview {
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  nickname: string;
}

export type ReviewPageResult =
  | {
      status: "OK";
      reviews: MemoryOnlyReview[];
      boundary: "MORE" | "CUTOFF" | "DOM_END";
      totalItemCount: number;
      newestPublishedDate: string | null;
      oldestPublishedDate: string | null;
      hasNext: boolean;
    }
  | {
      status: "STOP_PROVIDER";
      reasonCode:
        | "LOGIN_REQUIRED"
        | "CAPTCHA"
        | "ACCESS_DENIED"
        | "RATE_LIMITED"
        | "EXTERNAL_REDIRECT"
        | "DOM_CONTRACT_CHANGED";
    };

export type ReviewProviderStopReason = Extract<
  ReviewPageResult,
  { status: "STOP_PROVIDER" }
>["reasonCode"];

export interface ExtractReviewPageOptions {
  asOfDate: string;
  startIndex: number;
  previousOldestPublishedDate: string | null;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

function parseIsoDate(value: string): number | null {
  if (!isoDatePattern.test(value)) {
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function twelveMonthCutoff(asOfDate: string): number | null {
  const timestamp = parseIsoDate(asOfDate);
  if (timestamp === null) {
    return null;
  }
  const asOf = new Date(timestamp);
  const cutoffYear = asOf.getUTCFullYear() - 1;
  const cutoffMonth = asOf.getUTCMonth();
  const lastCutoffDay = new Date(
    Date.UTC(cutoffYear, cutoffMonth + 1, 0)
  ).getUTCDate();
  return Date.UTC(
    cutoffYear,
    cutoffMonth,
    Math.min(asOf.getUTCDate(), lastCutoffDay)
  );
}

async function stopReason(
  page: ReviewPageLike,
  contract: ReviewDomContract
): Promise<ReviewPageResult | null> {
  if ((await page.locator(contract.loginWall).count()) > 0) {
    return {
      status: "STOP_PROVIDER",
      reasonCode: "LOGIN_REQUIRED"
    };
  }
  if ((await page.locator(contract.captcha).count()) > 0) {
    return { status: "STOP_PROVIDER", reasonCode: "CAPTCHA" };
  }
  if ((await page.locator(contract.accessDenial).count()) > 0) {
    return {
      status: "STOP_PROVIDER",
      reasonCode: "ACCESS_DENIED"
    };
  }
  return null;
}

async function oneText(
  item: ReviewLocatorLike,
  selector: string,
  allowMissing: boolean
): Promise<
  | { valid: true; value: string | null }
  | { valid: false }
> {
  const locator = item.locator(selector);
  const count = await locator.count();
  if (count === 0 && allowMissing) {
    return { valid: true, value: null };
  }
  if (count !== 1) {
    return { valid: false };
  }
  const value = (await locator.textContent())?.normalize("NFKC").trim();
  if (value === undefined) {
    return { valid: false };
  }
  return { valid: true, value };
}

function parseRating(value: string | null):
  | { valid: true; value: number | null }
  | { valid: false } {
  if (value === null || value === "") {
    return { valid: true, value: null };
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    return { valid: false };
  }
  return {
    valid: true,
    value: Math.round(rating * 1000)
  };
}

function domChanged(): ReviewPageResult {
  return {
    status: "STOP_PROVIDER",
    reasonCode: "DOM_CONTRACT_CHANGED"
  };
}

export async function extractReviewPage(
  page: ReviewPageLike,
  contract: ReviewDomContract,
  options: ExtractReviewPageOptions
): Promise<ReviewPageResult> {
  const providerStop = await stopReason(page, contract);
  if (providerStop !== null) {
    return providerStop;
  }
  const cutoff = twelveMonthCutoff(options.asOfDate);
  const asOfTimestamp = parseIsoDate(options.asOfDate);
  const previousOldestTimestamp =
    options.previousOldestPublishedDate === null
      ? null
      : parseIsoDate(options.previousOldestPublishedDate);
  if (
    cutoff === null ||
    asOfTimestamp === null ||
    !Number.isInteger(options.startIndex) ||
    options.startIndex < 0 ||
    (options.previousOldestPublishedDate !== null &&
      previousOldestTimestamp === null) ||
    (contract.paginationMode === "replace" &&
      options.startIndex !== 0)
  ) {
    return domChanged();
  }

  const itemCollection = page.locator(contract.reviewItem);
  const totalItemCount = await itemCollection.count();
  if (options.startIndex > totalItemCount) {
    return domChanged();
  }
  const items = await itemCollection.all();
  if (items.length !== totalItemCount) {
    return domChanged();
  }
  const sliceStart =
    contract.paginationMode === "append" ? options.startIndex : 0;
  const newItems = items.slice(sliceStart);
  const hasNextButton =
    (await page.locator(contract.nextButton).count()) > 0;
  if (newItems.length === 0) {
    if (hasNextButton) {
      return domChanged();
    }
    return {
      status: "OK",
      reviews: [],
      boundary: "DOM_END",
      totalItemCount,
      newestPublishedDate: null,
      oldestPublishedDate: null,
      hasNext: false
    };
  }

  const reviews: MemoryOnlyReview[] = [];
  let previousPublishedAt = previousOldestTimestamp;
  let newestPublishedDate: string | null = null;
  let oldestPublishedDate: string | null = null;

  for (const item of newItems) {
    const [body, rating, publishedDate, nickname] =
      await Promise.all([
        oneText(item, contract.body, false),
        oneText(item, contract.rating, true),
        oneText(item, contract.publishedDate, false),
        oneText(item, contract.nickname, false)
      ]);
    if (
      !body.valid ||
      !rating.valid ||
      !publishedDate.valid ||
      !nickname.valid ||
      body.value === null ||
      body.value === "" ||
      publishedDate.value === null ||
      nickname.value === null ||
      nickname.value === ""
    ) {
      return domChanged();
    }
    const publishedAt = parseIsoDate(publishedDate.value);
    const parsedRating = parseRating(rating.value);
    if (
      publishedAt === null ||
      publishedAt > asOfTimestamp ||
      !parsedRating.valid ||
      (previousPublishedAt !== null &&
        publishedAt > previousPublishedAt)
    ) {
      return domChanged();
    }
    previousPublishedAt = publishedAt;
    if (publishedAt < cutoff) {
      return {
        status: "OK",
        reviews,
        boundary: "CUTOFF",
        totalItemCount,
        newestPublishedDate,
        oldestPublishedDate,
        hasNext: false
      };
    }
    newestPublishedDate ??= publishedDate.value;
    oldestPublishedDate = publishedDate.value;
    reviews.push({
      body: body.value,
      ratingBasisPoints: parsedRating.value,
      publishedDate: publishedDate.value,
      nickname: nickname.value
    });
  }

  const boundary = hasNextButton ? "MORE" : "DOM_END";
  return {
    status: "OK",
    reviews,
    boundary,
    totalItemCount,
    newestPublishedDate,
    oldestPublishedDate,
    hasNext: boundary === "MORE"
  };
}
