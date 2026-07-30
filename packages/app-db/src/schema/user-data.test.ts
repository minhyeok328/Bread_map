import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../database.js";
import { migrateAppDatabase } from "../migrate.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createMigratedDatabase() {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-user-data-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(handle, resolve("drizzle/app"));
  return handle;
}

function seedOwnerAndStore(
  client: ReturnType<typeof openAppDatabase>["client"]
): void {
  client
    .prepare(
      `INSERT INTO user (
         user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
       ) VALUES ('user-a', 'ACTIVE', 1, 1, NULL)`
    )
    .run();
  client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES ('bakery-a', 'Bakery A', 'bakery a', 'published',
         1, 1)`
    )
    .run();
  client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES ('store-a', 'bakery-a', 'Store A', 'store a',
         'bakery a', 'Seoul Mapo', 'Mapo', NULL,
         375634614, 1269014494, 'active', 'published', 1, 1, 1)`
    )
    .run();
}

describe("account-owned user data schema", () => {
  it("creates favorites and normalized history tables idempotently", async () => {
    const handle = await createMigratedDatabase();

    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));
      const tableNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "favorite",
          "search_history",
          "selection_history"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("enforces ownership keys and normalized history constraints", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedOwnerAndStore(handle.client);
      const insertFavorite = (favoriteId: string) =>
        handle.client
          .prepare(
            `INSERT INTO favorite (
               favorite_id, user_id, store_id, created_at_ms
             ) VALUES (?, 'user-a', 'store-a', 1)`
          )
          .run(favoriteId);
      insertFavorite("favorite-a");
      expect(() => insertFavorite("favorite-duplicate")).toThrow();

      handle.client
        .prepare(
          `INSERT INTO search_history (
             search_history_id, user_id, display_filters_json,
             data_snapshot_version, recommendation_version,
             result_count, created_at_ms
           ) VALUES ('search-a', 'user-a', ?,
             'search-data-v1_${"a".repeat(64)}',
             'recommendation-v1', 3, 1)`
        )
        .run(
          JSON.stringify({
            schemaVersion: "search-history-filters-v1",
            areaLabel: "Mapo"
          })
        );
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO search_history (
               search_history_id, user_id, display_filters_json,
               data_snapshot_version, recommendation_version,
               result_count, created_at_ms
             ) VALUES ('search-invalid-json', 'user-a', '{',
               'search-data-v1_${"b".repeat(64)}',
               'recommendation-v1', 0, 1)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO search_history (
               search_history_id, user_id, display_filters_json,
               data_snapshot_version, recommendation_version,
               result_count, created_at_ms
             ) VALUES ('search-negative', 'user-a', '{}',
               'search-data-v1_${"c".repeat(64)}',
               'recommendation-v1', -1, 1)`
          )
          .run()
      ).toThrow();

      handle.client
        .prepare(
          `INSERT INTO selection_history (
             selection_history_id, user_id, store_id,
             source_surface, created_at_ms
           ) VALUES ('selection-a', 'user-a', 'store-a', 'MAP', 1)`
        )
        .run();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO selection_history (
               selection_history_id, user_id, store_id,
               source_surface, created_at_ms
             ) VALUES ('selection-invalid', 'user-a', 'store-a',
               'CHAT', 1)`
          )
          .run()
      ).toThrow();

      handle.client
        .prepare("DELETE FROM user WHERE user_id = 'user-a'")
        .run();
      for (const table of [
        "favorite",
        "search_history",
        "selection_history"
      ]) {
        expect(
          handle.client
            .prepare(`SELECT count(*) AS count FROM ${table}`)
            .get()
        ).toEqual({ count: 0 });
      }
    } finally {
      handle.close();
    }
  });
});
