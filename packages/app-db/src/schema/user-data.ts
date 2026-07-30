import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";
import { stores } from "./stores.js";

export const favorites = sqliteTable(
  "favorite",
  {
    favoriteId: text("favorite_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (table) => [
    uniqueIndex("favorite_user_store_unique").on(
      table.userId,
      table.storeId
    ),
    index("favorite_user_created_idx").on(
      table.userId,
      table.createdAtMs
    )
  ]
);

export const searchHistories = sqliteTable(
  "search_history",
  {
    searchHistoryId: text("search_history_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade"
      }),
    displayFiltersJson: text("display_filters_json").notNull(),
    dataSnapshotVersion: text("data_snapshot_version").notNull(),
    recommendationVersion: text("recommendation_version").notNull(),
    resultCount: integer("result_count").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (table) => [
    index("search_history_user_created_idx").on(
      table.userId,
      table.createdAtMs
    ),
    check(
      "search_history_filters_json_valid",
      sql`json_valid(${table.displayFiltersJson})`
    ),
    check(
      "search_history_result_count_nonnegative",
      sql`${table.resultCount} >= 0`
    ),
    check(
      "search_history_data_version_format",
      sql`length(${table.dataSnapshotVersion}) = 79
        and substr(${table.dataSnapshotVersion}, 1, 15) = 'search-data-v1_'
        and substr(${table.dataSnapshotVersion}, 16)
          not glob '*[^0-9a-f]*'`
    ),
    check(
      "search_history_recommendation_version_allowed",
      sql`${table.recommendationVersion} = 'recommendation-v1'`
    )
  ]
);

export const selectionHistories = sqliteTable(
  "selection_history",
  {
    selectionHistoryId: text("selection_history_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade"
      }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId, {
        onDelete: "cascade"
      }),
    sourceSurface: text("source_surface").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (table) => [
    index("selection_history_user_created_idx").on(
      table.userId,
      table.createdAtMs
    ),
    check(
      "selection_history_surface_allowed",
      sql`${table.sourceSurface} in ('LIST', 'MAP', 'SEARCH')`
    )
  ]
);
