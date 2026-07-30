import type { REVIEW_FTS_INDEX_VERSION } from "@bread-map/app-db";

export interface ReviewSearchInput {
  text: string;
  storeIds?: readonly string[];
  limit?: number;
}

export interface StoreReviewListInput {
  storeId: string;
  limit?: number;
}

export interface ReviewSearchHit {
  reviewId: string;
  storeId: string;
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  snippet: string;
}

export interface ReviewIndexState {
  indexVersion: typeof REVIEW_FTS_INDEX_VERSION;
  publishVersionId: string;
  documentCount: number;
  corpusChecksum: string;
  builtAtMs: number;
}

export type ReviewSearchResult =
  | {
      status: "AVAILABLE";
      hits: readonly ReviewSearchHit[];
    }
  | {
      status: "UNAVAILABLE";
      code: "FTS_UNAVAILABLE";
      hits: readonly [];
    };

export interface ReviewRepository {
  searchReviews(input: ReviewSearchInput): ReviewSearchResult;
  listStoreReviews(
    input: StoreReviewListInput
  ): readonly ReviewSearchHit[];
  getActiveIndexState(): ReviewIndexState | null;
}
