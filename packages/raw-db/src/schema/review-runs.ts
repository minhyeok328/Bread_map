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
import {
  kakaoDiscoveryRuns,
  kakaoPlaceObservations
} from "./kakao-discovery.js";

export const reviewCollectionRuns = sqliteTable(
  "review_collection_run",
  {
    runId: text("run_id").primaryKey(),
    discoveryRunId: text("discovery_run_id")
      .notNull()
      .references(() => kakaoDiscoveryRuns.runId, {
        onDelete: "restrict"
      }),
    catalogSnapshotId: text("catalog_snapshot_id").notNull(),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    selectorContractVersion: text(
      "selector_contract_version"
    ).notNull(),
    asOfDate: text("as_of_date").notNull(),
    fingerprintKeyVersion: text(
      "fingerprint_key_version"
    ).notNull(),
    runBudgetMs: integer("run_budget_ms").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    storeCount: integer("store_count").notNull(),
    initialBackfillStoreCount: integer(
      "initial_backfill_store_count"
    ).notNull(),
    incrementalStoreCount: integer(
      "incremental_store_count"
    ).notNull(),
    backfillFallbackStoreCount: integer(
      "backfill_fallback_store_count"
    ).notNull(),
    collectedCount: integer("collected_count").notNull(),
    duplicateCount: integer("duplicate_count").notNull(),
    rejectedPiiCount: integer("rejected_pii_count").notNull(),
    failedStoreCount: integer("failed_store_count").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_collection_active_slot_unique").on(
      table.activeSlot
    ),
    index("review_collection_discovery_idx").on(
      table.discoveryRunId
    ),
    index("review_collection_status_started_idx").on(
      table.status,
      table.startedAtMs
    ),
    check(
      "review_collection_status_allowed",
      sql`${table.status} in (
        'READY', 'RUNNING', 'PAUSED_OPERATOR', 'PAUSED_BUDGET',
        'SUCCEEDED', 'PARTIAL',
        'STOPPED_POLICY', 'STOPPED_ACCESS', 'FAILED_FINAL'
      )`
    ),
    check(
      "review_collection_active_slot_allowed",
      sql`${table.activeSlot} is null or ${table.activeSlot} = 1`
    ),
    check(
      "review_collection_as_of_date_format",
      sql`${table.asOfDate} glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      "review_collection_budget_allowed",
      sql`${table.runBudgetMs} between 1 and 28800000`
    ),
    check(
      "review_collection_counts_nonnegative",
      sql`${table.storeCount} >= 0
        and ${table.initialBackfillStoreCount} >= 0
        and ${table.incrementalStoreCount} >= 0
        and ${table.backfillFallbackStoreCount} >= 0
        and ${table.collectedCount} >= 0
        and ${table.duplicateCount} >= 0
        and ${table.rejectedPiiCount} >= 0
        and ${table.failedStoreCount} >= 0`
    ),
    check(
      "review_collection_mode_counts_match_store_count",
      sql`${table.initialBackfillStoreCount}
          + ${table.incrementalStoreCount}
          + ${table.backfillFallbackStoreCount}
        = ${table.storeCount}`
    ),
    check(
      "review_collection_finished_after_start",
      sql`${table.finishedAtMs} is null
        or ${table.finishedAtMs} >= ${table.startedAtMs}`
    ),
    check(
      "review_collection_retention_positive",
      sql`${table.expiresAtMs} > ${table.startedAtMs}`
    )
  ]
);

export const reviewCheckpoints = sqliteTable(
  "review_checkpoint",
  {
    checkpointId: text("checkpoint_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reviewCollectionRuns.runId, {
        onDelete: "cascade"
      }),
    observationId: text("observation_id")
      .notNull()
      .references(() => kakaoPlaceObservations.observationId, {
        onDelete: "restrict"
      }),
    storeId: text("store_id").notNull(),
    pageNumber: integer("page_number").notNull(),
    pageCursor: text("page_cursor"),
    lastFingerprint: blob("last_fingerprint", {
      mode: "buffer"
    }),
    state: text("state").notNull(),
    committedAtMs: integer("committed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_checkpoint_run_store_page_unique").on(
      table.runId,
      table.storeId,
      table.pageNumber
    ),
    index("review_checkpoint_run_state_idx").on(
      table.runId,
      table.state
    ),
    check(
      "review_checkpoint_page_nonnegative",
      sql`${table.pageNumber} >= 0`
    ),
    check(
      "review_checkpoint_fingerprint_length",
      sql`${table.lastFingerprint} is null
        or length(${table.lastFingerprint}) = 32`
    ),
    check(
      "review_checkpoint_state_allowed",
      sql`${table.state} in (
        'PENDING', 'RUNNING', 'COMPLETE', 'NO_REVIEWS',
        'FAILED_STORE', 'STOPPED_PROVIDER'
      )`
    ),
    check(
      "review_checkpoint_retention_positive",
      sql`${table.expiresAtMs} > ${table.committedAtMs}`
    )
  ]
);

export const deidentificationFailures = sqliteTable(
  "deidentification_failure",
  {
    failureId: text("failure_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reviewCollectionRuns.runId, {
        onDelete: "cascade"
      }),
    observationId: text("observation_id")
      .notNull()
      .references(() => kakaoPlaceObservations.observationId, {
        onDelete: "restrict"
      }),
    storeId: text("store_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    index("deidentification_failure_run_store_idx").on(
      table.runId,
      table.storeId
    ),
    check(
      "deidentification_failure_retention_positive",
      sql`${table.expiresAtMs} > ${table.occurredAtMs}`
    )
  ]
);

export const rawDeleteAudits = sqliteTable(
  "raw_delete_audit",
  {
    deleteRunId: text("delete_run_id").primaryKey(),
    cutoffAtMs: integer("cutoff_at_ms").notNull(),
    attemptedCount: integer("attempted_count").notNull(),
    deletedCount: integer("deleted_count").notNull(),
    failedCount: integer("failed_count").notNull(),
    status: text("status").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    index("raw_delete_audit_status_started_idx").on(
      table.status,
      table.startedAtMs
    ),
    check(
      "raw_delete_audit_status_allowed",
      sql`${table.status} in ('RUNNING', 'SUCCEEDED', 'FAILED')`
    ),
    check(
      "raw_delete_audit_counts_valid",
      sql`${table.attemptedCount} >= 0
        and ${table.deletedCount} >= 0
        and ${table.failedCount} >= 0
        and ${table.deletedCount} + ${table.failedCount}
          <= ${table.attemptedCount}`
    ),
    check(
      "raw_delete_audit_finished_after_start",
      sql`${table.finishedAtMs} is null
        or ${table.finishedAtMs} >= ${table.startedAtMs}`
    ),
    check(
      "raw_delete_audit_retention_positive",
      sql`${table.expiresAtMs} > ${table.startedAtMs}`
    )
  ]
);
