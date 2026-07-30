import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { dataPublishes, stores } from "./stores.js";

const manualEvidenceChecks = (
  source: AnySQLiteColumn,
  evidenceRef: AnySQLiteColumn,
  verifiedAtMs: AnySQLiteColumn
) => [
  check(
    "source_manual_verified",
    sql`${source} = 'MANUAL_VERIFIED'`
  ),
  check(
    "evidence_ref_nonempty",
    sql`length(trim(${evidenceRef})) > 0`
  ),
  check(
    "verified_at_ms_nonnegative",
    sql`${verifiedAtMs} >= 0`
  )
];

const checksumCheck = (column: AnySQLiteColumn) =>
  sql`length(${column}) = 64
    and ${column} = lower(${column})
    and ${column} not glob '*[^0-9a-f]*'`;

export const searchEvidencePublishes = sqliteTable(
  "search_evidence_publish",
  {
    publishId: text("publish_id").primaryKey(),
    inputCatalogPublishId: text("input_catalog_publish_id")
      .notNull()
      .references(() => dataPublishes.publishId, {
        onDelete: "restrict"
      }),
    contractVersion: text("contract_version").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    menuCount: integer("menu_count").notNull(),
    storeAliasCount: integer("store_alias_count").notNull(),
    menuAliasCount: integer("menu_alias_count").notNull(),
    businessHourCount: integer("business_hour_count").notNull(),
    corpusChecksum: text("corpus_checksum").notNull(),
    publishedAtMs: integer("published_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("search_evidence_active_slot_unique").on(
      table.activeSlot
    ),
    index("search_evidence_catalog_status_idx").on(
      table.inputCatalogPublishId,
      table.status
    ),
    check(
      "search_evidence_contract_version_allowed",
      sql`${table.contractVersion} = 'search-evidence-v1'`
    ),
    check(
      "search_evidence_status_allowed",
      sql`${table.status} in ('BUILDING', 'ACTIVE', 'SUPERSEDED')`
    ),
    check(
      "search_evidence_active_state_valid",
      sql`(
          ${table.status} = 'ACTIVE'
          and ${table.activeSlot} = 1
        ) or (
          ${table.status} = 'SUPERSEDED'
          and ${table.activeSlot} is null
        ) or (
          ${table.status} = 'BUILDING'
          and ${table.activeSlot} is null
        )`
    ),
    check(
      "search_evidence_counts_nonnegative",
      sql`${table.menuCount} >= 0
        and ${table.storeAliasCount} >= 0
        and ${table.menuAliasCount} >= 0
        and ${table.businessHourCount} >= 0`
    ),
    check(
      "search_evidence_checksum_valid",
      checksumCheck(table.corpusChecksum)
    ),
    check(
      "search_evidence_time_nonnegative",
      sql`${table.publishedAtMs} >= 0`
    )
  ]
);

export const menus = sqliteTable(
  "menu",
  {
    menuId: text("menu_id").primaryKey(),
    evidencePublishId: text("evidence_publish_id")
      .notNull()
      .references(() => searchEvidencePublishes.publishId, {
        onDelete: "cascade"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    category: text("category").notNull(),
    source: text("source").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    verifiedAtMs: integer("verified_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("menu_store_normalized_name_unique").on(
      table.evidencePublishId,
      table.storeId,
      table.normalizedName
    ),
    index("menu_publish_store_category_idx").on(
      table.evidencePublishId,
      table.storeId,
      table.category
    ),
    check("menu_name_nonempty", sql`length(trim(${table.name})) > 0`),
    check(
      "menu_normalized_name_nonempty",
      sql`length(trim(${table.normalizedName})) > 0`
    ),
    check(
      "menu_category_allowed",
      sql`${table.category} in (
        'FERMENTED_BREAD',
        'PASTRY',
        'SALT_BREAD',
        'BAGUETTE',
        'LOAF_BREAD',
        'SWEET_BREAD',
        'SANDWICH',
        'DESSERT'
      )`
    ),
    ...manualEvidenceChecks(
      table.source,
      table.evidenceRef,
      table.verifiedAtMs
    )
  ]
);

export const storeAliases = sqliteTable(
  "store_alias",
  {
    aliasId: text("alias_id").primaryKey(),
    evidencePublishId: text("evidence_publish_id")
      .notNull()
      .references(() => searchEvidencePublishes.publishId, {
        onDelete: "cascade"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    aliasType: text("alias_type").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    source: text("source").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    verifiedAtMs: integer("verified_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("store_alias_scope_normalized_unique").on(
      table.evidencePublishId,
      table.storeId,
      table.aliasType,
      table.normalizedAlias
    ),
    index("store_alias_type_normalized_idx").on(
      table.evidencePublishId,
      table.aliasType,
      table.normalizedAlias
    ),
    check(
      "store_alias_type_allowed",
      sql`${table.aliasType} in ('STORE_NAME', 'REGION')`
    ),
    check(
      "store_alias_display_nonempty",
      sql`length(trim(${table.alias})) > 0`
    ),
    check(
      "store_alias_normalized_nonempty",
      sql`length(trim(${table.normalizedAlias})) > 0`
    ),
    ...manualEvidenceChecks(
      table.source,
      table.evidenceRef,
      table.verifiedAtMs
    )
  ]
);

export const menuAliases = sqliteTable(
  "menu_alias",
  {
    aliasId: text("alias_id").primaryKey(),
    menuId: text("menu_id")
      .notNull()
      .references(() => menus.menuId, {
        onDelete: "cascade"
      }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    source: text("source").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    verifiedAtMs: integer("verified_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("menu_alias_menu_normalized_unique").on(
      table.menuId,
      table.normalizedAlias
    ),
    index("menu_alias_normalized_idx").on(table.normalizedAlias),
    check(
      "menu_alias_display_nonempty",
      sql`length(trim(${table.alias})) > 0`
    ),
    check(
      "menu_alias_normalized_nonempty",
      sql`length(trim(${table.normalizedAlias})) > 0`
    ),
    ...manualEvidenceChecks(
      table.source,
      table.evidenceRef,
      table.verifiedAtMs
    )
  ]
);

export const storeBusinessHours = sqliteTable(
  "store_business_hour",
  {
    intervalId: text("interval_id").primaryKey(),
    evidencePublishId: text("evidence_publish_id")
      .notNull()
      .references(() => searchEvidencePublishes.publishId, {
        onDelete: "cascade"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    weekday: integer("weekday").notNull(),
    sequence: integer("sequence").notNull(),
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),
    closesNextDay: integer("closes_next_day").notNull(),
    source: text("source").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    verifiedAtMs: integer("verified_at_ms").notNull()
  },
  (table) => [
    uniqueIndex(
      "store_business_hour_store_day_sequence_unique"
    ).on(
      table.evidencePublishId,
      table.storeId,
      table.weekday,
      table.sequence
    ),
    index("store_business_hour_store_day_idx").on(
      table.evidencePublishId,
      table.storeId,
      table.weekday
    ),
    check(
      "store_business_hour_weekday_range",
      sql`${table.weekday} between 0 and 6`
    ),
    check(
      "store_business_hour_sequence_nonnegative",
      sql`${table.sequence} >= 0`
    ),
    check(
      "store_business_hour_minute_ranges",
      sql`${table.opensMinute} between 0 and 1439
        and ${table.closesMinute} between 0 and 1439`
    ),
    check(
      "store_business_hour_next_day_boolean",
      sql`${table.closesNextDay} in (0, 1)`
    ),
    check(
      "store_business_hour_interval_direction",
      sql`(
          ${table.closesNextDay} = 0
          and ${table.closesMinute} > ${table.opensMinute}
        ) or (
          ${table.closesNextDay} = 1
          and ${table.closesMinute} <= ${table.opensMinute}
        )`
    ),
    ...manualEvidenceChecks(
      table.source,
      table.evidenceRef,
      table.verifiedAtMs
    )
  ]
);

export const catalogPublishStates = sqliteTable(
  "catalog_publish_state",
  {
    stateId: text("state_id").primaryKey(),
    publishId: text("publish_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    sourceBasisDate: text("source_basis_date").notNull(),
    sourceDownloadedAtMs: integer(
      "source_downloaded_at_ms"
    ).notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => [
    foreignKey({
      name: "catalog_publish_state_publish_snapshot_fk",
      columns: [table.publishId, table.snapshotId],
      foreignColumns: [
        dataPublishes.publishId,
        dataPublishes.inputSnapshotId
      ]
    }).onDelete("restrict"),
    check(
      "catalog_publish_state_singleton",
      sql`${table.stateId} = 'active'`
    ),
    check(
      "catalog_publish_state_source_date_format",
      sql`${table.sourceBasisDate} glob
          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        and date(${table.sourceBasisDate}) is not null`
    ),
    check(
      "catalog_publish_state_download_time_nonnegative",
      sql`${table.sourceDownloadedAtMs} >= 0`
    ),
    check(
      "catalog_publish_state_time_nonnegative",
      sql`${table.updatedAtMs} >= 0`
    )
  ]
);
