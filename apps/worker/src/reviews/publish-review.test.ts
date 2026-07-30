import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import { createSqliteReviewRepository } from "@bread-map/retrieval";
import { afterEach, describe, expect, it } from "vitest";
import {
  encryptRawReview,
  type EncryptedReviewPayloadV1,
  type ReviewAadV1
} from "./encrypt-raw-review.js";
import {
  ReviewPublishError,
  assertStableReviewOwnership,
  publishReviewRun
} from "./publish-review.js";

const NOW_MS = Date.UTC(2026, 6, 30, 12);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOUR_HUNDRED_DAYS_MS = 400 * 24 * 60 * 60 * 1000;
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const KEY_VERSION = "review-key-v1";
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

interface FixtureDatabases {
  appDatabase: AppDatabaseHandle;
  rawDatabase: RawDatabaseHandle;
  close(): void;
}

async function createFixtureDatabases(): Promise<FixtureDatabases> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-publish-")
  );
  cleanupPaths.push(directory);
  const appDatabase = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  const rawDatabase = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateAppDatabase(appDatabase, resolve("drizzle/app"));
  migrateRawDatabase(rawDatabase, resolve("drizzle/raw"));
  return {
    appDatabase,
    rawDatabase,
    close() {
      rawDatabase.close();
      appDatabase.close();
    }
  };
}

function seedAppStore(
  appDatabase: AppDatabaseHandle,
  storeId: string,
  catalogStatus: "candidate" | "published" = "published"
): void {
  const bakeryId = `bakery_${storeId}`;
  appDatabase.client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, 0, 0)`
    )
    .run(bakeryId, storeId, storeId, catalogStatus);
  appDatabase.client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, '서울특별시 마포구 월드컵로 1',
         '마포구', NULL, 375634614, 1269014494, 'active', ?, 0, 0, 0)`
    )
    .run(
      storeId,
      bakeryId,
      storeId,
      storeId,
      storeId,
      catalogStatus
    );
}

interface RawReviewFixture {
  reviewId: string;
  storeId: string;
  body: string;
  publishedDate: string;
  ratingBasisPoints?: number | null;
  keyVersion?: string;
  retentionUntilMs?: number;
}

interface ReviewRunFixture {
  runId: string;
  status?: "SUCCEEDED" | "PARTIAL" | "RUNNING";
  asOfDate?: string;
  targetStoreIds: readonly string[];
  reviews?: readonly RawReviewFixture[];
  excludedObservationStoreIds?: readonly string[];
}

function observationId(runId: string, storeId: string): string {
  return `observation_${runId}_${storeId}`;
}

function seedRawReviewRun(
  rawDatabase: RawDatabaseHandle,
  input: ReviewRunFixture
): void {
  const discoveryRunId = `discovery_${input.runId}`;
  const status = input.status ?? "SUCCEEDED";
  const reviews = input.reviews ?? [];
  const excludedStores = new Set(
    input.excludedObservationStoreIds ?? []
  );

  rawDatabase.client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (?, '빵집', 'SEOUL', '제과,베이커리', 'COMPLETE', NULL,
         'policy_fixture', ?, ?, ?)`
    )
    .run(
      discoveryRunId,
      NOW_MS - 1000,
      NOW_MS - 500,
      NOW_MS + FOUR_HUNDRED_DAYS_MS
    );

  const insertObservation = rawDatabase.client.prepare(
    `INSERT INTO kakao_place_observation (
       observation_id, run_id, observation_key, display_name,
       normalized_name, category_name, category_tag, road_address,
       lot_address, phone, latitude_e7, longitude_e7, tile_key,
       page_number, match_status, matched_store_id, match_signals_json,
       observed_at_ms, expires_at_ms
     ) VALUES (?, ?, ?, ?, ?, '음식점 > 간식 > 제과,베이커리',
       '제과,베이커리', '서울특별시 마포구 월드컵로 1', NULL, NULL,
       375634614, 1269014494, 'tile_fixture', 1, ?, ?, '{}', ?, ?)`
  );
  for (const storeId of input.targetStoreIds) {
    insertObservation.run(
      observationId(input.runId, storeId),
      discoveryRunId,
      createHash("sha256")
        .update(`${input.runId}:${storeId}`)
        .digest(),
      storeId,
      storeId,
      excludedStores.has(storeId)
        ? "MATCHED_EXCLUDED"
        : "MATCHED_ELIGIBLE",
      storeId,
      NOW_MS - 500,
      NOW_MS + FOUR_HUNDRED_DAYS_MS
    );
  }

  const failedStoreCount = status === "PARTIAL" ? 1 : 0;
  rawDatabase.client
    .prepare(
      `INSERT INTO review_collection_run (
         run_id, discovery_run_id, catalog_snapshot_id,
         policy_snapshot_id, selector_contract_version, as_of_date,
         fingerprint_key_version, run_budget_ms, status, active_slot,
         store_count, initial_backfill_store_count,
         incremental_store_count, backfill_fallback_store_count,
         collected_count, duplicate_count, rejected_pii_count,
         failed_store_count, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (?, ?, 'catalog_fixture', 'policy_fixture',
         'selector-v2', ?, ?, 3600000, ?, NULL, ?, ?, 0, 0, ?,
         0, 0, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      discoveryRunId,
      input.asOfDate ?? "2026-07-30",
      KEY_VERSION,
      status,
      input.targetStoreIds.length,
      input.targetStoreIds.length,
      reviews.length,
      failedStoreCount,
      NOW_MS - 400,
      status === "RUNNING" ? null : NOW_MS - 100,
      NOW_MS + FOUR_HUNDRED_DAYS_MS
    );

  const insertRawReview = rawDatabase.client.prepare(
    `INSERT INTO raw_review_ciphertext (
       review_id, run_id, observation_id, store_id, provider,
       ciphertext, nonce, auth_tag, key_version, aad_version,
       fingerprint, collected_at_ms, retention_until_ms
     ) VALUES (?, ?, ?, ?, 'KAKAO_MAP', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const review of reviews) {
    const payload: EncryptedReviewPayloadV1 = {
      schemaVersion: 1,
      body: review.body,
      ratingBasisPoints:
        review.ratingBasisPoints === undefined
          ? 4500
          : review.ratingBasisPoints,
      publishedDate: review.publishedDate,
      provider: "KAKAO_MAP"
    };
    const aad: ReviewAadV1 = {
      reviewId: review.reviewId,
      storeId: review.storeId,
      provider: "KAKAO_MAP",
      schemaVersion: 1
    };
    const keyVersion = review.keyVersion ?? KEY_VERSION;
    const encrypted = encryptRawReview(
      payload,
      aad,
      ENCRYPTION_KEY,
      keyVersion
    );
    insertRawReview.run(
      review.reviewId,
      input.runId,
      observationId(input.runId, review.storeId),
      review.storeId,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
      encrypted.keyVersion,
      encrypted.aadVersion,
      createHash("sha256").update(review.reviewId).digest(),
      NOW_MS - 200,
      review.retentionUntilMs ??
        NOW_MS - 200 + THIRTY_DAYS_MS
    );
  }
}

function publish(
  databases: FixtureDatabases,
  runId: string,
  encryptionKeys: ReadonlyMap<string, Buffer> = new Map([
    [KEY_VERSION, ENCRYPTION_KEY]
  ])
) {
  return publishReviewRun({
    appDatabase: databases.appDatabase,
    rawDatabase: databases.rawDatabase,
    runId,
    encryptionKeys,
    now: () => NOW_MS
  });
}

function activeVersion(
  appDatabase: AppDatabaseHandle
): Record<string, unknown> | undefined {
  return appDatabase.client
    .prepare(
      `SELECT
         source_run_id AS sourceRunId,
         status,
         document_count AS documentCount,
         fts_document_count AS ftsDocumentCount
       FROM review_publish_version
      WHERE active_slot = 1`
    )
    .get() as Record<string, unknown> | undefined;
}

describe("review publisher", () => {
  it("publishes an encrypted deidentified review into the searchable active corpus", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_initial",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_a",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });

      const summary = publish(databases, "run_initial");
      const search = createSqliteReviewRepository(
        databases.appDatabase
      ).searchReviews({ text: "소금빵" });

      expect(summary).toMatchObject({
        sourceRunId: "run_initial",
        sourceRunStatus: "SUCCEEDED",
        sourceAsOfDate: "2026-07-30",
        documentCount: 1,
        ftsDocumentCount: 1,
        status: "ACTIVE",
        replayed: false
      });
      expect(summary.corpusChecksum).toMatch(/^[0-9a-f]{64}$/u);
      expect(search).toMatchObject({
        status: "AVAILABLE",
        hits: [
          {
            reviewId: "review_a",
            storeId: "store_a",
            body: "소금빵 바삭해요"
          }
        ]
      });
    } finally {
      databases.close();
    }
  });

  it("replays the same source run without adding a version or document", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_replay",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_a",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });

      const first = publish(databases, "run_replay");
      const replay = publish(databases, "run_replay");

      expect(replay).toEqual({ ...first, replayed: true });
      expect(
        databases.appDatabase.client
          .prepare(
            `SELECT
               (SELECT count(*) FROM review_publish_version)
                 AS versionCount,
               (SELECT count(*) FROM review_document)
                 AS documentCount,
               (SELECT count(*) FROM review_fts)
                 AS ftsCount`
          )
          .get()
      ).toEqual({
        versionCount: 1,
        documentCount: 1,
        ftsCount: 1
      });

      databases.appDatabase.client
        .prepare(
          "DELETE FROM review_fts WHERE review_id = 'review_a'"
        )
        .run();
      expect(() => publish(databases, "run_replay")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_FTS_INCONSISTENT"
        })
      );
    } finally {
      databases.close();
    }
  });

  it("merges incremental and partial runs without deleting current reviews for absent stores", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedAppStore(databases.appDatabase, "store_b");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_first",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_a",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_first");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_partial",
        status: "PARTIAL",
        targetStoreIds: ["store_a", "store_b"],
        reviews: [
          {
            reviewId: "review_b",
            storeId: "store_b",
            body: "크루아상 고소해요",
            publishedDate: "2026-07-21"
          }
        ]
      });

      const summary = publish(databases, "run_partial");
      const rows = databases.appDatabase.client
        .prepare(
          `SELECT review_id AS reviewId
             FROM review_document
            ORDER BY review_id`
        )
        .all();

      expect(summary).toMatchObject({
        sourceRunStatus: "PARTIAL",
        documentCount: 2
      });
      expect(rows).toEqual([
        { reviewId: "review_a" },
        { reviewId: "review_b" }
      ]);
    } finally {
      databases.close();
    }
  });

  it("publishes a valid raw row committed before its run counter checkpoint", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_counter_lag",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_counter_lag",
            storeId: "store_a",
            body: "바게트 담백해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      databases.rawDatabase.client
        .prepare(
          `UPDATE review_collection_run
              SET collected_count = 0
            WHERE run_id = 'run_counter_lag'`
        )
        .run();

      expect(publish(databases, "run_counter_lag")).toMatchObject({
        documentCount: 1,
        ftsDocumentCount: 1
      });
    } finally {
      databases.close();
    }
  });

  it("removes expired public documents and their FTS rows at the next publish cutoff", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_old",
        asOfDate: "2025-07-30",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_old",
            storeId: "store_a",
            body: "단팥빵 달콤해요",
            publishedDate: "2025-07-29"
          }
        ]
      });
      publish(databases, "run_old");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_cutoff",
        asOfDate: "2026-07-30",
        targetStoreIds: ["store_a"]
      });

      const summary = publish(databases, "run_cutoff");

      expect(summary).toMatchObject({
        documentCount: 0,
        ftsDocumentCount: 0
      });
      expect(
        databases.appDatabase.client
          .prepare(
            `SELECT
               (SELECT count(*) FROM review_document) AS documentCount,
               (SELECT count(*) FROM review_fts) AS ftsCount`
          )
          .get()
      ).toEqual({ documentCount: 0, ftsCount: 0 });
    } finally {
      databases.close();
    }
  });

  it("clamps a leap-day one-year cutoff to February 28", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_leap_cutoff",
        asOfDate: "2024-02-29",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_cutoff_day",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2023-02-28"
          },
          {
            reviewId: "review_before_cutoff",
            storeId: "store_a",
            body: "식빵 촉촉해요",
            publishedDate: "2023-02-27"
          }
        ]
      });

      expect(publish(databases, "run_leap_cutoff")).toMatchObject({
        documentCount: 1,
        ftsDocumentCount: 1
      });
      expect(
        databases.appDatabase.client
          .prepare(
            `SELECT review_id AS reviewId
               FROM review_document
              ORDER BY review_id`
          )
          .all()
      ).toEqual([{ reviewId: "review_cutoff_day" }]);
    } finally {
      databases.close();
    }
  });

  it("rolls back a missing key or tampered ciphertext without replacing the active version", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_safe",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_safe",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_safe");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_missing_key",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_missing_key",
            storeId: "store_a",
            body: "식빵 촉촉해요",
            publishedDate: "2026-07-21"
          }
        ]
      });

      expect(() =>
        publish(databases, "run_missing_key", new Map())
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_KEY_UNAVAILABLE"
        })
      );
      expect(activeVersion(databases.appDatabase)).toMatchObject({
        sourceRunId: "run_safe"
      });

      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_tampered",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_tampered",
            storeId: "store_a",
            body: "식빵 담백해요",
            publishedDate: "2026-07-22"
          }
        ]
      });
      databases.rawDatabase.client
        .prepare(
          `UPDATE raw_review_ciphertext
              SET auth_tag = ?
            WHERE review_id = 'review_tampered'`
        )
        .run(Buffer.alloc(16, 9));

      expect(() => publish(databases, "run_tampered")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_DECRYPT_FAILED"
        })
      );
      expect(activeVersion(databases.appDatabase)).toMatchObject({
        sourceRunId: "run_safe"
      });
      expect(
        databases.appDatabase.client
          .prepare(
            "SELECT review_id AS reviewId FROM review_document"
          )
          .all()
      ).toEqual([{ reviewId: "review_safe" }]);
    } finally {
      databases.close();
    }
  });

  it("rejects non-public stores, ineligible observations, and expired raw input before app writes", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(
        databases.appDatabase,
        "store_candidate",
        "candidate"
      );
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_candidate",
        targetStoreIds: ["store_candidate"],
        reviews: [
          {
            reviewId: "review_candidate",
            storeId: "store_candidate",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      expect(() => publish(databases, "run_candidate")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_STORE_NOT_PUBLIC"
        })
      );

      seedAppStore(databases.appDatabase, "store_excluded");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_excluded",
        targetStoreIds: ["store_excluded"],
        excludedObservationStoreIds: ["store_excluded"],
        reviews: [
          {
            reviewId: "review_excluded",
            storeId: "store_excluded",
            body: "크루아상 고소해요",
            publishedDate: "2026-07-21"
          }
        ]
      });
      expect(() => publish(databases, "run_excluded")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_INPUT_NOT_ELIGIBLE"
        })
      );

      seedAppStore(databases.appDatabase, "store_expired");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_expired",
        targetStoreIds: ["store_expired"],
        reviews: [
          {
            reviewId: "review_expired",
            storeId: "store_expired",
            body: "식빵 촉촉해요",
            publishedDate: "2026-07-22",
            retentionUntilMs: NOW_MS - 1
          }
        ]
      });
      expect(() => publish(databases, "run_expired")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_INPUT_EXPIRED"
        })
      );

      seedAppStore(databases.appDatabase, "store_key_mismatch");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_key_mismatch",
        targetStoreIds: ["store_key_mismatch"],
        reviews: [
          {
            reviewId: "review_key_mismatch",
            storeId: "store_key_mismatch",
            body: "바게트 담백해요",
            publishedDate: "2026-07-23",
            keyVersion: "review-key-v2"
          }
        ]
      });
      expect(() =>
        publish(
          databases,
          "run_key_mismatch",
          new Map([["review-key-v2", ENCRYPTION_KEY]])
        )
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_INPUT_KEY_VERSION_MISMATCH"
        })
      );

      seedAppStore(databases.appDatabase, "store_future");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_future_review",
        asOfDate: "2026-07-30",
        targetStoreIds: ["store_future"],
        reviews: [
          {
            reviewId: "review_future",
            storeId: "store_future",
            body: "단팥빵 달콤해요",
            publishedDate: "2026-07-31"
          }
        ]
      });
      expect(() =>
        publish(databases, "run_future_review")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_INPUT_INVALID"
        })
      );

      seedAppStore(databases.appDatabase, "store_missing_raw");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_missing_raw",
        targetStoreIds: ["store_missing_raw"],
        reviews: [
          {
            reviewId: "review_missing_raw",
            storeId: "store_missing_raw",
            body: "치아바타 담백해요",
            publishedDate: "2026-07-24"
          }
        ]
      });
      databases.rawDatabase.client
        .prepare(
          `DELETE FROM raw_review_ciphertext
            WHERE review_id = 'review_missing_raw'`
        )
        .run();
      expect(() =>
        publish(databases, "run_missing_raw")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_INPUT_INCOMPLETE"
        })
      );

      expect(
        databases.appDatabase.client
          .prepare(
            "SELECT count(*) AS count FROM review_publish_version"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      databases.close();
    }
  });

  it("rolls back a new version when existing FTS state is inconsistent", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_safe",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_safe_a",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          },
          {
            reviewId: "review_safe_b",
            storeId: "store_a",
            body: "크루아상 고소해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_safe");
      databases.appDatabase.client
        .exec(
          `CREATE TEMP TABLE corrupt_fts AS
             SELECT rowid, review_id, store_id, normalized_body
               FROM review_fts;
           DELETE FROM review_fts;
           INSERT INTO review_fts (
             rowid, review_id, store_id, normalized_body
           )
           SELECT
             CASE review_id
               WHEN 'review_safe_a' THEN (
                 SELECT rowid FROM corrupt_fts
                  WHERE review_id = 'review_safe_b'
               )
               ELSE (
                 SELECT rowid FROM corrupt_fts
                  WHERE review_id = 'review_safe_a'
               )
             END,
             review_id,
             store_id,
             normalized_body
           FROM corrupt_fts;`
        );
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_after_corruption",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_new",
            storeId: "store_a",
            body: "식빵 촉촉해요",
            publishedDate: "2026-07-21"
          }
        ]
      });

      expect(() =>
        publish(databases, "run_after_corruption")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_FTS_INCONSISTENT"
        })
      );
      expect(activeVersion(databases.appDatabase)).toMatchObject({
        sourceRunId: "run_safe"
      });
      expect(
        databases.appDatabase.client
          .prepare(
            `SELECT review_id AS reviewId
               FROM review_document
              ORDER BY review_id`
          )
          .all()
      ).toEqual([
        { reviewId: "review_safe_a" },
        { reviewId: "review_safe_b" }
      ]);
    } finally {
      databases.close();
    }
  });

  it("refuses to activate a corpus containing a non-public existing store", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_public",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_public",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_public");
      databases.appDatabase.client.exec(
        "DROP TRIGGER store_unpublish_reviews"
      );
      databases.appDatabase.client
        .prepare(
          `UPDATE store
              SET catalog_status = 'excluded'
            WHERE store_id = 'store_a'`
        )
        .run();
      expect(() => publish(databases, "run_public")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_STORE_NOT_PUBLIC"
        })
      );
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_after_unpublish",
        targetStoreIds: []
      });

      expect(() =>
        publish(databases, "run_after_unpublish")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_STORE_NOT_PUBLIC"
        })
      );
      expect(activeVersion(databases.appDatabase)).toMatchObject({
        sourceRunId: "run_public"
      });
    } finally {
      databases.close();
    }
  });

  it("purges an unpublished store and does not restore its historical reviews after republish", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_before_unpublish",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_before_unpublish",
            storeId: "store_a",
            body: "크루아상 결이 좋아요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_before_unpublish");

      databases.appDatabase.client
        .prepare(
          `UPDATE store
              SET catalog_status = 'excluded'
            WHERE store_id = 'store_a'`
        )
        .run();

      expect(
        databases.appDatabase.client
          .prepare(
            `SELECT
               (SELECT count(*) FROM review_document) AS documentCount,
               (SELECT count(*) FROM review_fts) AS ftsCount`
          )
          .get()
      ).toEqual({ documentCount: 0, ftsCount: 0 });
      expect(
        createSqliteReviewRepository(databases.appDatabase)
          .searchReviews({ text: "크루아상" })
      ).toEqual({
        status: "UNAVAILABLE",
        code: "FTS_UNAVAILABLE",
        hits: []
      });
      expect(() =>
        publish(databases, "run_before_unpublish")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_FTS_INCONSISTENT"
        })
      );

      databases.appDatabase.client
        .prepare(
          `UPDATE store
              SET catalog_status = 'published'
            WHERE store_id = 'store_a'`
        )
        .run();
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_after_republish",
        targetStoreIds: []
      });

      expect(publish(databases, "run_after_republish")).toMatchObject({
        documentCount: 0,
        ftsDocumentCount: 0
      });
      expect(
        createSqliteReviewRepository(databases.appDatabase)
          .searchReviews({ text: "크루아상" })
      ).toEqual({ status: "AVAILABLE", hits: [] });
    } finally {
      databases.close();
    }
  });

  it("maps source database failures to a non-sensitive error code", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_database_failure",
        targetStoreIds: []
      });
      databases.rawDatabase.client.exec(
        "DROP TABLE raw_review_ciphertext"
      );

      let thrown: unknown;
      try {
        publish(databases, "run_database_failure");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toEqual(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_DATABASE_UNAVAILABLE",
          message: "REVIEW_PUBLISH_DATABASE_UNAVAILABLE"
        })
      );
      expect(thrown).toBeInstanceOf(ReviewPublishError);
    } finally {
      databases.close();
    }
  });

  it("chunks ownership validation beyond SQLite's bind-variable limit", async () => {
    const databases = await createFixtureDatabases();

    try {
      const owners = Array.from(
        { length: 32_767 },
        (_, index) => ({
          reviewId: `review_limit_${index}`,
          storeId: "store_a"
        })
      );

      expect(() =>
        assertStableReviewOwnership(
          databases.appDatabase,
          owners
        )
      ).not.toThrow();
    } finally {
      databases.close();
    }
  });

  it("rejects non-terminal and stale source runs without changing the current corpus", async () => {
    const databases = await createFixtureDatabases();

    try {
      seedAppStore(databases.appDatabase, "store_a");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_running",
        status: "RUNNING",
        targetStoreIds: ["store_a"]
      });
      expect(() => publish(databases, "run_running")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_RUN_NOT_TERMINAL"
        })
      );

      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_first",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_first",
            storeId: "store_a",
            body: "소금빵 바삭해요",
            publishedDate: "2026-07-20"
          }
        ]
      });
      publish(databases, "run_first");
      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_second",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_second",
            storeId: "store_a",
            body: "식빵 촉촉해요",
            publishedDate: "2026-07-21"
          }
        ]
      });
      publish(databases, "run_second");

      seedRawReviewRun(databases.rawDatabase, {
        runId: "run_unpublished_old",
        asOfDate: "2025-07-30",
        targetStoreIds: ["store_a"],
        reviews: [
          {
            reviewId: "review_unpublished_old",
            storeId: "store_a",
            body: "단팥빵 달콤해요",
            publishedDate: "2025-07-20"
          }
        ]
      });
      expect(() =>
        publish(databases, "run_unpublished_old")
      ).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_STALE_REPLAY"
        })
      );

      expect(() => publish(databases, "run_first")).toThrow(
        ReviewPublishError
      );
      expect(() => publish(databases, "run_first")).toThrowError(
        expect.objectContaining({
          code: "REVIEW_PUBLISH_STALE_REPLAY"
        })
      );
      expect(activeVersion(databases.appDatabase)).toMatchObject({
        sourceRunId: "run_second"
      });
    } finally {
      databases.close();
    }
  });
});
