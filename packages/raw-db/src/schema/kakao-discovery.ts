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

export const kakaoDiscoveryRuns = sqliteTable(
  "kakao_discovery_run",
  {
    runId: text("run_id").primaryKey(),
    query: text("query").notNull(),
    regionCode: text("region_code").notNull(),
    categoryTag: text("category_tag").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("kakao_discovery_active_slot_unique").on(
      table.activeSlot
    ),
    index("kakao_discovery_status_started_idx").on(
      table.status,
      table.startedAtMs
    ),
    check(
      "kakao_discovery_query_allowed",
      sql`${table.query} = '빵집'`
    ),
    check(
      "kakao_discovery_region_allowed",
      sql`${table.regionCode} = 'SEOUL'`
    ),
    check(
      "kakao_discovery_category_allowed",
      sql`${table.categoryTag} = '제과,베이커리'`
    ),
    check(
      "kakao_discovery_status_allowed",
      sql`${table.status} in (
        'READY', 'RUNNING', 'COMPLETE', 'PARTIAL',
        'STOPPED_POLICY', 'STOPPED_ACCESS', 'FAILED_FINAL'
      )`
    ),
    check(
      "kakao_discovery_active_slot_allowed",
      sql`${table.activeSlot} is null or ${table.activeSlot} = 1`
    ),
    check(
      "kakao_discovery_finished_after_start",
      sql`${table.finishedAtMs} is null
        or ${table.finishedAtMs} >= ${table.startedAtMs}`
    ),
    check(
      "kakao_discovery_retention_positive",
      sql`${table.expiresAtMs} > ${table.startedAtMs}`
    )
  ]
);

export const kakaoPlaceObservations = sqliteTable(
  "kakao_place_observation",
  {
    observationId: text("observation_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => kakaoDiscoveryRuns.runId, {
        onDelete: "cascade"
      }),
    observationKey: blob("observation_key", {
      mode: "buffer"
    }).notNull(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    categoryName: text("category_name").notNull(),
    categoryTag: text("category_tag").notNull(),
    roadAddress: text("road_address"),
    lotAddress: text("lot_address"),
    phone: text("phone"),
    latitudeE7: integer("latitude_e7").notNull(),
    longitudeE7: integer("longitude_e7").notNull(),
    tileKey: text("tile_key").notNull(),
    pageNumber: integer("page_number").notNull(),
    matchStatus: text("match_status").notNull(),
    matchedStoreId: text("matched_store_id"),
    matchSignalsJson: text("match_signals_json").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("kakao_place_observation_run_key_unique").on(
      table.runId,
      table.observationKey
    ),
    index("kakao_place_observation_match_idx").on(
      table.runId,
      table.matchStatus
    ),
    index("kakao_place_observation_store_idx").on(
      table.matchedStoreId
    ),
    check(
      "kakao_place_observation_key_length",
      sql`length(${table.observationKey}) = 32`
    ),
    check(
      "kakao_place_observation_page_positive",
      sql`${table.pageNumber} > 0`
    ),
    check(
      "kakao_place_observation_match_status_allowed",
      sql`${table.matchStatus} in (
        'MATCHED_ELIGIBLE', 'MATCHED_EXCLUDED', 'UNMATCHED',
        'AMBIGUOUS', 'CATEGORY_REJECTED'
      )`
    ),
    check(
      "kakao_place_observation_match_store_consistent",
      sql`(
        ${table.matchStatus} in ('MATCHED_ELIGIBLE', 'MATCHED_EXCLUDED')
        and ${table.matchedStoreId} is not null
      ) or (
        ${table.matchStatus} in (
          'UNMATCHED', 'AMBIGUOUS', 'CATEGORY_REJECTED'
        )
        and ${table.matchedStoreId} is null
      )`
    ),
    check(
      "kakao_place_observation_signals_json_valid",
      sql`json_valid(${table.matchSignalsJson})`
    ),
    check(
      "kakao_place_observation_seoul_bounds",
      sql`${table.latitudeE7} between 374000000 and 377500000
        and ${table.longitudeE7} between 1267000000 and 1273000000`
    ),
    check(
      "kakao_place_observation_retention_positive",
      sql`${table.expiresAtMs} > ${table.observedAtMs}`
    )
  ]
);

export const kakaoPlaceLocators = sqliteTable(
  "kakao_place_locator",
  {
    locatorId: text("locator_id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => kakaoPlaceObservations.observationId, {
        onDelete: "cascade"
      }),
    provider: text("provider").notNull(),
    placeId: text("place_id").notNull(),
    placeUrl: text("place_url").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    deleteByMs: integer("delete_by_ms").notNull()
  },
  (table) => [
    uniqueIndex("kakao_place_locator_observation_unique").on(
      table.observationId
    ),
    index("kakao_place_locator_provider_place_idx").on(
      table.provider,
      table.placeId
    ),
    index("kakao_place_locator_delete_by_idx").on(table.deleteByMs),
    check(
      "kakao_place_locator_provider_allowed",
      sql`${table.provider} = 'KAKAO'`
    ),
    check(
      "kakao_place_locator_deadline_positive",
      sql`${table.deleteByMs} > ${table.createdAtMs}`
    ),
    check(
      "kakao_place_locator_deadline_max",
      sql`${table.deleteByMs} <= ${table.createdAtMs} + 2592000000`
    )
  ]
);
