import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { stores } from "./stores.js";

const checksumCheck = (column: ReturnType<typeof text>) =>
  sql`length(${column}) = 64
    and ${column} = lower(${column})
    and ${column} not glob '*[^0-9a-f]*'`;

const isoLocalDateCheck = (column: ReturnType<typeof text>) =>
  sql`${column} glob
    '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

export const reviewPublishVersions = sqliteTable(
  "review_publish_version",
  {
    versionId: text("version_id").primaryKey(),
    sourceRunId: text("source_run_id").notNull(),
    sourceRunStatus: text("source_run_status").notNull(),
    sourceAsOfDate: text("source_as_of_date").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    documentCount: integer("document_count").notNull(),
    ftsDocumentCount: integer("fts_document_count").notNull(),
    corpusChecksum: text("corpus_checksum").notNull(),
    publishedAtMs: integer("published_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_publish_source_run_unique").on(
      table.sourceRunId
    ),
    uniqueIndex("review_publish_active_slot_unique").on(
      table.activeSlot
    ),
    index("review_publish_status_time_idx").on(
      table.status,
      table.publishedAtMs
    ),
    check(
      "review_publish_source_status_allowed",
      sql`${table.sourceRunStatus} in ('SUCCEEDED', 'PARTIAL')`
    ),
    check(
      "review_publish_status_allowed",
      sql`${table.status} in ('BUILDING', 'ACTIVE', 'SUPERSEDED')`
    ),
    check(
      "review_publish_active_slot_allowed",
      sql`${table.activeSlot} is null or ${table.activeSlot} = 1`
    ),
    check(
      "review_publish_source_date_format",
      isoLocalDateCheck(table.sourceAsOfDate)
    ),
    check(
      "review_publish_counts_valid",
      sql`${table.documentCount} >= 0
        and ${table.ftsDocumentCount} >= 0
        and ${table.documentCount} = ${table.ftsDocumentCount}`
    ),
    check(
      "review_publish_checksum_valid",
      checksumCheck(table.corpusChecksum)
    ),
    check(
      "review_publish_time_nonnegative",
      sql`${table.publishedAtMs} >= 0`
    )
  ]
);

export const reviewDocuments = sqliteTable(
  "review_document",
  {
    reviewId: text("review_id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    provider: text("provider").notNull(),
    body: text("body").notNull(),
    normalizedBody: text("normalized_body").notNull(),
    ratingBasisPoints: integer("rating_basis_points"),
    publishedDate: text("published_date").notNull(),
    collectedAtMs: integer("collected_at_ms").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    publishVersionId: text("publish_version_id")
      .notNull()
      .references(() => reviewPublishVersions.versionId, {
        onDelete: "restrict"
      })
  },
  (table) => [
    index("review_document_store_date_idx").on(
      table.storeId,
      table.publishedDate,
      table.reviewId
    ),
    index("review_document_publish_version_idx").on(
      table.publishVersionId
    ),
    index("review_document_source_run_idx").on(table.sourceRunId),
    check(
      "review_document_provider_allowed",
      sql`${table.provider} = 'KAKAO_MAP'`
    ),
    check(
      "review_document_body_nonempty",
      sql`length(trim(${table.body})) > 0`
    ),
    check(
      "review_document_normalized_body_nonempty",
      sql`length(trim(${table.normalizedBody})) > 0`
    ),
    check(
      "review_document_rating_range",
      sql`${table.ratingBasisPoints} is null
        or ${table.ratingBasisPoints} between 0 and 5000`
    ),
    check(
      "review_document_published_date_format",
      isoLocalDateCheck(table.publishedDate)
    ),
    check(
      "review_document_collected_time_nonnegative",
      sql`${table.collectedAtMs} >= 0`
    )
  ]
);

export const ftsIndexStates = sqliteTable(
  "fts_index_state",
  {
    stateId: text("state_id").primaryKey(),
    indexVersion: text("index_version").notNull(),
    publishVersionId: text("publish_version_id")
      .notNull()
      .references(() => reviewPublishVersions.versionId, {
        onDelete: "restrict"
      }),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    documentCount: integer("document_count").notNull(),
    corpusChecksum: text("corpus_checksum").notNull(),
    builtAtMs: integer("built_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("fts_index_publish_version_unique").on(
      table.publishVersionId
    ),
    uniqueIndex("fts_index_active_slot_unique").on(table.activeSlot),
    index("fts_index_status_time_idx").on(
      table.status,
      table.builtAtMs
    ),
    check(
      "fts_index_version_allowed",
      sql`${table.indexVersion} = 'review-fts-unicode61-v1'`
    ),
    check(
      "fts_index_status_allowed",
      sql`${table.status} in ('ACTIVE', 'SUPERSEDED')`
    ),
    check(
      "fts_index_active_slot_allowed",
      sql`${table.activeSlot} is null or ${table.activeSlot} = 1`
    ),
    check(
      "fts_index_document_count_nonnegative",
      sql`${table.documentCount} >= 0`
    ),
    check(
      "fts_index_checksum_valid",
      checksumCheck(table.corpusChecksum)
    ),
    check(
      "fts_index_time_nonnegative",
      sql`${table.builtAtMs} >= 0`
    )
  ]
);
