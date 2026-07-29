import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openRawDatabase } from "../database.js";
import { migrateRawDatabase } from "../migrate.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOUR_HUNDRED_DAYS_MS = 400 * 24 * 60 * 60 * 1000;
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
         policy_snapshot_id, selector_contract_version, as_of_date,
         fingerprint_key_version, run_budget_ms, status, active_slot,
         store_count, initial_backfill_store_count,
         incremental_store_count, backfill_fallback_store_count,
         collected_count, duplicate_count, rejected_pii_count,
         failed_store_count, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'reviews_fixture', 'discovery_fixture', 'catalog_fixture',
         'policy_fixture', 'selector-v2', '2026-07-29',
         'hmac-v1', 3600000, 'RUNNING', 1, 1, 1, 0, 0,
         0, 0, 0, 0, 0, NULL, 34560000000
       )`
    )
    .run();
}

interface RawReviewInsert {
  reviewId: string;
  nonce: Buffer;
  authTag: Buffer;
  fingerprint: Buffer;
  keyVersion?: string;
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
         'KAKAO_MAP', ?, ?, ?, ?, 'aad-v1', ?, 0, ?
       )`
    )
    .run(
      input.reviewId,
      Buffer.from("ciphertext"),
      input.nonce,
      input.authTag,
      input.keyVersion ?? "key-v1",
      input.fingerprint,
      THIRTY_DAYS_MS
    );
}

interface SeenFingerprintInsert {
  seenId: string;
  provider?: string;
  fingerprint?: Buffer;
  fingerprintKeyVersion?: string;
  publishedDate?: string;
  firstSeenAtMs?: number;
  lastSeenAtMs?: number;
  expiresAtMs?: number;
}

function insertSeenFingerprint(
  client: Database.Database,
  input: SeenFingerprintInsert
): void {
  client
    .prepare(
      `INSERT INTO review_seen_fingerprint (
         seen_id, store_id, provider, fingerprint_key_version,
         fingerprint, published_date, first_seen_at_ms, last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, 'store_fixture', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.seenId,
      input.provider ?? "KAKAO_MAP",
      input.fingerprintKeyVersion ?? "hmac-v1",
      input.fingerprint ?? Buffer.alloc(32, 1),
      input.publishedDate ?? "2026-07-29",
      input.firstSeenAtMs ?? 0,
      input.lastSeenAtMs ?? 1,
      input.expiresAtMs ?? FOUR_HUNDRED_DAYS_MS
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
          "review_seen_fingerprint",
          "review_store_sync_state",
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

  it("enforces AES-GCM metadata lengths and key-versioned deduplication", async () => {
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
      expect(() =>
        insertRawReview(handle.client, {
          reviewId: "review_rotated_key",
          nonce: Buffer.alloc(12, 3),
          authTag: Buffer.alloc(16),
          fingerprint: Buffer.alloc(32, 4),
          keyVersion: "key-v2"
        })
      ).not.toThrow();
    } finally {
      handle.close();
    }
  });

  it("enforces review run date, budget, status, and mode counts", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedReviewLineage(handle.client);
      const insertRun = handle.client.prepare(
        `INSERT INTO review_collection_run (
           run_id, discovery_run_id, catalog_snapshot_id,
           policy_snapshot_id, selector_contract_version, as_of_date,
           fingerprint_key_version, run_budget_ms, status, active_slot,
           store_count, initial_backfill_store_count,
           incremental_store_count, backfill_fallback_store_count,
           collected_count, duplicate_count, rejected_pii_count,
           failed_store_count, started_at_ms, finished_at_ms, expires_at_ms
         ) VALUES (
           ?, 'discovery_fixture', 'catalog_fixture', 'policy_fixture',
           'selector-v2', ?, 'hmac-v1', ?, ?, NULL, 2, ?, ?, ?,
           0, 0, 0, 0, 0, NULL, 34560000000
         )`
      );

      expect(() =>
        insertRun.run(
          "reviews_bad_date",
          "2026-7-29",
          3600000,
          "READY",
          2,
          0,
          0
        )
      ).toThrow();
      expect(() =>
        insertRun.run(
          "reviews_bad_budget",
          "2026-07-29",
          28800001,
          "READY",
          2,
          0,
          0
        )
      ).toThrow();
      expect(() =>
        insertRun.run(
          "reviews_old_pause",
          "2026-07-29",
          3600000,
          "PAUSED",
          2,
          0,
          0
        )
      ).toThrow();
      expect(() =>
        insertRun.run(
          "reviews_bad_mode_sum",
          "2026-07-29",
          3600000,
          "READY",
          1,
          0,
          0
        )
      ).toThrow();
    } finally {
      handle.close();
    }
  });

  it("enforces the seen-fingerprint retention and dedupe boundary", async () => {
    const handle = await createMigratedDatabase();

    try {
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_bad_provider",
          provider: "OTHER"
        })
      ).toThrow();
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_bad_length",
          fingerprint: Buffer.alloc(31)
        })
      ).toThrow();
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_bad_date",
          publishedDate: "2026-7-29"
        })
      ).toThrow();
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_bad_expiry",
          lastSeenAtMs: 2,
          expiresAtMs: 2
        })
      ).toThrow();

      insertSeenFingerprint(handle.client, { seenId: "seen_first" });
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_duplicate"
        })
      ).toThrow();
      expect(() =>
        insertSeenFingerprint(handle.client, {
          seenId: "seen_new_key",
          fingerprintKeyVersion: "hmac-v2"
        })
      ).not.toThrow();
    } finally {
      handle.close();
    }
  });

  it("requires complete or empty store sync anchors", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedReviewLineage(handle.client);
      const insertState = handle.client.prepare(
        `INSERT INTO review_store_sync_state (
           sync_state_id, store_id, provider, anchor_fingerprint,
           anchor_fingerprint_key_version, anchor_published_date,
           last_successful_mode, last_successful_run_id,
           last_successful_as_of_date, completed_at_ms, expires_at_ms
         ) VALUES (
           ?, 'store_fixture', 'KAKAO_MAP', ?, ?, ?, 'INITIAL_BACKFILL',
           'reviews_fixture', '2026-07-29', 1, ?
         )`
      );

      expect(() =>
        insertState.run(
          "sync_partial_anchor",
          Buffer.alloc(32, 1),
          null,
          null,
          FOUR_HUNDRED_DAYS_MS
        )
      ).toThrow();
      expect(() =>
        insertState.run(
          "sync_complete_anchor",
          Buffer.alloc(32, 1),
          "hmac-v1",
          "2026-07-29",
          FOUR_HUNDRED_DAYS_MS
        )
      ).not.toThrow();
    } finally {
      handle.close();
    }
  });
});
