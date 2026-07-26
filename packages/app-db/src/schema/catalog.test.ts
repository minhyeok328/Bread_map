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

describe("catalog app schema", () => {
  it("creates source, staging, run and checkpoint tables in a fresh app migration", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-catalog-schema-")
    );
    cleanupPaths.push(directory);
    const handle = openAppDatabase({
      path: join(directory, "app.sqlite")
    });

    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));
      migrateAppDatabase(handle, resolve("drizzle/app"));

      const tableNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "source_catalog",
          "source_snapshot",
          "source_snapshot_row",
          "localdata_bakery_record",
          "ingestion_run",
          "source_checkpoint",
          "data_quality_issue"
        ])
      );

      const indexNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);

      expect(indexNames).toEqual(
        expect.arrayContaining([
          "source_snapshot_source_sha256_unique",
          "source_snapshot_row_snapshot_key_unique",
          "localdata_bakery_record_snapshot_mng_unique",
          "ingestion_run_source_snapshot_adapter_unique",
          "source_checkpoint_run_page_unique"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("keeps immutable source payload and typed staging fields in separate tables", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-catalog-columns-")
    );
    cleanupPaths.push(directory);
    const handle = openAppDatabase({
      path: join(directory, "app.sqlite")
    });

    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));

      const sourceColumns = handle.client
        .prepare("PRAGMA table_info('source_snapshot_row')")
        .all()
        .map((row) => (row as { name: string }).name);
      const stagingColumns = handle.client
        .prepare("PRAGMA table_info('localdata_bakery_record')")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(sourceColumns).toContain("payload_json");
      expect(sourceColumns).not.toContain("road_name_address");
      expect(stagingColumns).toContain("road_name_address");
      expect(stagingColumns).not.toContain("payload_json");
    } finally {
      handle.close();
    }
  });
});
