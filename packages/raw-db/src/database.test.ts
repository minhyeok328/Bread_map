import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRawDatabase } from "./database.js";
import { migrateRawDatabase } from "./migrate.js";
import { rawStorageMetadata } from "./schema/index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("raw database", () => {
  it("migrates a blank database and persists service metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-raw-db-"));
    cleanupPaths.push(directory);
    const handle = openRawDatabase({ path: join(directory, "raw.sqlite") });

    migrateRawDatabase(handle, resolve("drizzle/raw"));
    handle.db.insert(rawStorageMetadata).values({
      key: "schema_owner",
      value: "raw-db",
      updatedAt: new Date(0)
    }).run();

    const rows = handle.db.select().from(rawStorageMetadata).all();
    expect(rows).toEqual([
      {
        key: "schema_owner",
        value: "raw-db",
        updatedAt: new Date(0)
      }
    ]);

    handle.close();
  });

  it("upgrades legacy review runs with explicit safe defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-raw-db-"));
    cleanupPaths.push(directory);
    const databasePath = join(directory, "raw.sqlite");
    const legacyMigrationsPath = join(directory, "legacy-migrations");
    const legacyMetaPath = join(legacyMigrationsPath, "meta");
    const migrationsPath = resolve("drizzle/raw");
    const handle = openRawDatabase({ path: databasePath });

    await mkdir(legacyMetaPath, { recursive: true });
    await Promise.all([
      copyFile(
        join(migrationsPath, "0000_storage_metadata.sql"),
        join(legacyMigrationsPath, "0000_storage_metadata.sql")
      ),
      copyFile(
        join(migrationsPath, "0001_review_collection.sql"),
        join(legacyMigrationsPath, "0001_review_collection.sql")
      )
    ]);
    const journal = JSON.parse(
      await readFile(join(migrationsPath, "meta/_journal.json"), "utf8")
    ) as {
      entries: Array<{ idx: number }>;
    };
    await writeFile(
      join(legacyMetaPath, "_journal.json"),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx < 2)
      }),
      "utf8"
    );

    try {
      migrateRawDatabase(handle, legacyMigrationsPath);
      handle.client.pragma("ignore_check_constraints = ON");
      handle.client
        .prepare(
          `INSERT INTO kakao_discovery_run (
             run_id, query, region_code, category_tag, status, active_slot,
             policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
           ) VALUES (
             'legacy_discovery', 'fixture-query', 'SEOUL',
             'fixture-category',
             'COMPLETE', NULL, 'legacy-policy', 0, 1, 34560000000
           )`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO review_collection_run (
             run_id, discovery_run_id, catalog_snapshot_id,
             policy_snapshot_id, selector_contract_version, status,
             active_slot, store_count, collected_count, duplicate_count,
             rejected_pii_count, failed_store_count, started_at_ms,
             finished_at_ms, expires_at_ms
           ) VALUES (
             'legacy_reviews', 'legacy_discovery', 'legacy-catalog',
             'legacy-policy', 'selector-v1', 'PAUSED', NULL, 2, 1, 0, 0,
             0, 0, NULL, 34560000000
           )`
        )
        .run();
      handle.client.pragma("ignore_check_constraints = OFF");

      migrateRawDatabase(handle, migrationsPath);

      expect(
        handle.client
          .prepare(
            `SELECT as_of_date, fingerprint_key_version, run_budget_ms,
                    status, initial_backfill_store_count,
                    incremental_store_count, backfill_fallback_store_count
               FROM review_collection_run
              WHERE run_id = 'legacy_reviews'`
          )
          .get()
      ).toEqual({
        as_of_date: "1970-01-01",
        fingerprint_key_version: "legacy-feature4",
        run_budget_ms: 3600000,
        status: "PAUSED_OPERATOR",
        initial_backfill_store_count: 2,
        incremental_store_count: 0,
        backfill_fallback_store_count: 0
      });
    } finally {
      handle.close();
    }
  });
});
