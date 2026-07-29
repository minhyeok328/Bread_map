import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const reviewSeenFingerprints = sqliteTable(
  "review_seen_fingerprint",
  {
    seenId: text("seen_id").primaryKey(),
    storeId: text("store_id").notNull(),
    provider: text("provider").notNull(),
    fingerprintKeyVersion: text(
      "fingerprint_key_version"
    ).notNull(),
    fingerprint: blob("fingerprint", { mode: "buffer" }).notNull(),
    publishedDate: text("published_date").notNull(),
    firstSeenAtMs: integer("first_seen_at_ms").notNull(),
    lastSeenAtMs: integer("last_seen_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex(
      "review_seen_store_provider_key_fingerprint_unique"
    ).on(
      table.storeId,
      table.provider,
      table.fingerprintKeyVersion,
      table.fingerprint
    ),
    index("review_seen_expiry_idx").on(table.expiresAtMs),
    check(
      "review_seen_provider_allowed",
      sql`${table.provider} = 'KAKAO_MAP'`
    ),
    check(
      "review_seen_fingerprint_length",
      sql`length(${table.fingerprint}) = 32`
    ),
    check(
      "review_seen_date_format",
      sql`${table.publishedDate} glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      "review_seen_times_ordered",
      sql`${table.firstSeenAtMs} <= ${table.lastSeenAtMs}
        and ${table.lastSeenAtMs} < ${table.expiresAtMs}`
    ),
    check(
      "review_seen_retention_max",
      sql`${table.expiresAtMs}
        <= ${table.lastSeenAtMs} + 34560000000`
    )
  ]
);

export const reviewStoreSyncStates = sqliteTable(
  "review_store_sync_state",
  {
    syncStateId: text("sync_state_id").primaryKey(),
    storeId: text("store_id").notNull(),
    provider: text("provider").notNull(),
    anchorFingerprint: blob("anchor_fingerprint", {
      mode: "buffer"
    }),
    anchorFingerprintKeyVersion: text(
      "anchor_fingerprint_key_version"
    ),
    anchorPublishedDate: text("anchor_published_date"),
    lastSuccessfulMode: text("last_successful_mode").notNull(),
    lastSuccessfulRunId: text("last_successful_run_id").notNull(),
    lastSuccessfulAsOfDate: text(
      "last_successful_as_of_date"
    ).notNull(),
    completedAtMs: integer("completed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_store_sync_store_provider_unique").on(
      table.storeId,
      table.provider
    ),
    index("review_store_sync_expiry_idx").on(table.expiresAtMs),
    check(
      "review_store_sync_provider_allowed",
      sql`${table.provider} = 'KAKAO_MAP'`
    ),
    check(
      "review_store_sync_mode_allowed",
      sql`${table.lastSuccessfulMode} in (
        'INITIAL_BACKFILL', 'INCREMENTAL', 'BACKFILL_FALLBACK'
      )`
    ),
    check(
      "review_store_sync_as_of_date_format",
      sql`${table.lastSuccessfulAsOfDate} glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      "review_store_sync_anchor_complete",
      sql`(
        ${table.anchorFingerprint} is null
        and ${table.anchorFingerprintKeyVersion} is null
        and ${table.anchorPublishedDate} is null
      ) or (
        ${table.anchorFingerprint} is not null
        and ${table.anchorFingerprintKeyVersion} is not null
        and ${table.anchorPublishedDate} is not null
      )`
    ),
    check(
      "review_store_sync_anchor_fingerprint_length",
      sql`${table.anchorFingerprint} is null
        or length(${table.anchorFingerprint}) = 32`
    ),
    check(
      "review_store_sync_anchor_date_format",
      sql`${table.anchorPublishedDate} is null
        or ${table.anchorPublishedDate} glob
          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      "review_store_sync_retention_positive",
      sql`${table.completedAtMs} < ${table.expiresAtMs}`
    ),
    check(
      "review_store_sync_retention_max",
      sql`${table.expiresAtMs}
        <= ${table.completedAtMs} + 34560000000`
    )
  ]
);
