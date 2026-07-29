import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSeenFingerprint,
  loadStoreSyncState,
  persistSuccessfulStoreSync,
  recordSeenFingerprint
} from "./review-sync-state.js";

const FOUR_HUNDRED_DAYS_MS = 400 * 24 * 60 * 60 * 1000;
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
    join(tmpdir(), "bread-map-review-sync-")
  );
  cleanupPaths.push(directory);
  const database = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateRawDatabase(database, resolve("drizzle/raw"));
  return database;
}

describe("review sync state", () => {
  it("records a seen fingerprint idempotently for four hundred days", async () => {
    const database = await createDatabase();
    const fingerprint = Buffer.alloc(32, 1);

    try {
      expect(
        findSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v1"
        })
      ).toBe(false);

      expect(
        recordSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v1",
          publishedDate: "2026-07-20",
          nowMs: 1_000
        })
      ).toBe("inserted");
      expect(
        findSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v1"
        })
      ).toBe(true);
      expect(
        findSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v2"
        })
      ).toBe(false);

      expect(
        recordSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v1",
          publishedDate: "2026-07-20",
          nowMs: 2_000
        })
      ).toBe("seen");
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count, min(first_seen_at_ms) AS firstSeen,
                    max(last_seen_at_ms) AS lastSeen,
                    max(expires_at_ms) AS expiresAt
               FROM review_seen_fingerprint`
          )
          .get()
      ).toEqual({
        count: 1,
        firstSeen: 1_000,
        lastSeen: 2_000,
        expiresAt: 2_000 + FOUR_HUNDRED_DAYS_MS
      });
    } finally {
      database.close();
    }
  });

  it("keeps seen state independent from thirty-day ciphertext deletion", async () => {
    const database = await createDatabase();
    const fingerprint = Buffer.alloc(32, 2);

    try {
      database.client.pragma("foreign_keys = OFF");
      database.client
        .prepare(
          `INSERT INTO raw_review_ciphertext (
             review_id, run_id, observation_id, store_id, provider,
             ciphertext, nonce, auth_tag, key_version, aad_version,
             fingerprint, collected_at_ms, retention_until_ms
           ) VALUES (
             'review_fixture', 'run_fixture', 'observation_fixture',
             'store_one', 'KAKAO_MAP', ?, ?, ?, 'key-v1', 'aad-v1',
             ?, 0, 2592000000
           )`
        )
        .run(
          Buffer.from("ciphertext"),
          Buffer.alloc(12, 1),
          Buffer.alloc(16, 2),
          fingerprint
        );
      database.client.pragma("foreign_keys = ON");
      recordSeenFingerprint({
        rawDatabase: database,
        storeId: "store_one",
        fingerprint,
        keyVersion: "hmac-v1",
        publishedDate: "2026-07-20",
        nowMs: 1_000
      });

      database.client
        .prepare(
          `DELETE FROM raw_review_ciphertext
            WHERE retention_until_ms <= 2592000000`
        )
        .run();

      expect(
        findSeenFingerprint({
          rawDatabase: database,
          storeId: "store_one",
          fingerprint,
          keyVersion: "hmac-v1"
        })
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("expires seen state at the exact four-hundred-day boundary", async () => {
    const database = await createDatabase();

    try {
      recordSeenFingerprint({
        rawDatabase: database,
        storeId: "store_one",
        fingerprint: Buffer.alloc(32, 3),
        keyVersion: "hmac-v1",
        publishedDate: "2026-07-20",
        nowMs: 1_000
      });

      expect(
        database.client
          .prepare(
            `DELETE FROM review_seen_fingerprint
              WHERE expires_at_ms <= ?`
          )
          .run(1_000 + FOUR_HUNDRED_DAYS_MS - 1).changes
      ).toBe(0);
      expect(
        database.client
          .prepare(
            `DELETE FROM review_seen_fingerprint
              WHERE expires_at_ms <= ?`
          )
          .run(1_000 + FOUR_HUNDRED_DAYS_MS).changes
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("loads, replaces, and key-gates a successful store anchor", async () => {
    const database = await createDatabase();
    const firstAnchor = Buffer.alloc(32, 4);
    const secondAnchor = Buffer.alloc(32, 5);

    try {
      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_one",
          keyVersion: "hmac-v1"
        })
      ).toEqual({ status: "NONE" });

      persistSuccessfulStoreSync({
        rawDatabase: database,
        storeId: "store_one",
        runId: "run_one",
        mode: "INITIAL_BACKFILL",
        asOfDate: "2026-07-20",
        keyVersion: "hmac-v1",
        anchorFingerprint: firstAnchor,
        anchorPublishedDate: "2026-07-19",
        completedAtMs: 1_000
      });

      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_one",
          keyVersion: "hmac-v2"
        })
      ).toEqual({ status: "KEY_VERSION_MISMATCH" });
      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_one",
          keyVersion: "hmac-v1"
        })
      ).toEqual({
        status: "READY",
        anchorFingerprint: firstAnchor,
        anchorPublishedDate: "2026-07-19",
        lastSuccessfulAsOfDate: "2026-07-20",
        lastSuccessfulRunId: "run_one"
      });

      persistSuccessfulStoreSync({
        rawDatabase: database,
        storeId: "store_one",
        runId: "run_two",
        mode: "INCREMENTAL",
        asOfDate: "2026-07-29",
        keyVersion: "hmac-v1",
        anchorFingerprint: secondAnchor,
        anchorPublishedDate: "2026-07-28",
        completedAtMs: 2_000
      });

      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_one",
          keyVersion: "hmac-v1"
        })
      ).toEqual({
        status: "READY",
        anchorFingerprint: secondAnchor,
        anchorPublishedDate: "2026-07-28",
        lastSuccessfulAsOfDate: "2026-07-29",
        lastSuccessfulRunId: "run_two"
      });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count, expires_at_ms AS expiresAt
               FROM review_store_sync_state`
          )
          .get()
      ).toEqual({
        count: 1,
        expiresAt: 2_000 + FOUR_HUNDRED_DAYS_MS
      });
    } finally {
      database.close();
    }
  });
});
