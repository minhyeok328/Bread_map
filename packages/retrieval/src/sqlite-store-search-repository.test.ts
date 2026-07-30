import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteStoreSearchRepository
} from "./sqlite-store-search-repository.js";
import { StoreSearchError } from "./store-search-repository.js";

const cleanupPaths: string[] = [];
const requestTimeMs = Date.parse("2026-08-29T12:00:00+09:00");

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createFixtureDatabase(): Promise<AppDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-store-search-")
  );
  cleanupPaths.push(directory);
  const database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedFixture(database);
  return database;
}

function seedFixture(database: AppDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO source_catalog (
         source_id, source_key, official_url, required_fields_json,
         terms_checked_at_ms, created_at_ms
       ) VALUES ('source_fixture', 'fixture', 'https://example.test',
         '[]', 1, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO source_snapshot (
         snapshot_id, source_id, sha256, byte_size, basis_date,
         downloaded_at_ms, adapter_version, local_path_hint
       ) VALUES ('snapshot_active', 'source_fixture', ?, 1,
         '2026-07-30', 100, 'fixture-v1', NULL)`
    )
    .run(Buffer.alloc(32, 1));
  const insertSourceRow = database.client.prepare(
    `INSERT INTO source_snapshot_row (
       source_row_id, snapshot_id, page_no, row_index,
       source_row_key, payload_json, payload_sha256, created_at_ms
     ) VALUES (?, 'snapshot_active', 1, ?, ?, '{}', ?, 1)`
  );
  const insertRecord = database.client.prepare(
    `INSERT INTO localdata_bakery_record (
       record_id, snapshot_id, source_row_id, mng_no,
       open_authority_group_code, permit_date,
       business_status_code, business_status_name,
       detailed_business_status_code, detailed_business_status_name,
       closed_date, business_name, road_name_address,
       lot_number_address, source_coordinate_x, source_coordinate_y,
       data_updated_at_ms, last_modified_at_ms, staged_at_ms
     ) VALUES (?, 'snapshot_active', ?, ?, '6110000', NULL, '01',
       '영업/정상', '01', '영업', NULL, ?,
       '서울특별시 마포구 월드컵로 1', NULL, '191234.125',
       '451234.5', NULL, NULL, 1)`
  );
  for (const [index, storeId] of ["store_a", "store_b"].entries()) {
    const sourceRowId = `source_row_${storeId}`;
    insertSourceRow.run(
      sourceRowId,
      index,
      `SEOUL-${index}`,
      Buffer.alloc(32, index + 2)
    );
    insertRecord.run(
      `record_${storeId}`,
      sourceRowId,
      `SEOUL-${index}`,
      `Fixture ${storeId}`
    );
  }

  for (const [index, storeId] of [
    "store_b",
    "store_a",
    "store_not_in_snapshot"
  ].entries()) {
    const bakeryId = `bakery_${storeId}`;
    database.client
      .prepare(
        `INSERT INTO bakery (
           bakery_id, display_name, normalized_name, catalog_status,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 'published', 1, 1)`
      )
      .run(bakeryId, `Fixture ${storeId}`, storeId);
    database.client
      .prepare(
        `INSERT INTO store (
           store_id, bakery_id, display_name, normalized_name,
           normalized_brand_name, normalized_address, seoul_district,
           normalized_phone, latitude_e7, longitude_e7,
           business_status, catalog_status, latest_verified_at_ms,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?,
           '마포구', ?, ?, ?, 'active', 'published', ?, 1, 1)`
      )
      .run(
        storeId,
        bakeryId,
        `Fixture ${storeId}`,
        storeId,
        storeId,
        `서울특별시 마포구 월드컵로 ${index + 1}`,
        index === 1 ? "0212345678" : null,
        375634614 + index * 1000,
        1269014494 + index * 1000,
        100 + index
      );
  }
  const insertLink = database.client.prepare(
    `INSERT INTO store_source_link (
       link_id, store_id, source_record_id, source_row_id,
       snapshot_id, source_type, linked_at_ms
     ) VALUES (?, ?, ?, ?, 'snapshot_active', 'LOCALDATA', 1)`
  );
  for (const storeId of ["store_a", "store_b"]) {
    insertLink.run(
      `link_${storeId}`,
      storeId,
      `record_${storeId}`,
      `source_row_${storeId}`
    );
  }

  database.client
    .prepare(
      `INSERT INTO data_publish (
         publish_id, input_snapshot_id, normalization_version,
         matcher_version, eligibility_version, status,
         candidate_count, published_count, excluded_count,
         admin_review_count, published_at_ms
       ) VALUES ('publish_active', 'snapshot_active',
         'store-normalization-v1', 'store-matcher-v1',
         'store-eligibility-v1', 'SUCCEEDED', 2, 2, 0, 0, 100)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO catalog_publish_state (
         state_id, publish_id, snapshot_id, source_basis_date,
         source_downloaded_at_ms, updated_at_ms
       ) VALUES ('active', 'publish_active', 'snapshot_active',
         '2026-07-30', 100, 100)`
    )
    .run();

  database.client
    .prepare(
      `INSERT INTO search_evidence_publish (
         publish_id, input_catalog_publish_id, contract_version,
         status, active_slot, menu_count, store_alias_count,
         menu_alias_count, business_hour_count, corpus_checksum,
         published_at_ms
       ) VALUES ('evidence_active', 'publish_active',
         'search-evidence-v1', 'BUILDING', NULL, 2, 2, 1, 2, ?, 200)`
    )
    .run("b".repeat(64));
  const insertMenu = database.client.prepare(
    `INSERT INTO menu (
       menu_id, evidence_publish_id, store_id, name, normalized_name,
       category, source, evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_active', ?, ?, ?, ?,
       'MANUAL_VERIFIED', ?, 200)`
  );
  insertMenu.run(
    "menu_b",
    "store_b",
    "크루아상",
    "크루아상",
    "PASTRY",
    "fixture://menu/b"
  );
  insertMenu.run(
    "menu_a",
    "store_a",
    "소금빵",
    "소금빵",
    "SALT_BREAD",
    "fixture://menu/a"
  );
  database.client
    .prepare(
      `INSERT INTO menu_alias (
         alias_id, menu_id, alias, normalized_alias, source,
         evidence_ref, verified_at_ms
       ) VALUES ('menu_alias_a', 'menu_a', '시오빵', '시오빵',
         'MANUAL_VERIFIED', 'fixture://menu-alias/a', 200)`
    )
    .run();
  const insertStoreAlias = database.client.prepare(
    `INSERT INTO store_alias (
       alias_id, evidence_publish_id, store_id, alias_type, alias,
       normalized_alias, source, evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_active', ?, ?, ?, ?,
       'MANUAL_VERIFIED', ?, 200)`
  );
  insertStoreAlias.run(
    "store_alias_b",
    "store_b",
    "STORE_NAME",
    "비베이커리",
    "비베이커리",
    "fixture://store-alias/b"
  );
  insertStoreAlias.run(
    "store_alias_a",
    "store_a",
    "REGION",
    "홍대입구",
    "홍대입구",
    "fixture://store-alias/a"
  );
  const insertHour = database.client.prepare(
    `INSERT INTO store_business_hour (
       interval_id, evidence_publish_id, store_id, weekday, sequence,
       opens_minute, closes_minute, closes_next_day, source,
       evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_active', ?, 6, 0, 600, 1080, 0,
       'MANUAL_VERIFIED', ?, 200)`
  );
  insertHour.run(
    "hours_b",
    "store_b",
    "fixture://hours/b"
  );
  insertHour.run(
    "hours_a",
    "store_a",
    "fixture://hours/a"
  );
  database.client
    .prepare(
      `UPDATE search_evidence_publish
       SET status = 'ACTIVE', active_slot = 1
       WHERE publish_id = 'evidence_active'`
    )
    .run();

  database.client
    .prepare(
      `INSERT INTO review_publish_version (
         version_id, source_run_id, source_run_status,
         source_as_of_date, status, active_slot, document_count,
         fts_document_count, corpus_checksum, published_at_ms
       ) VALUES ('review_active', 'run_active', 'SUCCEEDED',
         '2026-07-30', 'ACTIVE', 1, 5, 5, ?, 300)`
    )
    .run("c".repeat(64));
  const insertReview = database.client.prepare(
    `INSERT INTO review_document (
       review_id, store_id, provider, body, normalized_body,
       rating_basis_points, published_date, collected_at_ms,
       source_run_id, publish_version_id
     ) VALUES (?, ?, 'KAKAO_MAP', ?, ?, ?, ?, 300,
       'run_active', 'review_active')`
  );
  for (const row of [
    ["review_a_1", "store_a", "소금빵 맛집", "소금빵 맛집", 4500, "2026-07-30"],
    ["review_a_2", "store_a", "시오빵 추천", "시오빵 추천", 4000, "2026-07-29"],
    ["review_a_3", "store_a", "빵이 좋아요", "빵 좋아요", null, "2026-07-28"],
    ["review_b_1", "store_b", "크루아상 맛집", "크루아상 맛집", 5000, "2026-07-27"],
    ["review_b_2", "store_b", "페이스트리", "페이스트리", 4500, "2026-07-26"]
  ] as const) {
    insertReview.run(...row);
  }
  database.client
    .prepare(
      `INSERT INTO fts_index_state (
         state_id, index_version, publish_version_id, status,
         active_slot, document_count, corpus_checksum, built_at_ms
       ) VALUES ('fts_active', 'review-fts-unicode61-v1',
         'review_active', 'ACTIVE', 1, 5, ?, 300)`
    )
    .run("c".repeat(64));
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("expected operation to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(StoreSearchError);
    expect(error).toMatchObject({ code, message: code });
    expect(String(error)).not.toMatch(
      /app\.sqlite|SELECT|catalog_publish_state/
    );
  }
}

describe("SqliteStoreSearchRepository", () => {
  it("loads one stable active-snapshot candidate graph", async () => {
    const database = await createFixtureDatabase();
    try {
      const repository =
        createSqliteStoreSearchRepository(database);
      const descriptor =
        repository.inspectCurrentSnapshot(requestTimeMs);

      expect(descriptor).toMatchObject({
        dataSnapshotVersion: expect.stringMatching(
          /^search-data-v1_[0-9a-f]{64}$/
        ),
        catalogPublishId: "publish_active",
        catalogSnapshotId: "snapshot_active",
        sourceBasisDate: "2026-07-30",
        searchEvidencePublishId: "evidence_active",
        reviewPublishVersionId: "review_active"
      });

      const snapshot = repository.loadSnapshot({
        expectedDataSnapshotVersion:
          descriptor.dataSnapshotVersion,
        requestTimeMs
      });
      expect(snapshot.descriptor).toEqual(descriptor);
      expect(
        snapshot.candidates.map((candidate) => candidate.storeId)
      ).toEqual(["store_a", "store_b"]);
      expect(snapshot.candidates[0]).toMatchObject({
        storeId: "store_a",
        menus: [
          {
            menuId: "menu_a",
            normalizedName: "소금빵",
            evidenceId: "menu_a",
            aliases: [
              {
                aliasId: "menu_alias_a",
                normalizedAlias: "시오빵",
                evidenceId: "menu_alias_a"
              }
            ]
          }
        ],
        storeAliases: [
          {
            aliasId: "store_alias_a",
            normalizedAlias: "홍대입구",
            evidenceId: "store_alias_a"
          }
        ],
        businessHours: [
          {
            intervalId: "hours_a",
            weekday: 6,
            evidenceId: "hours_a"
          }
        ],
        reviewAggregate: {
          count: 3,
          latestPublishedDate: "2026-07-30",
          ratedCount: 2,
          ratingSumBasisPoints: 8500
        }
      });
      expect(
        snapshot.candidates.some(
          (candidate) =>
            candidate.storeId === "store_not_in_snapshot"
        )
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it("requires the complete current data version", async () => {
    const database = await createFixtureDatabase();
    try {
      const repository =
        createSqliteStoreSearchRepository(database);
      const before =
        repository.inspectCurrentSnapshot(requestTimeMs);

      database.client
        .prepare(
          `UPDATE search_evidence_publish
           SET status = 'SUPERSEDED', active_slot = NULL
           WHERE publish_id = 'evidence_active'`
        )
        .run();
      database.client
        .prepare(
          `INSERT INTO search_evidence_publish (
             publish_id, input_catalog_publish_id, contract_version,
             status, active_slot, menu_count, store_alias_count,
             menu_alias_count, business_hour_count, corpus_checksum,
             published_at_ms
           ) VALUES ('evidence_next', 'publish_active',
             'search-evidence-v1', 'ACTIVE', 1, 0, 0, 0, 0, ?, 400)`
        )
        .run("d".repeat(64));
      const after =
        repository.inspectCurrentSnapshot(requestTimeMs);

      expect(after.dataSnapshotVersion).not.toBe(
        before.dataSnapshotVersion
      );
      expectCode(
        () =>
          repository.loadSnapshot({
            expectedDataSnapshotVersion:
              before.dataSnapshotVersion,
            requestTimeMs
          }),
        "SEARCH_DATA_VERSION_MISMATCH"
      );
    } finally {
      database.close();
    }
  });

  it("versions active catalog facts and rejects pointer metadata drift", async () => {
    const database = await createFixtureDatabase();
    try {
      const repository =
        createSqliteStoreSearchRepository(database);
      const before =
        repository.inspectCurrentSnapshot(requestTimeMs);

      database.client
        .prepare(
          `UPDATE store
           SET display_name = '변경된 매장명'
           WHERE store_id = 'store_a'`
        )
        .run();
      const after =
        repository.inspectCurrentSnapshot(requestTimeMs);

      expect(after.dataSnapshotVersion).not.toBe(
        before.dataSnapshotVersion
      );
      expectCode(
        () =>
          repository.loadSnapshot({
            expectedDataSnapshotVersion:
              before.dataSnapshotVersion,
            requestTimeMs
          }),
        "SEARCH_DATA_VERSION_MISMATCH"
      );

      database.client
        .prepare(
          `UPDATE catalog_publish_state
           SET source_basis_date = '2026-07-29'`
        )
        .run();
      expectCode(
        () => repository.inspectCurrentSnapshot(requestTimeMs),
        "SEARCH_DATA_UNAVAILABLE"
      );
    } finally {
      database.close();
    }
  });

  it("keeps the version stable when only publisher clock metadata changes", async () => {
    const database = await createFixtureDatabase();
    try {
      const repository =
        createSqliteStoreSearchRepository(database);
      const before =
        repository.inspectCurrentSnapshot(requestTimeMs);

      database.client
        .prepare(
          `UPDATE store
           SET latest_verified_at_ms = latest_verified_at_ms + 1,
               updated_at_ms = updated_at_ms + 1
           WHERE store_id = 'store_a'`
        )
        .run();
      const after =
        repository.inspectCurrentSnapshot(requestTimeMs);

      expect(after.dataSnapshotVersion).toBe(
        before.dataSnapshotVersion
      );
    } finally {
      database.close();
    }
  });

  it("accepts exactly 30 source days and rejects older or future data", async () => {
    const database = await createFixtureDatabase();
    try {
      const repository =
        createSqliteStoreSearchRepository(database);
      expect(
        repository.inspectCurrentSnapshot(requestTimeMs)
          .sourceBasisDate
      ).toBe("2026-07-30");

      database.client
        .prepare(
          `UPDATE source_snapshot
           SET basis_date = '2026-07-29'
           WHERE snapshot_id = 'snapshot_active'`
        )
        .run();
      database.client
        .prepare(
          `UPDATE catalog_publish_state
           SET source_basis_date = '2026-07-29'
           WHERE snapshot_id = 'snapshot_active'`
        )
        .run();
      expectCode(
        () => repository.inspectCurrentSnapshot(requestTimeMs),
        "SEARCH_DATA_STALE"
      );

      database.client
        .prepare(
          `UPDATE source_snapshot
           SET basis_date = '2026-08-30'
           WHERE snapshot_id = 'snapshot_active'`
        )
        .run();
      database.client
        .prepare(
          `UPDATE catalog_publish_state
           SET source_basis_date = '2026-08-30'
           WHERE snapshot_id = 'snapshot_active'`
        )
        .run();
      expectCode(
        () => repository.inspectCurrentSnapshot(requestTimeMs),
        "SEARCH_DATA_STALE"
      );
    } finally {
      database.close();
    }
  });

  it("fails closed for missing state, inconsistent hours and database errors", async () => {
    const missingState = await createFixtureDatabase();
    try {
      missingState.client
        .prepare("DELETE FROM catalog_publish_state")
        .run();
      const repository =
        createSqliteStoreSearchRepository(missingState);
      expectCode(
        () => repository.inspectCurrentSnapshot(requestTimeMs),
        "SEARCH_DATA_UNAVAILABLE"
      );
    } finally {
      missingState.close();
    }

    const overlappingHours = await createFixtureDatabase();
    try {
      overlappingHours.client.exec(
        `DROP TRIGGER search_evidence_publish_metadata_immutable;
         DROP TRIGGER search_evidence_business_hour_count_guard;`
      );
      overlappingHours.client
        .prepare(
          `UPDATE search_evidence_publish
           SET business_hour_count = 3
           WHERE publish_id = 'evidence_active'`
        )
        .run();
      overlappingHours.client
        .prepare(
          `INSERT INTO store_business_hour (
             interval_id, evidence_publish_id, store_id, weekday,
             sequence, opens_minute, closes_minute, closes_next_day,
             source, evidence_ref, verified_at_ms
           ) VALUES ('hours_overlap', 'evidence_active', 'store_a',
             6, 1, 1000, 1200, 0, 'MANUAL_VERIFIED',
             'fixture://hours/overlap', 200)`
        )
        .run();
      const repository =
        createSqliteStoreSearchRepository(overlappingHours);
      const descriptor =
        repository.inspectCurrentSnapshot(requestTimeMs);
      expectCode(
        () =>
          repository.loadSnapshot({
            expectedDataSnapshotVersion:
              descriptor.dataSnapshotVersion,
            requestTimeMs
          }),
        "SEARCH_DATA_UNAVAILABLE"
      );
    } finally {
      overlappingHours.close();
    }

    const closed = await createFixtureDatabase();
    const repository =
      createSqliteStoreSearchRepository(closed);
    closed.close();
    expectCode(
      () => repository.inspectCurrentSnapshot(requestTimeMs),
      "SEARCH_DATABASE_UNAVAILABLE"
    );
  });
});
