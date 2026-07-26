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

export const sourceCatalog = sqliteTable(
  "source_catalog",
  {
    sourceId: text("source_id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    officialUrl: text("official_url").notNull(),
    requiredFieldsJson: text("required_fields_json").notNull(),
    termsCheckedAtMs: integer("terms_checked_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("source_catalog_source_key_unique").on(
      table.sourceKey
    )
  ]
);

export const sourceSnapshots = sqliteTable(
  "source_snapshot",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourceCatalog.sourceId, {
        onDelete: "restrict"
      }),
    sha256: blob("sha256", { mode: "buffer" }).notNull(),
    byteSize: integer("byte_size").notNull(),
    basisDate: text("basis_date").notNull(),
    downloadedAtMs: integer("downloaded_at_ms").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    localPathHint: text("local_path_hint")
  },
  (table) => [
    uniqueIndex("source_snapshot_source_sha256_unique").on(
      table.sourceId,
      table.sha256
    ),
    index("source_snapshot_source_basis_idx").on(
      table.sourceId,
      table.basisDate
    ),
    check(
      "source_snapshot_sha256_length",
      sql`length(${table.sha256}) = 32`
    ),
    check(
      "source_snapshot_byte_size_nonnegative",
      sql`${table.byteSize} >= 0`
    )
  ]
);

export const sourceSnapshotRows = sqliteTable(
  "source_snapshot_row",
  {
    sourceRowId: text("source_row_id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "cascade"
      }),
    pageNo: integer("page_no").notNull(),
    rowIndex: integer("row_index").notNull(),
    sourceRowKey: text("source_row_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadSha256: blob("payload_sha256", {
      mode: "buffer"
    }).notNull(),
    createdAtMs: integer("created_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("source_snapshot_row_snapshot_position_unique").on(
      table.snapshotId,
      table.pageNo,
      table.rowIndex
    ),
    uniqueIndex("source_snapshot_row_snapshot_key_unique").on(
      table.snapshotId,
      table.sourceRowKey
    ),
    check(
      "source_snapshot_row_page_positive",
      sql`${table.pageNo} > 0`
    ),
    check(
      "source_snapshot_row_index_nonnegative",
      sql`${table.rowIndex} >= 0`
    ),
    check(
      "source_snapshot_row_sha256_length",
      sql`length(${table.payloadSha256}) = 32`
    )
  ]
);

export const localdataBakeryRecords = sqliteTable(
  "localdata_bakery_record",
  {
    recordId: text("record_id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "cascade"
      }),
    sourceRowId: text("source_row_id")
      .notNull()
      .references(() => sourceSnapshotRows.sourceRowId, {
        onDelete: "cascade"
      }),
    mngNo: text("mng_no").notNull(),
    openAuthorityGroupCode: text(
      "open_authority_group_code"
    ).notNull(),
    permitDate: text("permit_date"),
    businessStatusCode: text("business_status_code").notNull(),
    businessStatusName: text("business_status_name").notNull(),
    detailedBusinessStatusCode: text(
      "detailed_business_status_code"
    ),
    detailedBusinessStatusName: text(
      "detailed_business_status_name"
    ),
    closedDate: text("closed_date"),
    businessName: text("business_name").notNull(),
    roadNameAddress: text("road_name_address"),
    lotNumberAddress: text("lot_number_address"),
    sourceCoordinateX: text("source_coordinate_x"),
    sourceCoordinateY: text("source_coordinate_y"),
    dataUpdatedAtMs: integer("data_updated_at_ms"),
    lastModifiedAtMs: integer("last_modified_at_ms"),
    stagedAtMs: integer("staged_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("localdata_bakery_record_source_row_unique").on(
      table.sourceRowId
    ),
    uniqueIndex(
      "localdata_bakery_record_snapshot_mng_unique"
    ).on(table.snapshotId, table.mngNo),
    index("localdata_bakery_record_status_idx").on(
      table.businessStatusCode
    )
  ]
);

export const ingestionRuns = sqliteTable(
  "ingestion_run",
  {
    runId: text("run_id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourceCatalog.sourceId, {
        onDelete: "restrict"
      }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "restrict"
      }),
    adapterVersion: text("adapter_version").notNull(),
    status: text("status").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
    attemptCount: integer("attempt_count").notNull().default(1),
    pageCount: integer("page_count").notNull().default(0),
    readCount: integer("read_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0)
  },
  (table) => [
    uniqueIndex(
      "ingestion_run_source_snapshot_adapter_unique"
    ).on(table.sourceId, table.snapshotId, table.adapterVersion),
    index("ingestion_run_source_started_idx").on(
      table.sourceId,
      table.startedAtMs
    ),
    check(
      "ingestion_run_status_allowed",
      sql`${table.status} in ('RUNNING', 'SUCCEEDED', 'FAILED_FINAL')`
    ),
    check(
      "ingestion_run_counts_nonnegative",
      sql`${table.attemptCount} > 0
        and ${table.pageCount} >= 0
        and ${table.readCount} >= 0
        and ${table.insertedCount} >= 0
        and ${table.updatedCount} >= 0
        and ${table.rejectedCount} >= 0`
    )
  ]
);

export const sourceCheckpoints = sqliteTable(
  "source_checkpoint",
  {
    checkpointId: text("checkpoint_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRuns.runId, {
        onDelete: "cascade"
      }),
    pageNo: integer("page_no").notNull(),
    lastCommittedKey: text("last_committed_key"),
    state: text("state").notNull(),
    readCount: integer("read_count").notNull(),
    insertedCount: integer("inserted_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    rejectedCount: integer("rejected_count").notNull(),
    committedAtMs: integer("committed_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("source_checkpoint_run_page_unique").on(
      table.runId,
      table.pageNo
    ),
    check(
      "source_checkpoint_state_allowed",
      sql`${table.state} = 'COMMITTED'`
    ),
    check(
      "source_checkpoint_counts_nonnegative",
      sql`${table.pageNo} > 0
        and ${table.readCount} >= 0
        and ${table.insertedCount} >= 0
        and ${table.updatedCount} >= 0
        and ${table.rejectedCount} >= 0`
    )
  ]
);

export const dataQualityIssues = sqliteTable(
  "data_quality_issue",
  {
    issueId: text("issue_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRuns.runId, {
        onDelete: "cascade"
      }),
    sourceRowId: text("source_row_id")
      .notNull()
      .references(() => sourceSnapshotRows.sourceRowId, {
        onDelete: "cascade"
      }),
    ruleCode: text("rule_code").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull(),
    redactedDetailsJson: text("redacted_details_json").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("data_quality_issue_run_row_rule_unique").on(
      table.runId,
      table.sourceRowId,
      table.ruleCode
    ),
    index("data_quality_issue_status_severity_idx").on(
      table.status,
      table.severity
    ),
    check(
      "data_quality_issue_severity_allowed",
      sql`${table.severity} = 'REJECTED'`
    ),
    check(
      "data_quality_issue_status_allowed",
      sql`${table.status} = 'OPEN'`
    )
  ]
);
