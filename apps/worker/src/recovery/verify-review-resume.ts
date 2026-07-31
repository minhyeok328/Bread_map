import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import {
  collectStoreReviews,
  type ReviewPageSource
} from "../reviews/collect-store-reviews.js";
import type {
  MemoryOnlyReview
} from "../reviews/extract-review-page.js";
import type { ReviewSecrets } from "../reviews/review-secrets.js";

export interface VerifyReviewCheckpointResumeOptions {
  rawPath: string;
  migrationsDirectory: string;
}

export interface ReviewCheckpointResumeReport {
  status: "VERIFIED";
  interruptionStatus: "PAUSED_BUDGET";
  interruptedAfterPage: 2;
  resumedFromPage: 3;
  finalStatus: "COMPLETE";
  encryptedReviewCount: 3;
  uniqueFingerprintCount: 3;
  duplicateCount: 0;
  finalCheckpointCount: 1;
}

const secrets: ReviewSecrets = {
  encryptionKey: Buffer.alloc(32, 31),
  hmacKey: Buffer.alloc(32, 47),
  keyVersion: "verification-key-v1"
};

function seedLineage(database: RawDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'recovery_discovery', '빵집', 'SEOUL', '제과,베이커리',
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
         page_number, match_status, matched_store_id,
         match_signals_json, observed_at_ms, expires_at_ms
       ) VALUES (
         'recovery_observation', 'recovery_discovery', ?,
         'Recovery Fixture Bakery', 'recoveryfixturebakery',
         '제과,베이커리', '제과,베이커리',
         '서울특별시 마포구 검증로 1', NULL, NULL,
         375600000, 1269000000, '0', 1,
         'MATCHED_ELIGIBLE', 'recovery_store', '{}', 0, 34560000000
       )`
    )
    .run(Buffer.alloc(32, 5));
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
         'recovery_reviews', 'recovery_discovery', 'catalog_fixture',
         'policy_fixture', 'selector-fixture', '2026-07-30',
         'verification-key-v1', 3600000, 'RUNNING', 1,
         1, 1, 0, 0, 0, 0, 0, 0, 0, NULL, 34560000000
       )`
    )
    .run();
}

function fixtureReview(index: number): MemoryOnlyReview {
  return {
    body: `sanitized fixture review ${index}`,
    ratingBasisPoints: 4_000 + index * 100,
    publishedDate: `2026-07-${String(31 - index).padStart(2, "0")}`,
    nickname: `synthetic-author-${index}`
  };
}

function createPageSource(
  calls: number[]
): ReviewPageSource {
  const pages = [
    { reviews: [fixtureReview(1)], boundary: "MORE" as const },
    { reviews: [fixtureReview(2)], boundary: "MORE" as const },
    {
      reviews: [fixtureReview(3)],
      boundary: "DOM_END" as const
    }
  ];
  return {
    async readPage(pageNumber) {
      calls.push(pageNumber);
      const page = pages[pageNumber - 1];
      if (page === undefined) {
        throw new Error("REVIEW_RESUME_FIXTURE_PAGE_MISSING");
      }
      return {
        status: "OK",
        reviews: page.reviews,
        hasNext: page.boundary === "MORE",
        boundary: page.boundary,
        totalItemCount: page.reviews.length,
        newestPublishedDate:
          page.reviews[0]?.publishedDate ?? null,
        oldestPublishedDate:
          page.reviews.at(-1)?.publishedDate ?? null
      };
    }
  };
}

function count(
  database: RawDatabaseHandle,
  sql: string
): number {
  return (database.client.prepare(sql).get() as { count: number })
    .count;
}

export async function verifyReviewCheckpointResume(
  options: VerifyReviewCheckpointResumeOptions
): Promise<ReviewCheckpointResumeReport> {
  let database: RawDatabaseHandle | undefined;
  try {
    database = openRawDatabase({ path: options.rawPath });
    migrateRawDatabase(database, options.migrationsDirectory);
    seedLineage(database);
    let pauseChecks = 0;
    const firstCalls: number[] = [];
    const interrupted = await collectStoreReviews({
      rawDatabase: database,
      runId: "recovery_reviews",
      observationId: "recovery_observation",
      storeId: "recovery_store",
      asOfDate: "2026-07-30",
      source: createPageSource(firstCalls),
      secrets,
      shouldPauseBudget: () => {
        pauseChecks += 1;
        return pauseChecks >= 2;
      },
      now: () => 1_000
    });
    if (
      interrupted.status !== "PAUSED_BUDGET" ||
      firstCalls.join(",") !== "1,2"
    ) {
      throw new Error("REVIEW_RESUME_INTERRUPTION_FAILED");
    }

    database.close();
    database = undefined;

    database = openRawDatabase({ path: options.rawPath });
    const resumedCalls: number[] = [];
    const resumed = await collectStoreReviews({
      rawDatabase: database,
      runId: "recovery_reviews",
      observationId: "recovery_observation",
      storeId: "recovery_store",
      asOfDate: "2026-07-30",
      source: createPageSource(resumedCalls),
      secrets,
      now: () => 2_000
    });
    const encryptedReviewCount = count(
      database,
      "SELECT COUNT(*) AS count FROM raw_review_ciphertext"
    );
    const uniqueFingerprintCount = count(
      database,
      `SELECT COUNT(DISTINCT hex(fingerprint)) AS count
         FROM raw_review_ciphertext`
    );
    const finalCheckpointCount = count(
      database,
      `SELECT COUNT(*) AS count
         FROM review_checkpoint
        WHERE run_id = 'recovery_reviews'
          AND store_id = 'recovery_store'
          AND page_number = 0
          AND state = 'COMPLETE'`
    );
    if (
      resumed.status !== "COMPLETE" ||
      resumedCalls.join(",") !== "3" ||
      encryptedReviewCount !== 3 ||
      uniqueFingerprintCount !== 3 ||
      resumed.duplicateCount !== 0 ||
      finalCheckpointCount !== 1
    ) {
      throw new Error("REVIEW_RESUME_RESULT_INVALID");
    }

    return {
      status: "VERIFIED",
      interruptionStatus: "PAUSED_BUDGET",
      interruptedAfterPage: 2,
      resumedFromPage: 3,
      finalStatus: "COMPLETE",
      encryptedReviewCount: 3,
      uniqueFingerprintCount: 3,
      duplicateCount: 0,
      finalCheckpointCount: 1
    };
  } catch (error) {
    void error;
    throw new Error("REVIEW_RESUME_VERIFICATION_FAILED");
  } finally {
    database?.close();
  }
}
