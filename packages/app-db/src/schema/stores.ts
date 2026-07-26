import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import {
  localdataBakeryRecords,
  sourceSnapshotRows,
  sourceSnapshots
} from "./catalog.js";

const catalogStatusCheck = (column: ReturnType<typeof text>) =>
  sql`${column} in ('candidate', 'published', 'excluded', 'admin_review')`;

export const bakeries = sqliteTable(
  "bakery",
  {
    bakeryId: text("bakery_id").primaryKey(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    catalogStatus: text("catalog_status").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => [
    index("bakery_normalized_name_idx").on(table.normalizedName),
    index("bakery_catalog_status_idx").on(table.catalogStatus),
    check(
      "bakery_catalog_status_allowed",
      catalogStatusCheck(table.catalogStatus)
    )
  ]
);

export const stores = sqliteTable(
  "store",
  {
    storeId: text("store_id").primaryKey(),
    bakeryId: text("bakery_id")
      .notNull()
      .references(() => bakeries.bakeryId, {
        onDelete: "restrict"
      }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    normalizedBrandName: text("normalized_brand_name").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    seoulDistrict: text("seoul_district").notNull(),
    normalizedPhone: text("normalized_phone"),
    latitudeE7: integer("latitude_e7"),
    longitudeE7: integer("longitude_e7"),
    businessStatus: text("business_status").notNull(),
    catalogStatus: text("catalog_status").notNull(),
    latestVerifiedAtMs: integer("latest_verified_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => [
    index("store_bakery_idx").on(table.bakeryId),
    index("store_catalog_status_idx").on(table.catalogStatus),
    index("store_seoul_status_name_idx").on(
      table.seoulDistrict,
      table.catalogStatus,
      table.normalizedName
    ),
    check(
      "store_business_status_allowed",
      sql`${table.businessStatus} in ('active', 'inactive', 'unknown')`
    ),
    check(
      "store_catalog_status_allowed",
      catalogStatusCheck(table.catalogStatus)
    ),
    check(
      "store_coordinate_pair_complete",
      sql`(${table.latitudeE7} is null and ${table.longitudeE7} is null)
        or (${table.latitudeE7} is not null and ${table.longitudeE7} is not null)`
    ),
    check(
      "store_coordinate_seoul_bounds",
      sql`${table.latitudeE7} is null
        or (
          ${table.latitudeE7} between 374000000 and 377500000
          and ${table.longitudeE7} between 1267000000 and 1273000000
        )`
    ),
    check(
      "store_published_requirements",
      sql`${table.catalogStatus} != 'published'
        or (
          ${table.businessStatus} = 'active'
          and ${table.latitudeE7} is not null
          and ${table.longitudeE7} is not null
        )`
    )
  ]
);

export const storeSourceLinks = sqliteTable(
  "store_source_link",
  {
    linkId: text("link_id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => localdataBakeryRecords.recordId, {
        onDelete: "restrict"
      }),
    sourceRowId: text("source_row_id")
      .notNull()
      .references(() => sourceSnapshotRows.sourceRowId, {
        onDelete: "restrict"
      }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "restrict"
      }),
    sourceType: text("source_type").notNull(),
    linkedAtMs: integer("linked_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("store_source_link_source_record_unique").on(
      table.sourceRecordId
    ),
    uniqueIndex("store_source_link_source_row_unique").on(
      table.sourceRowId
    ),
    index("store_source_link_store_idx").on(table.storeId),
    check(
      "store_source_link_type_allowed",
      sql`${table.sourceType} = 'LOCALDATA'`
    )
  ]
);

export const matchCandidates = sqliteTable(
  "match_candidate",
  {
    matchId: text("match_id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "cascade"
      }),
    leftCandidateId: text("left_candidate_id").notNull(),
    rightCandidateId: text("right_candidate_id").notNull(),
    leftSourceRecordId: text("left_source_record_id")
      .notNull()
      .references(() => localdataBakeryRecords.recordId, {
        onDelete: "cascade"
      }),
    rightSourceRecordId: text("right_source_record_id")
      .notNull()
      .references(() => localdataBakeryRecords.recordId, {
        onDelete: "cascade"
      }),
    scoreBasisPoints: integer("score_basis_points").notNull(),
    signalsJson: text("signals_json").notNull(),
    matcherVersion: text("matcher_version").notNull(),
    status: text("status").notNull(),
    createdAtMs: integer("created_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("match_candidate_pair_version_unique").on(
      table.snapshotId,
      table.leftCandidateId,
      table.rightCandidateId,
      table.matcherVersion
    ),
    index("match_candidate_status_score_idx").on(
      table.status,
      table.scoreBasisPoints
    ),
    check(
      "match_candidate_ordered_pair",
      sql`${table.leftCandidateId} < ${table.rightCandidateId}`
    ),
    check(
      "match_candidate_score_range",
      sql`${table.scoreBasisPoints} between 0 and 10000`
    ),
    check(
      "match_candidate_status_allowed",
      sql`${table.status} in ('auto_merge', 'admin_review', 'separate')`
    ),
    check(
      "match_candidate_signals_json_valid",
      sql`json_valid(${table.signalsJson})`
    )
  ]
);

export const eligibilityDecisions = sqliteTable(
  "eligibility_decision",
  {
    decisionId: text("decision_id").primaryKey(),
    decisionGroupId: text("decision_group_id").notNull(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "restrict"
      }),
    bakeryId: text("bakery_id")
      .notNull()
      .references(() => bakeries.bakeryId, {
        onDelete: "restrict"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "restrict"
      }),
    classification: text("classification").notNull(),
    status: text("status").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    ruleVersion: text("rule_version").notNull(),
    decidedAtMs: integer("decided_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("eligibility_decision_store_rule_unique").on(
      table.snapshotId,
      table.storeId,
      table.ruleVersion
    ),
    index("eligibility_decision_bakery_status_idx").on(
      table.bakeryId,
      table.status
    ),
    check(
      "eligibility_decision_classification_allowed",
      sql`${table.classification} in (
        'INDEPENDENT_SINGLE',
        'DIRECT_ONLY_SMALL_CHAIN',
        'FRANCHISE',
        'CHAIN_TOO_LARGE',
        'UNCERTAIN_REVIEW_REQUIRED'
      )`
    ),
    check(
      "eligibility_decision_status_allowed",
      sql`${table.status} in ('eligible', 'excluded', 'admin_review')`
    ),
    check(
      "eligibility_decision_reasons_json_valid",
      sql`json_valid(${table.reasonsJson})`
    )
  ]
);

export const manualReviews = sqliteTable(
  "manual_review",
  {
    manualReviewId: text("manual_review_id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "cascade"
      }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reviewType: text("review_type").notNull(),
    status: text("status").notNull(),
    decision: text("decision"),
    evidenceRefsJson: text("evidence_refs_json").notNull(),
    reviewVersion: text("review_version").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    decidedAtMs: integer("decided_at_ms")
  },
  (table) => [
    uniqueIndex("manual_review_target_type_version_unique").on(
      table.snapshotId,
      table.targetType,
      table.targetId,
      table.reviewType,
      table.reviewVersion
    ),
    index("manual_review_status_created_idx").on(
      table.status,
      table.createdAtMs
    ),
    check(
      "manual_review_target_type_allowed",
      sql`${table.targetType} in ('store', 'bakery', 'match')`
    ),
    check(
      "manual_review_type_allowed",
      sql`${table.reviewType} in ('normalization', 'duplicate', 'eligibility')`
    ),
    check(
      "manual_review_status_allowed",
      sql`${table.status} in ('open', 'approved', 'rejected')`
    ),
    check(
      "manual_review_evidence_json_valid",
      sql`json_valid(${table.evidenceRefsJson})`
    )
  ]
);

export const dataPublishes = sqliteTable(
  "data_publish",
  {
    publishId: text("publish_id").primaryKey(),
    inputSnapshotId: text("input_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.snapshotId, {
        onDelete: "restrict"
      }),
    normalizationVersion: text("normalization_version").notNull(),
    matcherVersion: text("matcher_version").notNull(),
    eligibilityVersion: text("eligibility_version").notNull(),
    status: text("status").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    publishedCount: integer("published_count").notNull(),
    excludedCount: integer("excluded_count").notNull(),
    adminReviewCount: integer("admin_review_count").notNull(),
    publishedAtMs: integer("published_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("data_publish_snapshot_versions_unique").on(
      table.inputSnapshotId,
      table.normalizationVersion,
      table.matcherVersion,
      table.eligibilityVersion
    ),
    index("data_publish_status_time_idx").on(
      table.status,
      table.publishedAtMs
    ),
    check(
      "data_publish_status_allowed",
      sql`${table.status} in ('SUCCEEDED', 'BLOCKED_QUALITY', 'SUPERSEDED')`
    ),
    check(
      "data_publish_counts_nonnegative",
      sql`${table.candidateCount} >= 0
        and ${table.publishedCount} >= 0
        and ${table.excludedCount} >= 0
        and ${table.adminReviewCount} >= 0`
    )
  ]
);
