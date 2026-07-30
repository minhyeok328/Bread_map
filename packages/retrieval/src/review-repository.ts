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

export interface ReviewEvidenceSearchInput {
  terms: readonly string[];
  storeIds: readonly string[];
}

export interface ReviewEvidenceHit {
  reviewId: string;
  storeId: string;
  publishedDate: string;
  snippet: string;
  internalRank: number;
  termPriority: number;
}

export type ReviewEvidenceSearchResult =
  | {
      status: "AVAILABLE";
      hits: readonly ReviewEvidenceHit[];
    }
  | {
      status: "UNAVAILABLE";
      code: "FTS_UNAVAILABLE";
      hits: readonly [];
    };

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
  searchStoreEvidence(
    input: ReviewEvidenceSearchInput
  ): ReviewEvidenceSearchResult;
}
