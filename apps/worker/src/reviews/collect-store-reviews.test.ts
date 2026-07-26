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
  collectStoreReviews,
  type ReviewPageSource
} from "./collect-store-reviews.js";
import { decryptRawReview } from "./encrypt-raw-review.js";
import type { MemoryOnlyReview } from "./extract-review-page.js";
import type { ReviewSecrets } from "./review-secrets.js";

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
    join(tmpdir(), "bread-map-collect-store-")
  );
  cleanupPaths.push(directory);
  const database = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateRawDatabase(database, resolve("drizzle/raw"));
  seedLineage(database);
  return database;
}

function seedLineage(database: RawDatabaseHandle): void {
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
  database.client
    .prepare(
      `INSERT INTO kakao_place_observation (
         observation_id, run_id, observation_key, display_name,
         normalized_name, category_name, category_tag, road_address,
         lot_address, phone, latitude_e7, longitude_e7, tile_key,
         page_number, match_status, matched_store_id, match_signals_json,
         observed_at_ms, expires_at_ms
       ) VALUES (
         'observation_fixture', 'discovery_fixture', ?, 'Fixture Bakery',
         'fixturebakery', '음식점 > 간식 > 제과,베이커리',
         '제과,베이커리', '서울특별시 마포구 Fixture로 1', NULL,
         NULL, 375600000, 1269000000, '0', 1,
         'MATCHED_ELIGIBLE', 'store_fixture', '{}', 0, 34560000000
       )`
    )
    .run(Buffer.alloc(32, 1));
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
         'policy_fixture', 'selector-v1', 'RUNNING', 1,
         1, 0, 0, 0, 0, 0, NULL, 34560000000
       )`
    )
    .run();
}

function sourceFor(
  pages: Array<{
    reviews: MemoryOnlyReview[];
    hasNext: boolean;
  }>,
  calls: number[] = []
): ReviewPageSource {
  return {
    async readPage(pageNumber) {
      calls.push(pageNumber);
      const value = pages[pageNumber - 1];
      if (value === undefined) {
        throw new Error("unexpected page");
      }
      return { status: "OK", ...value };
    }
  };
}

describe("store review collection", () => {
  it("stores only encrypted deidentified reviews and counts duplicates", async () => {
    const database = await createDatabase();
    const reviews: MemoryOnlyReview[] = [
      {
        body: "소금빵이 맛있어요",
        ratingBasisPoints: 5000,
        publishedDate: "2026-07-20",
        nickname: "fixture-one"
      },
      {
        body: "크루아상이 좋아요",
        ratingBasisPoints: 4500,
        publishedDate: "2026-07-19",
        nickname: "fixture-two"
      },
      {
        body: "소금빵이 맛있어요",
        ratingBasisPoints: 5000,
        publishedDate: "2026-07-20",
        nickname: "fixture-one"
      },
      {
        body: "직원 김민수님이 병원 진단을 말했어요",
        ratingBasisPoints: 1000,
        publishedDate: "2026-07-18",
        nickname: "fixture-private"
      }
    ];

    try {
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        source: sourceFor([{ reviews, hasNext: false }]),
        secrets,
        now: () => 1_000
      });

      expect(result).toEqual({
        status: "COMPLETE",
        collectedCount: 2,
        duplicateCount: 1,
        rejectedPiiCount: 1
      });
      expect(reviews.map((review) => review.nickname)).toEqual([
        "",
        "",
        "",
        ""
      ]);

      const rows = database.client
        .prepare(
          `SELECT review_id, ciphertext, nonce, auth_tag, key_version,
                  aad_version, store_id
             FROM raw_review_ciphertext
            ORDER BY review_id`
        )
        .all() as Array<{
        review_id: string;
        ciphertext: Buffer;
        nonce: Buffer;
        auth_tag: Buffer;
        key_version: string;
        aad_version: "review-aad-v1";
        store_id: string;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const decrypted = decryptRawReview(
          {
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            authTag: row.auth_tag,
            keyVersion: row.key_version,
            aadVersion: row.aad_version
          },
          {
            reviewId: row.review_id,
            storeId: row.store_id,
            provider: "KAKAO_MAP",
            schemaVersion: 1
          },
          secrets.encryptionKey
        );
        expect(decrypted.body).not.toContain("김민수");
        expect(JSON.stringify(decrypted)).not.toContain("fixture-");
      }
      expect(
        database.client
          .prepare(
            `SELECT reason_code
               FROM deidentification_failure`
          )
          .all()
      ).toEqual([{ reason_code: "REJECTED_PII" }]);
      const sensitiveValues = [
        "fixture-one",
        "fixture-two",
        "fixture-private",
        "김민수"
      ];
      const rawBuffers = rows.flatMap((row) => [
        row.ciphertext,
        row.nonce,
        row.auth_tag
      ]);
      for (const value of sensitiveValues) {
        expect(
          rawBuffers.some((buffer) =>
            buffer.includes(Buffer.from(value, "utf8"))
          )
        ).toBe(false);
      }
    } finally {
      database.close();
    }
  });

  it("does not request review 21 after reaching the hard limit", async () => {
    const database = await createDatabase();
    const calls: number[] = [];
    const reviews = Array.from({ length: 20 }, (_, index) => ({
      body: `Fixture review ${index + 1}`,
      ratingBasisPoints: 4000,
      publishedDate: "2026-07-20",
      nickname: `fixture-${index + 1}`
    }));

    try {
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        source: sourceFor(
          [
            { reviews, hasNext: true },
            {
              reviews: [
                {
                  body: "Review 21",
                  ratingBasisPoints: 5000,
                  publishedDate: "2026-07-19",
                  nickname: "never-requested"
                }
              ],
              hasNext: false
            }
          ],
          calls
        ),
        secrets,
        now: () => 1_000
      });

      expect(result).toMatchObject({
        status: "COMPLETE",
        collectedCount: 20
      });
      expect(calls).toEqual([1]);
    } finally {
      database.close();
    }
  });

  it("recovers a crash after raw commit without a duplicate row", async () => {
    const database = await createDatabase();
    const review: MemoryOnlyReview = {
      body: "재개해도 한 번만 저장돼요",
      ratingBasisPoints: 5000,
      publishedDate: "2026-07-20",
      nickname: "fixture-crash"
    };

    try {
      await expect(
        collectStoreReviews({
          rawDatabase: database,
          runId: "reviews_fixture",
          observationId: "observation_fixture",
          storeId: "store_fixture",
          source: sourceFor([
            { reviews: [review], hasNext: false }
          ]),
          secrets,
          now: () => 1_000,
          afterRawCommit: () => {
            throw new Error("simulated crash");
          }
        })
      ).rejects.toThrow("simulated crash");

      const resumed = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        source: sourceFor([
          {
            reviews: [{ ...review, nickname: "fixture-crash" }],
            hasNext: false
          }
        ]),
        secrets,
        now: () => 2_000
      });

      expect(resumed).toMatchObject({
        status: "COMPLETE",
        collectedCount: 0,
        duplicateCount: 1
      });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count FROM raw_review_ciphertext`
          )
          .get()
      ).toEqual({ count: 1 });
      expect(
        database.client
          .prepare(
            `SELECT state
               FROM review_checkpoint
              WHERE run_id = 'reviews_fixture'
                AND store_id = 'store_fixture'
              ORDER BY page_number`
          )
          .all()
      ).toEqual([{ state: "COMPLETE" }, { state: "RUNNING" }]);

      const skipped = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        source: sourceFor([]),
        secrets,
        now: () => 3_000
      });
      expect(skipped).toEqual({
        status: "SKIPPED",
        collectedCount: 0,
        duplicateCount: 0,
        rejectedPiiCount: 0
      });
    } finally {
      database.close();
    }
  });
});
