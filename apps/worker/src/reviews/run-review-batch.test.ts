import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewSecrets } from "./review-secrets.js";
import { persistSuccessfulStoreSync } from "./review-sync-state.js";
import {
  runReviewBatch,
  StoreReviewCollectionError,
  type ReviewBatchTarget
} from "./run-review-batch.js";

const cleanupPaths: string[] = [];
const secrets: ReviewSecrets = {
  encryptionKey: Buffer.alloc(32, 1),
  hmacKey: Buffer.alloc(32, 2),
  keyVersion: "key-v1"
};

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createDatabase(): Promise<RawDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-batch-")
  );
  cleanupPaths.push(directory);
  const database = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateRawDatabase(database, resolve("drizzle/raw"));
  seedTargets(database);
  return database;
}

function seedTargets(database: RawDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'discovery_fixture', '빵집', 'SEOUL', '제과,베이커리',
         'COMPLETE', NULL, 'policy_fixture', 0, 1, 34560000000
       )`
    )
    .run();
  for (let index = 1; index <= 3; index += 1) {
    database.client
      .prepare(
        `INSERT INTO kakao_place_observation (
           observation_id, run_id, observation_key, display_name,
           normalized_name, category_name, category_tag, road_address,
           lot_address, phone, latitude_e7, longitude_e7, tile_key,
           page_number, match_status, matched_store_id,
           match_signals_json, observed_at_ms, expires_at_ms
         ) VALUES (
           ?, 'discovery_fixture', ?, ?, ?, '제과,베이커리',
           '제과,베이커리', ?, NULL, NULL, ?, ?, '0', 1,
           'MATCHED_ELIGIBLE', ?, '{}', 0, 34560000000
         )`
      )
      .run(
        `observation_${index}`,
        Buffer.alloc(32, index),
        `Fixture ${index}`,
        `fixture${index}`,
        `서울특별시 마포구 Fixture로 ${index}`,
        375600000 + index,
        1269000000 + index,
        `store_${index}`
      );
    database.client
      .prepare(
        `INSERT INTO kakao_place_locator (
           locator_id, observation_id, provider, place_id, place_url,
           created_at_ms, delete_by_ms
         ) VALUES (?, ?, 'KAKAO', ?, ?, 0, 2592000000)`
      )
      .run(
        `locator_${index}`,
        `observation_${index}`,
        `place_${index}`,
        `https://place.map.kakao.com/place_${index}`
      );
  }
}

describe("review batch", () => {
  it("continues a failed store, stops on CAPTCHA and leaves later stores pending", async () => {
    const database = await createDatabase();
    const called: string[] = [];

    try {
      const result = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_fixture",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        collectStoreImpl: async (target) => {
          called.push(target.storeId);
          if (target.storeId === "store_1") {
            throw new StoreReviewCollectionError();
          }
          if (target.storeId === "store_2") {
            return {
              status: "STOP_PROVIDER",
              reasonCode: "CAPTCHA",
              mode: "INITIAL_BACKFILL",
              collectedCount: 0,
              duplicateCount: 0,
              rejectedPiiCount: 0
            };
          }
          throw new Error("later store must remain pending");
        }
      });

      expect(result).toMatchObject({
        status: "STOPPED_ACCESS",
        storeCount: 3,
        failedStoreCount: 1
      });
      expect(called).toEqual(["store_1", "store_2"]);
      expect(
        database.client
          .prepare(
            `SELECT store_id, state
               FROM review_checkpoint
              WHERE run_id = 'reviews_fixture'
                AND page_number = 0
              ORDER BY store_id`
          )
          .all()
      ).toEqual([
        { store_id: "store_1", state: "FAILED_STORE" },
        { store_id: "store_2", state: "STOPPED_PROVIDER" },
        { store_id: "store_3", state: "PENDING" }
      ]);
    } finally {
      database.close();
    }
  });

  it("resumes a paused batch without collecting a completed store again", async () => {
    const database = await createDatabase();
    const firstCalls: string[] = [];
    let pause = false;

    try {
      const paused = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_resume",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        shouldPauseOperator: () => pause,
        collectStoreImpl: async (target: ReviewBatchTarget) => {
          firstCalls.push(target.storeId);
          pause = true;
          return {
            status: "COMPLETE",
            mode: "INITIAL_BACKFILL",
            collectedCount: 1,
            duplicateCount: 0,
            rejectedPiiCount: 0
          };
        }
      });
      expect(paused.status).toBe("PAUSED_OPERATOR");
      expect(firstCalls).toEqual(["store_1"]);
      expect(
        database.client
          .prepare(
            `SELECT active_slot, finished_at_ms
               FROM review_collection_run
              WHERE run_id = 'reviews_resume'`
          )
          .get()
      ).toEqual({ active_slot: null, finished_at_ms: null });

      const resumedCalls: string[] = [];
      const resumed = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_resume",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 2_000,
        collectStoreImpl: async (target) => {
          resumedCalls.push(target.storeId);
          return {
            status: "COMPLETE",
            mode: "INITIAL_BACKFILL",
            collectedCount: 1,
            duplicateCount: 0,
            rejectedPiiCount: 0
          };
        }
      });

      expect(resumed.status).toBe("SUCCEEDED");
      expect(resumedCalls).toEqual(["store_2", "store_3"]);
      expect(resumed.collectedCount).toBe(3);
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
               FROM kakao_place_locator`
          )
          .get()
      ).toEqual({ count: 0 });

      const completedCalls: string[] = [];
      const repeated = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_resume",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 3_000,
        collectStoreImpl: async (target) => {
          completedCalls.push(target.storeId);
          throw new Error("completed run must not collect again");
        }
      });

      expect(repeated).toEqual(resumed);
      expect(completedCalls).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("pauses the run budget without finishing or advancing pending stores", async () => {
    const database = await createDatabase();

    try {
      const paused = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_budget",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        collectStoreImpl: async () => ({
          status: "PAUSED_BUDGET",
          mode: "INITIAL_BACKFILL",
          collectedCount: 1,
          duplicateCount: 0,
          rejectedPiiCount: 0
        })
      });

      expect(paused.status).toBe("PAUSED_BUDGET");
      expect(
        database.client
          .prepare(
            `SELECT active_slot, finished_at_ms
               FROM review_collection_run
              WHERE run_id = 'reviews_budget'`
          )
          .get()
      ).toEqual({ active_slot: null, finished_at_ms: null });
      expect(
        database.client
          .prepare(
            `SELECT store_id, state
               FROM review_checkpoint
              WHERE run_id = 'reviews_budget'
                AND page_number = 0
              ORDER BY store_id`
          )
          .all()
      ).toEqual([
        { store_id: "store_1", state: "RUNNING" },
        { store_id: "store_2", state: "PENDING" },
        { store_id: "store_3", state: "PENDING" }
      ]);
    } finally {
      database.close();
    }
  });

  it("tracks initial, incremental, and fallback stores exactly", async () => {
    const database = await createDatabase();
    for (const [index, storeId] of ["store_2", "store_3"].entries()) {
      persistSuccessfulStoreSync({
        rawDatabase: database,
        storeId,
        runId: "previous_run",
        mode: "INITIAL_BACKFILL",
        asOfDate: "2026-07-20",
        keyVersion: secrets.keyVersion,
        anchorFingerprint: Buffer.alloc(32, index + 1),
        anchorPublishedDate: "2026-07-19",
        completedAtMs: 100
      });
    }

    try {
      const summary = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_modes",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        collectStoreImpl: async (target) => ({
          status: "COMPLETE",
          mode:
            target.storeId === "store_1"
              ? "INITIAL_BACKFILL"
              : target.storeId === "store_2"
                ? "INCREMENTAL"
                : "BACKFILL_FALLBACK",
          collectedCount: 0,
          duplicateCount: 0,
          rejectedPiiCount: 0
        })
      });

      expect(summary).toMatchObject({
        status: "SUCCEEDED",
        initialBackfillStoreCount: 1,
        incrementalStoreCount: 1,
        backfillFallbackStoreCount: 1
      });
    } finally {
      database.close();
    }
  });

  it("finishes PARTIAL when a store fails but no provider stop occurs", async () => {
    const database = await createDatabase();
    const calls: string[] = [];

    try {
      const summary = await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_partial",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        collectStoreImpl: async (target) => {
          calls.push(target.storeId);
          if (target.storeId === "store_1") {
            throw new StoreReviewCollectionError();
          }
          return {
            status: "COMPLETE",
            mode: "INITIAL_BACKFILL",
            collectedCount: 0,
            duplicateCount: 0,
            rejectedPiiCount: 0
          };
        }
      });

      expect(summary).toMatchObject({
        status: "PARTIAL",
        failedStoreCount: 1
      });
      expect(calls).toEqual(["store_1", "store_2", "store_3"]);
    } finally {
      database.close();
    }
  });

  it("rejects a changed run budget on resume", async () => {
    const database = await createDatabase();

    try {
      await runReviewBatch({
        rawDatabase: database,
        runId: "reviews_conflict",
        discoveryRunId: "discovery_fixture",
        catalogSnapshotId: "catalog_fixture",
        policySnapshotId: "policy_fixture",
        selectorContractVersion: "kakao-review-dom-v2",
        asOfDate: "2026-07-29",
        runBudgetMs: 3_600_000,
        secrets,
        now: () => 1_000,
        shouldPauseOperator: () => true,
        collectStoreImpl: async () => {
          throw new Error("must pause before collection");
        }
      });

      await expect(
        runReviewBatch({
          rawDatabase: database,
          runId: "reviews_conflict",
          discoveryRunId: "discovery_fixture",
          catalogSnapshotId: "catalog_fixture",
          policySnapshotId: "policy_fixture",
          selectorContractVersion: "kakao-review-dom-v2",
          asOfDate: "2026-07-29",
          runBudgetMs: 3_600_001,
          secrets,
          now: () => 2_000,
          collectStoreImpl: async () => {
            throw new Error("conflict must stop first");
          }
        })
      ).rejects.toThrow("REVIEW_RUN_CONFLICT");
    } finally {
      database.close();
    }
  });
});
