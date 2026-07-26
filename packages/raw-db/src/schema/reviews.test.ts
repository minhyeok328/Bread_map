import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openRawDatabase } from "../database.js";
import { migrateRawDatabase } from "../migrate.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
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
    join(tmpdir(), "bread-map-review-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateRawDatabase(handle, resolve("drizzle/raw"));
  return handle;
}

function insertDiscoveryRun(
  client: Database.Database,
  runId: string,
  activeSlot: number | null
): void {
  client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (?, '빵집', 'SEOUL', '제과,베이커리', 'RUNNING', ?,
         'policy_fixture', 0, NULL, 34560000000)`
    )
    .run(runId, activeSlot);
}

function seedReviewLineage(client: Database.Database): void {
  insertDiscoveryRun(client, "discovery_fixture", null);
  client
    .prepare(
      `INSERT INTO kakao_place_observation (
         observation_id, run_id, observation_key, display_name,
         normalized_name, category_name, category_tag, road_address,
         lot_address, phone, latitude_e7, longitude_e7, tile_key,
         page_number, match_status, matched_store_id, match_signals_json,
         observed_at_ms, expires_at_ms
       ) VALUES (
         'observation_fixture', 'discovery_fixture', ?,
         'Fixture Bakery', 'fixturebakery',
         '음식점 > 간식 > 제과,베이커리', '제과,베이커리',
         '서울특별시 마포구 월드컵로 1', NULL, NULL,
         375600000, 1269000000, 'tile_fixture', 1,
         'MATCHED_ELIGIBLE', 'store_fixture', '{}', 0, 34560000000
       )`
    )
    .run(Buffer.alloc(32, 1));
  client
    .prepare(
      `INSERT INTO review_collection_run (
         run_id, discovery_run_id, catalog_snapshot_id,
         policy_snapshot_id, selector_contract_version, status,
         active_slot, store_count, collected_count, duplicate_count,
         rejected_pii_count, failed_store_count, started_at_ms,
         finished_at_ms, expires_at_ms
       ) VALUES (
         'reviews_fixture', 'discovery_fixture', 'catalog_fixture',
         'policy_fixture', 'selector-v1', 'RUNNING', 1, 1, 0, 0, 0, 0,
         0, NULL, 34560000000
       )`
    )
    .run();
}

interface RawReviewInsert {
  reviewId: string;
  nonce: Buffer;
  authTag: Buffer;
  fingerprint: Buffer;
}

function insertRawReview(
  client: Database.Database,
  input: RawReviewInsert
): void {
  client
    .prepare(
      `INSERT INTO raw_review_ciphertext (
         review_id, run_id, observation_id, store_id, provider,
         ciphertext, nonce, auth_tag, key_version, aad_version,
         fingerprint, collected_at_ms, retention_until_ms
       ) VALUES (
         ?, 'reviews_fixture', 'observation_fixture', 'store_fixture',
         'KAKAO_MAP', ?, ?, ?, 'key-v1', 'aad-v1', ?, 0, ?
       )`
    )
    .run(
      input.reviewId,
      Buffer.from("ciphertext"),
      input.nonce,
      input.authTag,
      input.fingerprint,
      THIRTY_DAYS_MS
    );
}

describe("Feature 4 raw schema", () => {
  it("creates every discovery and encrypted review table idempotently", async () => {
    const handle = await createMigratedDatabase();

    try {
      migrateRawDatabase(handle, resolve("drizzle/raw"));
      const tableNames = handle.client
        .prepare(
          `SELECT name
             FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
              AND name != '__drizzle_migrations'
            ORDER BY name`
        )
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "kakao_discovery_run",
          "kakao_place_observation",
          "kakao_place_locator",
          "review_collection_run",
          "review_checkpoint",
          "raw_review_ciphertext",
          "deidentification_failure",
          "raw_delete_audit"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("allows only one active discovery run", async () => {
    const handle = await createMigratedDatabase();

    try {
      insertDiscoveryRun(handle.client, "discovery_one", 1);
      expect(() =>
        insertDiscoveryRun(handle.client, "discovery_two", 1)
      ).toThrow();
    } finally {
      handle.close();
    }
  });

  it("limits temporary locators to thirty days", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedReviewLineage(handle.client);
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO kakao_place_locator (
               locator_id, observation_id, provider, place_id, place_url,
               created_at_ms, delete_by_ms
             ) VALUES (
               'locator_invalid', 'observation_fixture', 'KAKAO',
               'place_fixture', 'https://place.map.kakao.com/fixture',
               0, ?
             )`
          )
          .run(THIRTY_DAYS_MS + 1)
      ).toThrow();
    } finally {
      handle.close();
    }
  });

  it("enforces AES-GCM metadata lengths and store-scoped deduplication", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedReviewLineage(handle.client);

      expect(() =>
        insertRawReview(handle.client, {
          reviewId: "review_bad_nonce",
          nonce: Buffer.alloc(11),
          authTag: Buffer.alloc(16),
          fingerprint: Buffer.alloc(32, 1)
        })
      ).toThrow();
      expect(() =>
        insertRawReview(handle.client, {
          reviewId: "review_bad_tag",
          nonce: Buffer.alloc(12, 1),
          authTag: Buffer.alloc(15),
          fingerprint: Buffer.alloc(32, 2)
        })
      ).toThrow();
      expect(() =>
        insertRawReview(handle.client, {
          reviewId: "review_bad_fingerprint",
          nonce: Buffer.alloc(12, 2),
          authTag: Buffer.alloc(16),
          fingerprint: Buffer.alloc(31)
        })
      ).toThrow();

      insertRawReview(handle.client, {
        reviewId: "review_first",
        nonce: Buffer.alloc(12, 3),
        authTag: Buffer.alloc(16),
        fingerprint: Buffer.alloc(32, 4)
      });
      expect(() =>
        insertRawReview(handle.client, {
          reviewId: "review_duplicate",
          nonce: Buffer.alloc(12, 5),
          authTag: Buffer.alloc(16),
          fingerprint: Buffer.alloc(32, 4)
        })
      ).toThrow();
    } finally {
      handle.close();
    }
  });
});
