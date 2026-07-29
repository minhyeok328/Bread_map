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
import { deidentifyReview } from "./deidentify-review.js";
import { decryptRawReview } from "./encrypt-raw-review.js";
import type { MemoryOnlyReview } from "./extract-review-page.js";
import {
  fingerprintReview,
  normalizeNickname
} from "./fingerprint-review.js";
import type { ReviewSecrets } from "./review-secrets.js";
import {
  loadStoreSyncState,
  persistSuccessfulStoreSync,
  recordSeenFingerprint
} from "./review-sync-state.js";

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
         policy_snapshot_id, selector_contract_version, as_of_date,
         fingerprint_key_version, run_budget_ms, status, active_slot,
         store_count, initial_backfill_store_count,
         incremental_store_count, backfill_fallback_store_count,
         collected_count, duplicate_count, rejected_pii_count,
         failed_store_count, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'reviews_fixture', 'discovery_fixture', 'catalog_fixture',
         'policy_fixture', 'selector-v2', '2026-07-29', 'key-v1',
         3600000, 'RUNNING', 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, NULL,
         34560000000
       )`
    )
    .run();
}

function sourceFor(
  pages: Array<{
    reviews: MemoryOnlyReview[];
    hasNext?: boolean;
    boundary?: "MORE" | "CUTOFF" | "DOM_END";
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
      const boundary =
        value.boundary ??
        (value.hasNext === true ? "MORE" : "DOM_END");
      return {
        status: "OK",
        reviews: value.reviews,
        hasNext: boundary === "MORE",
        boundary,
        totalItemCount: value.reviews.length,
        newestPublishedDate:
          value.reviews[0]?.publishedDate ?? null,
        oldestPublishedDate:
          value.reviews.at(-1)?.publishedDate ?? null
      };
    }
  };
}

function makeReview(
  id: number,
  publishedDate = "2026-07-20"
): MemoryOnlyReview {
  return {
    body: `Fixture review ${id}`,
    ratingBasisPoints: 4000,
    publishedDate,
    nickname: `fixture-${id}`
  };
}

function fingerprintFor(
  review: MemoryOnlyReview,
  storeId = "store_fixture"
): Buffer {
  const deidentified = deidentifyReview(review.body);
  if (!deidentified.accepted) {
    throw new Error("fixture deidentification failed");
  }
  return fingerprintReview(
    {
      provider: "KAKAO_MAP",
      storeId,
      normalizedNickname: normalizeNickname(review.nickname),
      publishedDate: review.publishedDate,
      normalizedDeidentifiedText: deidentified.text
    },
    secrets.hmacKey
  );
}

function seedSuccessfulSync(
  database: RawDatabaseHandle,
  anchor: MemoryOnlyReview,
  seen: MemoryOnlyReview[] = [anchor]
): Buffer {
  for (const [index, review] of seen.entries()) {
    recordSeenFingerprint({
      rawDatabase: database,
      storeId: "store_fixture",
      fingerprint: fingerprintFor(review),
      keyVersion: secrets.keyVersion,
      publishedDate: review.publishedDate,
      nowMs: 100 + index
    });
  }
  const anchorFingerprint = fingerprintFor(anchor);
  persistSuccessfulStoreSync({
    rawDatabase: database,
    storeId: "store_fixture",
    runId: "previous_run",
    mode: "INITIAL_BACKFILL",
    asOfDate: "2026-07-20",
    keyVersion: secrets.keyVersion,
    anchorFingerprint,
    anchorPublishedDate: anchor.publishedDate,
    completedAtMs: 200
  });
  return anchorFingerprint;
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
        asOfDate: "2026-07-29",
        source: sourceFor([{ reviews, hasNext: false }]),
        secrets,
        now: () => 1_000
      });

      expect(result).toEqual({
        status: "COMPLETE",
        mode: "INITIAL_BACKFILL",
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

  it("collects every recent review across three pages without a count cap", async () => {
    const database = await createDatabase();
    const calls: number[] = [];
    const reviews = Array.from({ length: 25 }, (_, index) =>
      makeReview(index + 1)
    );

    try {
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor(
          [
            { reviews: reviews.slice(0, 10), boundary: "MORE" },
            { reviews: reviews.slice(10, 20), boundary: "MORE" },
            { reviews: reviews.slice(20), boundary: "CUTOFF" }
          ],
          calls
        ),
        secrets,
        now: () => 1_000
      });

      expect(result).toMatchObject({
        status: "COMPLETE",
        mode: "INITIAL_BACKFILL",
        collectedCount: 25,
        duplicateCount: 0
      });
      expect(calls).toEqual([1, 2, 3]);
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count FROM review_store_sync_state`
          )
          .get()
      ).toEqual({ count: 1 });
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
    const reviewBody = review.body;

    try {
      await expect(
        collectStoreReviews({
          rawDatabase: database,
          runId: "reviews_fixture",
          observationId: "observation_fixture",
          storeId: "store_fixture",
          asOfDate: "2026-07-29",
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
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
               FROM review_seen_fingerprint`
          )
          .get()
      ).toEqual({ count: 0 });

      const resumed = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor([
          {
            reviews: [
              {
                ...review,
                body: reviewBody,
                nickname: "fixture-crash"
              }
            ],
            hasNext: false
          }
        ]),
        secrets,
        now: () => 2_000
      });

      expect(resumed).toMatchObject({
        status: "COMPLETE",
        mode: "INITIAL_BACKFILL",
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
            `SELECT count(*) AS count
               FROM review_seen_fingerprint`
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
        asOfDate: "2026-07-29",
        source: sourceFor([]),
        secrets,
        now: () => 3_000
      });
      expect(skipped).toEqual({
        status: "SKIPPED",
        mode: "INCREMENTAL",
        collectedCount: 0,
        duplicateCount: 0,
        rejectedPiiCount: 0
      });
    } finally {
      database.close();
    }
  });

  it("collects only new reviews through a validated incremental anchor", async () => {
    const database = await createDatabase();
    const newest = makeReview(101, "2026-07-20");
    const second = makeReview(102, "2026-07-19");
    const anchor = makeReview(103, "2026-07-18");
    const older = makeReview(104, "2026-07-17");
    const expectedAnchor = fingerprintFor(newest);
    const calls: number[] = [];

    try {
      seedSuccessfulSync(database, anchor, [anchor, older]);
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor(
          [
            {
              reviews: [newest, second, anchor, older],
              boundary: "MORE"
            }
          ],
          calls
        ),
        secrets,
        now: () => 1_000
      });

      expect(result).toEqual({
        status: "COMPLETE",
        mode: "INCREMENTAL",
        collectedCount: 2,
        duplicateCount: 2,
        rejectedPiiCount: 0
      });
      expect(calls).toEqual([1]);
      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_fixture",
          keyVersion: secrets.keyVersion
        })
      ).toMatchObject({
        status: "READY",
        anchorFingerprint: expectedAnchor,
        anchorPublishedDate: "2026-07-20",
        lastSuccessfulRunId: "reviews_fixture"
      });
    } finally {
      database.close();
    }
  });

  it("falls back through the cutoff when a new review follows the anchor", async () => {
    const database = await createDatabase();
    const anchor = makeReview(201, "2026-07-19");
    const gap = makeReview(202, "2026-07-18");
    const older = makeReview(203, "2026-07-17");
    const calls: number[] = [];

    try {
      seedSuccessfulSync(database, anchor, [anchor, older]);
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor(
          [
            {
              reviews: [anchor, gap],
              boundary: "MORE"
            },
            {
              reviews: [older],
              boundary: "CUTOFF"
            }
          ],
          calls
        ),
        secrets,
        now: () => 1_000
      });

      expect(result).toMatchObject({
        status: "COMPLETE",
        mode: "BACKFILL_FALLBACK",
        collectedCount: 1,
        duplicateCount: 2
      });
      expect(calls).toEqual([1, 2]);
    } finally {
      database.close();
    }
  });

  it("falls back when the previous anchor is absent at DOM end", async () => {
    const database = await createDatabase();
    const missingAnchor = makeReview(301, "2026-07-18");

    try {
      seedSuccessfulSync(database, missingAnchor);
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor([
          {
            reviews: [makeReview(302, "2026-07-20")],
            boundary: "DOM_END"
          }
        ]),
        secrets,
        now: () => 1_000
      });

      expect(result).toMatchObject({
        status: "COMPLETE",
        mode: "BACKFILL_FALLBACK",
        collectedCount: 1
      });
    } finally {
      database.close();
    }
  });

  it("uses the seen ledger after ciphertext retention deletion", async () => {
    const database = await createDatabase();
    const firstInput = makeReview(401);

    try {
      await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor([
          { reviews: [firstInput], boundary: "DOM_END" }
        ]),
        secrets,
        now: () => 1_000
      });
      database.client
        .prepare(`DELETE FROM raw_review_ciphertext`)
        .run();
      database.client
        .prepare(
          `DELETE FROM review_checkpoint
            WHERE run_id = 'reviews_fixture'
              AND store_id = 'store_fixture'`
        )
        .run();

      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor([
          {
            reviews: [makeReview(401)],
            boundary: "DOM_END"
          }
        ]),
        secrets,
        now: () => 2_000
      });

      expect(result).toMatchObject({
        status: "COMPLETE",
        mode: "INCREMENTAL",
        collectedCount: 0,
        duplicateCount: 1
      });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count FROM raw_review_ciphertext`
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("pauses after a committed page and resumes at the next page", async () => {
    const database = await createDatabase();
    const pages = [
      { reviews: [makeReview(501)], boundary: "MORE" as const },
      { reviews: [makeReview(502)], boundary: "MORE" as const },
      { reviews: [makeReview(503)], boundary: "DOM_END" as const }
    ];
    let pageChecks = 0;

    try {
      const paused = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor(pages),
        secrets,
        shouldPauseBudget: () => {
          pageChecks += 1;
          return pageChecks >= 2;
        },
        now: () => 1_000
      });

      expect(paused).toMatchObject({
        status: "PAUSED_BUDGET",
        mode: "INITIAL_BACKFILL",
        collectedCount: 2,
        duplicateCount: 0
      });
      expect(
        database.client
          .prepare(
            `SELECT max(page_number) AS page
               FROM review_checkpoint
              WHERE run_id = 'reviews_fixture'
                AND store_id = 'store_fixture'`
          )
          .get()
      ).toEqual({ page: 2 });
      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_fixture",
          keyVersion: secrets.keyVersion
        })
      ).toEqual({ status: "NONE" });

      const resumedCalls: number[] = [];
      const resumed = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: sourceFor(pages, resumedCalls),
        secrets,
        now: () => 2_000
      });

      expect(resumed).toMatchObject({
        status: "COMPLETE",
        mode: "INITIAL_BACKFILL",
        collectedCount: 1,
        duplicateCount: 0
      });
      expect(resumedCalls).toEqual([3]);
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count FROM raw_review_ciphertext`
          )
          .get()
      ).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });

  it("does not replace the anchor on provider stop", async () => {
    const database = await createDatabase();
    const anchor = makeReview(601);
    const originalFingerprint = seedSuccessfulSync(database, anchor);

    try {
      const result = await collectStoreReviews({
        rawDatabase: database,
        runId: "reviews_fixture",
        observationId: "observation_fixture",
        storeId: "store_fixture",
        asOfDate: "2026-07-29",
        source: {
          async readPage() {
            return {
              status: "STOP_PROVIDER",
              reasonCode: "RATE_LIMITED"
            };
          }
        },
        secrets,
        now: () => 1_000
      });

      expect(result).toMatchObject({
        status: "STOP_PROVIDER",
        mode: "INCREMENTAL",
        collectedCount: 0
      });
      expect(
        loadStoreSyncState({
          rawDatabase: database,
          storeId: "store_fixture",
          keyVersion: secrets.keyVersion
        })
      ).toMatchObject({
        status: "READY",
        anchorFingerprint: originalFingerprint,
        lastSuccessfulRunId: "previous_run"
      });
    } finally {
      database.close();
    }
  });

  it("fails final on an HMAC key-version mismatch before reading a page", async () => {
    const database = await createDatabase();
    const calls: number[] = [];

    try {
      seedSuccessfulSync(database, makeReview(701));
      await expect(
        collectStoreReviews({
          rawDatabase: database,
          runId: "reviews_fixture",
          observationId: "observation_fixture",
          storeId: "store_fixture",
          asOfDate: "2026-07-29",
          source: sourceFor(
            [
              {
                reviews: [makeReview(702)],
                boundary: "DOM_END"
              }
            ],
            calls
          ),
          secrets: {
            ...secrets,
            keyVersion: "key-v2"
          },
          now: () => 1_000
        })
      ).rejects.toThrow("REVIEW_SYNC_KEY_VERSION_MISMATCH");
      expect(calls).toEqual([]);
    } finally {
      database.close();
    }
  });
});
