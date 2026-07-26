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
    join(tmpdir(), "bread-map-store-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(handle, resolve("drizzle/app"));
  return handle;
}

function seedSourceLineage(
  client: ReturnType<typeof openAppDatabase>["client"]
): void {
  client
    .prepare(
      `INSERT INTO source_catalog (
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
       ) VALUES ('snapshot_fixture', 'source_fixture', ?, 0,
         '2026-07-24', 0, 'fixture-v1', NULL)`
    )
    .run(Buffer.alloc(32));
  client
    .prepare(
      `INSERT INTO source_snapshot_row (
         source_row_id, snapshot_id, page_no, row_index,
         source_row_key, payload_json, payload_sha256, created_at_ms
       ) VALUES ('source_row_fixture', 'snapshot_fixture', 1, 0,
         'SEOUL-FIXTURE-001', '{}', ?, 0)`
    )
    .run(Buffer.alloc(32));
  client
    .prepare(
      `INSERT INTO localdata_bakery_record (
         record_id, snapshot_id, source_row_id, mng_no,
         open_authority_group_code, permit_date,
         business_status_code, business_status_name,
         detailed_business_status_code,
         detailed_business_status_name, closed_date, business_name,
         road_name_address, lot_number_address,
         source_coordinate_x, source_coordinate_y,
         data_updated_at_ms, last_modified_at_ms, staged_at_ms
       ) VALUES (
         'record_fixture', 'snapshot_fixture', 'source_row_fixture',
         'SEOUL-FIXTURE-001', '6110000', NULL, '01', '영업/정상',
         '01', '영업', NULL, 'Fixture Bakery',
         '서울특별시 마포구 월드컵로 1', NULL,
         '191234.125', '451234.5', NULL, NULL, 0
       )`
    )
    .run();
}

describe("store catalog app schema", () => {
  it("creates catalog, match, eligibility, review and publish tables idempotently", async () => {
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
          "bakery",
          "store",
          "store_source_link",
          "match_candidate",
          "eligibility_decision",
          "manual_review",
          "data_publish"
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
          "store_source_link_source_record_unique",
          "match_candidate_pair_version_unique",
          "eligibility_decision_store_rule_unique",
          "manual_review_target_type_version_unique",
          "data_publish_snapshot_versions_unique"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("enforces publish coordinates and replay uniqueness in SQLite", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedSourceLineage(handle.client);
      handle.client
        .prepare(
          `INSERT INTO bakery (
             bakery_id, display_name, normalized_name, catalog_status,
             created_at_ms, updated_at_ms
           ) VALUES ('bakery_fixture', 'Fixture Bakery',
             'fixturebakery', 'published', 0, 0)`
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO store (
             store_id, bakery_id, display_name, normalized_name,
             normalized_brand_name, normalized_address, seoul_district,
             normalized_phone, latitude_e7, longitude_e7,
             business_status, catalog_status, latest_verified_at_ms,
             created_at_ms, updated_at_ms
           ) VALUES ('store_fixture', 'bakery_fixture',
             'Fixture Bakery', 'fixturebakery', 'fixturebakery',
             '서울특별시 마포구 월드컵로 1', '마포구', NULL,
             375634614, 1269014494, 'active', 'published', 0, 0, 0)`
        )
        .run();

      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO store (
               store_id, bakery_id, display_name, normalized_name,
               normalized_brand_name, normalized_address,
               seoul_district, normalized_phone, latitude_e7,
               longitude_e7, business_status, catalog_status,
               latest_verified_at_ms, created_at_ms, updated_at_ms
             ) VALUES ('store_without_coordinates', 'bakery_fixture',
               'No Coordinates', 'nocoordinates', 'nocoordinates',
               '서울특별시 중구 회현동 2-2', '중구', NULL,
               NULL, NULL, 'active', 'published', 0, 0, 0)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO store (
               store_id, bakery_id, display_name, normalized_name,
               normalized_brand_name, normalized_address,
               seoul_district, normalized_phone, latitude_e7,
               longitude_e7, business_status, catalog_status,
               latest_verified_at_ms, created_at_ms, updated_at_ms
             ) VALUES ('store_outside_seoul', 'bakery_fixture',
               'Outside', 'outside', 'outside',
               '서울특별시 중구 세종대로 1', '중구', NULL,
               350000000, 1269014494, 'active', 'candidate', 0, 0, 0)`
          )
          .run()
      ).toThrow();

      const insertSourceLink = () =>
        handle.client
          .prepare(
            `INSERT INTO store_source_link (
               link_id, store_id, source_record_id, source_row_id,
               snapshot_id, source_type, linked_at_ms
             ) VALUES (?, 'store_fixture', 'record_fixture',
               'source_row_fixture', 'snapshot_fixture',
               'LOCALDATA', 0)`
          )
          .run(crypto.randomUUID());
      insertSourceLink();
      expect(insertSourceLink).toThrow();

      const insertPublish = (publishId: string) =>
        handle.client
          .prepare(
            `INSERT INTO data_publish (
               publish_id, input_snapshot_id, normalization_version,
               matcher_version, eligibility_version, status,
               candidate_count, published_count, excluded_count,
               admin_review_count, published_at_ms
             ) VALUES (?, 'snapshot_fixture',
               'store-normalization-v1', 'store-matcher-v1',
               'store-eligibility-v1', 'SUCCEEDED', 1, 1, 0, 0, 0)`
          )
          .run(publishId);
      insertPublish("publish_fixture");
      expect(() => insertPublish("publish_duplicate")).toThrow();
    } finally {
      handle.close();
    }
  });
});
