import {
  REVIEW_FTS_INDEX_VERSION,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  buildReviewFtsQuery,
  parseReviewLimit,
  parseStoreId,
  parseStoreIds
} from "./normalize-review-search.js";
import type {
  ReviewIndexState,
  ReviewRepository,
  ReviewSearchHit,
  ReviewSearchInput,
  ReviewSearchResult,
  StoreReviewListInput
} from "./review-repository.js";

interface CountRow {
  documentCount: number;
  ftsDocumentCount: number;
  identityMismatchCount: number;
  nonPublicDocumentCount: number;
}

function isSqliteExecutionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_")
  );
}

function unavailable(): ReviewSearchResult {
  return {
    status: "UNAVAILABLE",
    code: "FTS_UNAVAILABLE",
    hits: []
  };
}

export class SqliteReviewRepository implements ReviewRepository {
  readonly #appDatabase: AppDatabaseHandle;

  constructor(appDatabase: AppDatabaseHandle) {
    this.#appDatabase = appDatabase;
  }

  getActiveIndexState(): ReviewIndexState | null {
    const row = this.#appDatabase.client
      .prepare(
        `SELECT
           state.index_version AS indexVersion,
           state.publish_version_id AS publishVersionId,
           state.document_count AS documentCount,
           state.corpus_checksum AS corpusChecksum,
           state.built_at_ms AS builtAtMs
         FROM fts_index_state AS state
         JOIN review_publish_version AS publish
           ON publish.version_id = state.publish_version_id
        WHERE state.status = 'ACTIVE'
          AND state.active_slot = 1
          AND publish.status = 'ACTIVE'
          AND publish.active_slot = 1
          AND publish.document_count = state.document_count
          AND publish.fts_document_count = state.document_count
          AND publish.corpus_checksum = state.corpus_checksum`
      )
      .get() as ReviewIndexState | undefined;
    if (
      row === undefined ||
      row.indexVersion !== REVIEW_FTS_INDEX_VERSION
    ) {
      return null;
    }
    return row;
  }

  #hasConsistentActiveIndex(): boolean {
    const state = this.getActiveIndexState();
    if (state === null) {
      return false;
    }
    const counts = this.#appDatabase.client
      .prepare(
        `SELECT
           (SELECT count(*) FROM review_document)
             AS documentCount,
           (SELECT count(*) FROM review_fts)
             AS ftsDocumentCount,
           (
             SELECT count(*)
               FROM review_fts AS fts
               LEFT JOIN review_document AS document
                 ON document.rowid = fts.rowid
              WHERE document.rowid IS NULL
                 OR fts.review_id != document.review_id
                 OR fts.store_id != document.store_id
                 OR fts.normalized_body != document.normalized_body
           ) AS identityMismatchCount,
           (
             SELECT count(*)
               FROM review_document AS document
               LEFT JOIN store
                 ON store.store_id = document.store_id
              WHERE store.store_id IS NULL
                 OR store.catalog_status != 'published'
                 OR store.business_status != 'active'
           ) AS nonPublicDocumentCount`
      )
      .get() as CountRow;
    return (
      counts.documentCount === state.documentCount &&
      counts.ftsDocumentCount === state.documentCount &&
      counts.identityMismatchCount === 0 &&
      counts.nonPublicDocumentCount === 0
    );
  }

  searchReviews(input: ReviewSearchInput): ReviewSearchResult {
    const ftsQuery = buildReviewFtsQuery(input.text);
    const storeIds = parseStoreIds(input.storeIds);
    const limit = parseReviewLimit(input.limit, 20);

    try {
      if (!this.#hasConsistentActiveIndex()) {
        return unavailable();
      }
      const storePredicate =
        storeIds === undefined
          ? ""
          : `AND document.store_id IN (${storeIds
              .map(() => "?")
              .join(", ")})`;
      const rows = this.#appDatabase.client
        .prepare(
          `SELECT
             document.review_id AS reviewId,
             document.store_id AS storeId,
             document.body,
             document.rating_basis_points AS ratingBasisPoints,
             document.published_date AS publishedDate,
             snippet(
               review_fts, 2, '[', ']', ' … ', 16
             ) AS snippet
           FROM review_fts
           JOIN review_document AS document
             ON document.rowid = review_fts.rowid
           JOIN review_publish_version AS publish
             ON publish.version_id = document.publish_version_id
           JOIN store
             ON store.store_id = document.store_id
          WHERE review_fts MATCH ?
            AND publish.status = 'ACTIVE'
            AND publish.active_slot = 1
            AND store.catalog_status = 'published'
            AND store.business_status = 'active'
            ${storePredicate}
          ORDER BY
            bm25(review_fts) ASC,
            document.published_date DESC,
            document.review_id ASC
          LIMIT ?`
        )
        .all(ftsQuery, ...(storeIds ?? []), limit) as ReviewSearchHit[];
      return {
        status: "AVAILABLE",
        hits: rows
      };
    } catch (error) {
      if (isSqliteExecutionError(error)) {
        return unavailable();
      }
      throw error;
    }
  }

  listStoreReviews(
    input: StoreReviewListInput
  ): readonly ReviewSearchHit[] {
    const storeId = parseStoreId(input.storeId);
    const limit = parseReviewLimit(input.limit, 20);
    return this.#appDatabase.client
      .prepare(
        `SELECT
           document.review_id AS reviewId,
           document.store_id AS storeId,
           document.body,
           document.rating_basis_points AS ratingBasisPoints,
           document.published_date AS publishedDate,
           document.body AS snippet
         FROM review_document AS document
         JOIN review_publish_version AS publish
           ON publish.version_id = document.publish_version_id
         JOIN store
           ON store.store_id = document.store_id
        WHERE document.store_id = ?
          AND publish.status = 'ACTIVE'
          AND publish.active_slot = 1
          AND store.catalog_status = 'published'
          AND store.business_status = 'active'
        ORDER BY
          document.published_date DESC,
          document.review_id ASC
        LIMIT ?`
      )
      .all(storeId, limit) as ReviewSearchHit[];
  }
}

export function createSqliteReviewRepository(
  appDatabase: AppDatabaseHandle
): ReviewRepository {
  return new SqliteReviewRepository(appDatabase);
}
