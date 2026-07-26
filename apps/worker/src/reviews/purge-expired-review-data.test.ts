import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeExpiredReviewData } from "./purge-expired-review-data.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createDatabase(): Promise<RawDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-purge-")
  );
  cleanupPaths.push(directory);
  const database = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateRawDatabase(database, resolve("drizzle/raw"));
  seedExpiringData(database);
  return database;
}

function seedExpiringData(database: RawDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'discovery_fixture', '빵집', 'SEOUL', '제과,베이커리',
         'COMPLETE', NULL, 'policy_fixture', 0, 1, ?
       )`
    )
    .run(400 * DAY_MS);
  database.client
    .prepare(
      `INSERT INTO kakao_place_observation (
         observation_id, run_id, observation_key, display_name,
         normalized_name, category_name, category_tag, road_address,
         lot_address, phone, latitude_e7, longitude_e7, tile_key,
         page_number, match_status, matched_store_id, match_signals_json,
         observed_at_ms, expires_at_ms
       ) VALUES (
         'observation_fixture', 'discovery_fixture', ?, 'Fixture',
         'fixture', '제과,베이커리', '제과,베이커리',
         '서울특별시 마포구 Fixture로 1', NULL, NULL,
         375600000, 1269000000, '0', 1, 'MATCHED_ELIGIBLE',
         'store_fixture', '{}', 0, ?
       )`
    )
    .run(Buffer.alloc(32, 1), 400 * DAY_MS);
  database.client
    .prepare(
      `INSERT INTO kakao_place_locator (
         locator_id, observation_id, provider, place_id, place_url,
         created_at_ms, delete_by_ms
       ) VALUES (
         'locator_fixture', 'observation_fixture', 'KAKAO',
         'place_fixture', 'https://place.map.kakao.com/place_fixture',
         0, ?
       )`
    )
    .run(30 * DAY_MS);
  database.client
    .prepare(
      `INSERT INTO review_collection_run (
         run_id, discovery_run_id, catalog_snapshot_id,
         policy_snapshot_id, selector_contract_version, status,
         active_slot, store_count, collected_count, duplicate_count,
         rejected_pii_count, failed_store_count, started_at_ms,
         finished_at_ms, expires_at_ms
       ) VALUES (
         'reviews_fixture', 'discovery_fixture', 'catalog_fixture',
         'policy_fixture', 'selector-v1', 'SUCCEEDED', NULL,
         1, 1, 0, 0, 0, 0, 1, ?
       )`
    )
    .run(400 * DAY_MS);
  database.client
    .prepare(
      `INSERT INTO raw_review_ciphertext (
         review_id, run_id, observation_id, store_id, provider,
         ciphertext, nonce, auth_tag, key_version, aad_version,
         fingerprint, collected_at_ms, retention_until_ms
       ) VALUES (
         'review_fixture', 'reviews_fixture', 'observation_fixture',
         'store_fixture', 'KAKAO_MAP', ?, ?, ?, 'key-v1', 'aad-v1',
         ?, 0, ?
       )`
    )
    .run(
      Buffer.from("cipher"),
      Buffer.alloc(12, 1),
      Buffer.alloc(16, 2),
      Buffer.alloc(32, 3),
      30 * DAY_MS
    );
  database.client
    .prepare(
      `INSERT INTO review_checkpoint (
         checkpoint_id, run_id, observation_id, store_id, page_number,
         page_cursor, last_fingerprint, state, committed_at_ms,
         expires_at_ms
       ) VALUES (
         'checkpoint_fixture', 'reviews_fixture',
         'observation_fixture', 'store_fixture', 0, 'final', NULL,
         'COMPLETE', 1, ?
       )`
    )
    .run(400 * DAY_MS);
}

function counts(database: RawDatabaseHandle): {
  reviews: number;
  locators: number;
  observations: number;
} {
  const result = database.client
    .prepare(
      `SELECT
         (SELECT count(*) FROM raw_review_ciphertext) AS reviews,
         (SELECT count(*) FROM kakao_place_locator) AS locators,
         (SELECT count(*) FROM kakao_place_observation) AS observations`
    )
    .get() as {
    reviews: number;
    locators: number;
    observations: number;
  };
  return result;
}

describe("expired raw review purge", () => {
  it("deletes at exact 30-day and 400-day boundaries", async () => {
    const database = await createDatabase();

    try {
      await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_before_30",
        nowMs: 30 * DAY_MS - 1
      });
      expect(counts(database)).toEqual({
        reviews: 1,
        locators: 1,
        observations: 1
      });

      await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_at_30",
        nowMs: 30 * DAY_MS
      });
      expect(counts(database)).toEqual({
        reviews: 0,
        locators: 0,
        observations: 1
      });

      await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_before_400",
        nowMs: 400 * DAY_MS - 1
      });
      expect(counts(database).observations).toBe(1);

      const result = await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_at_400",
        nowMs: 400 * DAY_MS
      });
      expect(result.status).toBe("SUCCEEDED");
      expect(counts(database).observations).toBe(0);
      expect(
        database.client
          .prepare(
            `SELECT attempted_count, deleted_count, failed_count, status
               FROM raw_delete_audit
              WHERE delete_run_id = 'purge_at_400'`
          )
          .get()
      ).toEqual({
        attempted_count: 2,
        deleted_count: 2,
        failed_count: 0,
        status: "SUCCEEDED"
      });
    } finally {
      database.close();
    }
  });

  it("records a safe failed audit and activates the kill switch", async () => {
    const database = await createDatabase();
    const onKillSwitch = vi.fn();

    try {
      const result = await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_failed",
        nowMs: 30 * DAY_MS,
        beforeDelete: () => {
          throw new Error("private row detail");
        },
        onKillSwitch
      });

      expect(result).toMatchObject({
        status: "FAILED_FINAL",
        killSwitchActivated: true
      });
      expect(onKillSwitch).toHaveBeenCalledWith(
        "RAW_DELETE_FAILED"
      );
      expect(String(result)).not.toContain("private row detail");
      expect(
        database.client
          .prepare(
            `SELECT status
               FROM raw_delete_audit
              WHERE delete_run_id = 'purge_failed'`
          )
          .get()
      ).toEqual({ status: "FAILED" });
      expect(counts(database)).toEqual({
        reviews: 1,
        locators: 1,
        observations: 1
      });
    } finally {
      database.close();
    }
  });

  it("still activates the kill switch when the failure audit cannot be written", async () => {
    const database = await createDatabase();
    const onKillSwitch = vi.fn();

    try {
      database.client
        .prepare(
          `INSERT INTO raw_delete_audit (
             delete_run_id, cutoff_at_ms, attempted_count,
             deleted_count, failed_count, status, started_at_ms,
             finished_at_ms, expires_at_ms
           ) VALUES (
             'purge_conflict', 0, 0, 0, 0, 'SUCCEEDED',
             0, 0, ?
           )`
        )
        .run(400 * DAY_MS);

      const result = await purgeExpiredReviewData({
        rawDatabase: database,
        deleteRunId: "purge_conflict",
        nowMs: 30 * DAY_MS,
        onKillSwitch
      });

      expect(result).toMatchObject({
        status: "FAILED_FINAL",
        killSwitchActivated: true
      });
      expect(onKillSwitch).toHaveBeenCalledWith(
        "RAW_DELETE_FAILED"
      );
      expect(counts(database)).toEqual({
        reviews: 1,
        locators: 1,
        observations: 1
      });
    } finally {
      database.close();
    }
  });
});
