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

async function createDatabase() {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-search-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  return { directory, handle };
}

function seedSource(
  client: ReturnType<typeof openAppDatabase>["client"],
  options: {
    snapshotId?: string;
    basisDate?: string;
    digestByte?: number;
  } = {}
): void {
  const snapshotId = options.snapshotId ?? "snapshot_fixture";
  const basisDate = options.basisDate ?? "2026-07-24";
  const digestByte = options.digestByte ?? 1;
  client
    .prepare(
      `INSERT OR IGNORE INTO source_catalog (
         source_id, source_key, official_url, required_fields_json,
         terms_checked_at_ms, created_at_ms
       ) VALUES ('source_fixture', 'fixture', 'https://example.test',
         '[]', 0, 0)`
    )
    .run();
  client
    .prepare(
      `INSERT INTO source_snapshot (
         snapshot_id, source_id, sha256, byte_size, basis_date,
         downloaded_at_ms, adapter_version, local_path_hint
       ) VALUES (?, 'source_fixture', ?, 0, ?, 0, 'fixture-v1', NULL)`
    )
    .run(snapshotId, Buffer.alloc(32, digestByte), basisDate);
}

function seedPublishedStore(
  client: ReturnType<typeof openAppDatabase>["client"]
): void {
  client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES ('bakery_fixture', 'Fixture Bakery',
         'fixturebakery', 'published', 0, 0)`
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
       ) VALUES ('store_fixture', 'bakery_fixture',
         'Fixture Bakery', 'fixturebakery', 'fixturebakery',
         '서울특별시 마포구 월드컵로 1', '마포구', '0212345678',
         375634614, 1269014494, 'active', 'published', 0, 0, 0)`
    )
    .run();
}

function seedPublish(
  client: ReturnType<typeof openAppDatabase>["client"],
  publishId = "publish_fixture",
  snapshotId = "snapshot_fixture",
  publishedAtMs = 100
): void {
  client
    .prepare(
      `INSERT INTO data_publish (
         publish_id, input_snapshot_id, normalization_version,
         matcher_version, eligibility_version, status,
         candidate_count, published_count, excluded_count,
         admin_review_count, published_at_ms
       ) VALUES (?, ?, 'store-normalization-v1',
         'store-matcher-v1', 'store-eligibility-v1',
         'SUCCEEDED', 1, 1, 0, 0, ?)`
    )
    .run(publishId, snapshotId, publishedAtMs);
}

async function createLegacyMigrationFolder(
  directory: string
): Promise<string> {
  const migrations = join(directory, "legacy-migrations");
  const metadata = join(migrations, "meta");
  await mkdir(metadata, { recursive: true });
  for (let index = 0; index <= 3; index += 1) {
    const sourceName = (
      await readFile(
        resolve("drizzle/app/meta/_journal.json"),
        "utf8"
      ).then((text) => JSON.parse(text) as {
        entries: Array<{ idx: number; tag: string }>;
      })
    ).entries.find((entry) => entry.idx === index)?.tag;
    if (sourceName === undefined) {
      throw new Error(`missing migration journal entry ${index}`);
    }
    await copyFile(
      resolve(`drizzle/app/${sourceName}.sql`),
      join(migrations, `${sourceName}.sql`)
    );
  }
  const journal = JSON.parse(
    await readFile(
      resolve("drizzle/app/meta/_journal.json"),
      "utf8"
    )
  ) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number }>;
  };
  journal.entries = journal.entries.filter(
    (entry) => entry.idx <= 3
  );
  await writeFile(
    join(metadata, "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`
  );
  return migrations;
}

describe("search evidence app schema", () => {
  it("creates verified evidence and active catalog tables idempotently", async () => {
    const { handle } = await createDatabase();
    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));
      migrateAppDatabase(handle, resolve("drizzle/app"));

      const tableNames = (
        handle.client
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "search_evidence_publish",
          "menu",
          "store_alias",
          "menu_alias",
          "store_business_hour",
          "catalog_publish_state"
        ])
      );

      const indexNames = (
        handle.client
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name"
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(indexNames).toEqual(
        expect.arrayContaining([
          "menu_store_normalized_name_unique",
          "store_alias_scope_normalized_unique",
          "menu_alias_menu_normalized_unique",
          "store_business_hour_store_day_sequence_unique",
          "data_publish_identity_snapshot_unique",
          "search_evidence_active_slot_unique"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("enforces verified menu, alias, hours and singleton state constraints", async () => {
    const { handle } = await createDatabase();
    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));
      seedSource(handle.client);
      seedPublishedStore(handle.client);
      seedPublish(handle.client);

      handle.client
        .prepare(
          `INSERT INTO search_evidence_publish (
             publish_id, input_catalog_publish_id, contract_version,
             status, active_slot, menu_count, store_alias_count,
             menu_alias_count, business_hour_count, corpus_checksum,
             published_at_ms
           ) VALUES (
             'search_evidence_fixture', 'publish_fixture',
             'search-evidence-v1', 'BUILDING', NULL,
             1, 1, 1, 1, ?, 1
           )`
        )
        .run("a".repeat(64));
      handle.client
        .prepare(
          `INSERT INTO menu (
             menu_id, evidence_publish_id, store_id, name,
             normalized_name, category, source, evidence_ref,
             verified_at_ms
           ) VALUES ('menu_fixture', 'search_evidence_fixture',
             'store_fixture', '소금빵',
             '소금빵', 'SALT_BREAD', 'MANUAL_VERIFIED',
             'fixture://menu/1', 1)`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO store_alias (
             alias_id, evidence_publish_id, store_id, alias_type,
             alias, normalized_alias, source, evidence_ref,
             verified_at_ms
           ) VALUES ('alias_fixture', 'search_evidence_fixture',
             'store_fixture', 'REGION',
             '홍대입구', '홍대입구', 'MANUAL_VERIFIED',
             'fixture://alias/1', 1)`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO menu_alias (
             alias_id, menu_id, alias, normalized_alias,
             source, evidence_ref, verified_at_ms
           ) VALUES ('menu_alias_fixture', 'menu_fixture', '시오빵',
             '시오빵', 'MANUAL_VERIFIED',
             'fixture://menu-alias/1', 1)`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO store_business_hour (
             interval_id, evidence_publish_id, store_id, weekday,
             sequence, opens_minute, closes_minute, closes_next_day,
             source, evidence_ref, verified_at_ms
           ) VALUES ('hours_fixture', 'search_evidence_fixture',
             'store_fixture', 4, 0, 600,
             1080, 0, 'MANUAL_VERIFIED', 'fixture://hours/1', 1)`
        )
        .run();
      handle.client
        .prepare(
          `UPDATE search_evidence_publish
           SET status = 'ACTIVE', active_slot = 1
           WHERE publish_id = 'search_evidence_fixture'`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO catalog_publish_state (
             state_id, publish_id, snapshot_id, source_basis_date,
             source_downloaded_at_ms, updated_at_ms
           ) VALUES ('active', 'publish_fixture', 'snapshot_fixture',
             '2026-07-24', 0, 100)`
        )
        .run();

      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO menu (
               menu_id, evidence_publish_id, store_id, name,
               normalized_name, category, source, evidence_ref,
               verified_at_ms
             ) VALUES ('menu_bad', 'search_evidence_fixture',
               'store_fixture', 'Unknown', 'unknown', 'UNKNOWN',
               'INFERRED', '', -1)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `UPDATE menu
             SET name = '변조된 메뉴'
             WHERE menu_id = 'menu_fixture'`
          )
          .run()
      ).toThrow("search evidence is immutable");
      expect(() =>
        handle.client
          .prepare(
            `DELETE FROM menu
             WHERE menu_id = 'menu_fixture'`
          )
          .run()
      ).toThrow("search evidence is immutable");
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO menu (
               menu_id, evidence_publish_id, store_id, name,
               normalized_name, category, source, evidence_ref,
               verified_at_ms
             ) VALUES ('menu_extra', 'search_evidence_fixture',
               'store_fixture', '바게트', '바게트', 'BAGUETTE',
               'MANUAL_VERIFIED', 'fixture://menu/extra', 1)`
          )
          .run()
      ).toThrow("search evidence is immutable");
      expect(() =>
        handle.client
          .prepare(
            `UPDATE search_evidence_publish
             SET corpus_checksum = ?
             WHERE publish_id = 'search_evidence_fixture'`
          )
          .run("b".repeat(64))
      ).toThrow("search evidence metadata is immutable");
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO store_alias (
               alias_id, evidence_publish_id, store_id, alias_type,
               alias, normalized_alias, source, evidence_ref,
               verified_at_ms
             ) VALUES ('alias_bad', 'search_evidence_fixture',
               'store_fixture', 'MENU', 'x',
               'x', 'MANUAL_VERIFIED', 'fixture://alias/x', 1)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO store_business_hour (
               interval_id, evidence_publish_id, store_id, weekday,
               sequence, opens_minute, closes_minute, closes_next_day,
               source, evidence_ref, verified_at_ms
             ) VALUES ('hours_bad', 'search_evidence_fixture',
               'store_fixture', 7, -1, 600,
               500, 0, 'MANUAL_VERIFIED', 'fixture://hours/x', 1)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO catalog_publish_state (
               state_id, publish_id, snapshot_id, source_basis_date,
               source_downloaded_at_ms, updated_at_ms
             ) VALUES ('secondary', 'publish_fixture',
               'snapshot_fixture', '2026-07-24', 0, 100)`
          )
          .run()
      ).toThrow();

      expect(() =>
        handle.client
          .prepare(
            "DELETE FROM data_publish WHERE publish_id = 'publish_fixture'"
          )
          .run()
      ).toThrow();
    } finally {
      handle.close();
    }
  });

  it("checks all declared evidence counts once before activation", async () => {
    const { handle } = await createDatabase();
    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));
      seedSource(handle.client);
      seedPublish(handle.client);
      handle.client
        .prepare(
          `INSERT INTO search_evidence_publish (
             publish_id, input_catalog_publish_id, contract_version,
             status, active_slot, menu_count, store_alias_count,
             menu_alias_count, business_hour_count, corpus_checksum,
             published_at_ms
           ) VALUES ('search_evidence_incomplete', 'publish_fixture',
             'search-evidence-v1', 'BUILDING', NULL,
             1, 0, 0, 0, ?, 1)`
        )
        .run("a".repeat(64));

      expect(() =>
        handle.client
          .prepare(
            `UPDATE search_evidence_publish
             SET status = 'ACTIVE', active_slot = 1
             WHERE publish_id = 'search_evidence_incomplete'`
          )
          .run()
      ).toThrow("search evidence counts do not match");
      expect(
        handle.client
          .prepare(
            `SELECT status, active_slot AS activeSlot
             FROM search_evidence_publish
             WHERE publish_id = 'search_evidence_incomplete'`
          )
          .get()
      ).toEqual({
        status: "BUILDING",
        activeSlot: null
      });
    } finally {
      handle.close();
    }
  });

  it("backfills the active state from the newest source basis date", async () => {
    const { directory, handle } = await createDatabase();
    try {
      const legacyMigrations =
        await createLegacyMigrationFolder(directory);
      migrateAppDatabase(handle, legacyMigrations);
      seedSource(handle.client, {
        snapshotId: "snapshot_old",
        basisDate: "2026-07-24",
        digestByte: 1
      });
      seedSource(handle.client, {
        snapshotId: "snapshot_new",
        basisDate: "2026-07-25",
        digestByte: 2
      });
      seedPublish(
        handle.client,
        "publish_clock_later",
        "snapshot_old",
        999
      );
      seedPublish(
        handle.client,
        "publish_source_newer",
        "snapshot_new",
        100
      );

      migrateAppDatabase(handle, resolve("drizzle/app"));

      expect(
        handle.client
          .prepare(
            `SELECT
               state_id AS stateId,
               publish_id AS publishId,
               snapshot_id AS snapshotId,
               source_basis_date AS sourceBasisDate,
               source_downloaded_at_ms AS sourceDownloadedAtMs
             FROM catalog_publish_state`
          )
          .get()
      ).toEqual({
        stateId: "active",
        publishId: "publish_source_newer",
        snapshotId: "snapshot_new",
        sourceBasisDate: "2026-07-25",
        sourceDownloadedAtMs: 0
      });
    } finally {
      handle.close();
    }
  });
});
