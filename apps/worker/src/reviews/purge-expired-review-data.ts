import type { RawDatabaseHandle } from "@bread-map/raw-db";

const AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export interface PurgeExpiredReviewDataOptions {
  rawDatabase: RawDatabaseHandle;
  deleteRunId: string;
  nowMs: number;
  beforeDelete?: () => void;
  onKillSwitch?: (reasonCode: "RAW_DELETE_FAILED") => void;
}

export type PurgeExpiredReviewDataResult =
  | {
      status: "SUCCEEDED";
      attemptedCount: number;
      deletedCount: number;
      failedCount: 0;
      killSwitchActivated: false;
    }
  | {
      status: "FAILED_FINAL";
      attemptedCount: number;
      deletedCount: 0;
      failedCount: number;
      killSwitchActivated: true;
    };

function candidateCount(
  rawDatabase: RawDatabaseHandle,
  nowMs: number
): number {
  const row = rawDatabase.client
    .prepare(
      `SELECT
         (SELECT count(*) FROM raw_review_ciphertext
           WHERE retention_until_ms <= ?) +
         (SELECT count(*) FROM kakao_place_locator
           WHERE delete_by_ms <= ?) +
         (SELECT count(*) FROM review_seen_fingerprint
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM review_store_sync_state
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM deidentification_failure
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM review_checkpoint
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM kakao_place_observation observation
           WHERE observation.expires_at_ms <= ?
             AND NOT EXISTS (
               SELECT 1 FROM raw_review_ciphertext review
                WHERE review.observation_id = observation.observation_id
                 AND review.retention_until_ms > ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM kakao_place_locator locator
                WHERE locator.observation_id = observation.observation_id
                 AND locator.delete_by_ms > ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM review_checkpoint checkpoint
                WHERE checkpoint.observation_id = observation.observation_id
                 AND checkpoint.expires_at_ms > ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM deidentification_failure failure
                WHERE failure.observation_id = observation.observation_id
                 AND failure.expires_at_ms > ?
             )
         ) +
         (SELECT count(*) FROM review_collection_run
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM kakao_discovery_run
           WHERE expires_at_ms <= ?) +
         (SELECT count(*) FROM raw_delete_audit
           WHERE expires_at_ms <= ?) AS count`
    )
    .get(
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
      nowMs
    ) as { count: number };
  return row.count;
}

export async function purgeExpiredReviewData(
  options: PurgeExpiredReviewDataOptions
): Promise<PurgeExpiredReviewDataResult> {
  let attemptedCount = 0;
  try {
    attemptedCount = candidateCount(
      options.rawDatabase,
      options.nowMs
    );
    const purge = options.rawDatabase.client.transaction(() => {
      options.rawDatabase.client
        .prepare(
          `INSERT INTO raw_delete_audit (
             delete_run_id, cutoff_at_ms, attempted_count,
             deleted_count, failed_count, status, started_at_ms,
             finished_at_ms, expires_at_ms
           ) VALUES (?, ?, ?, 0, 0, 'RUNNING', ?, NULL, ?)`
        )
        .run(
          options.deleteRunId,
          options.nowMs,
          attemptedCount,
          options.nowMs,
          options.nowMs + AUDIT_RETENTION_MS
        );
      options.beforeDelete?.();

      let deletedCount = 0;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM raw_review_ciphertext
            WHERE retention_until_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM kakao_place_locator
            WHERE delete_by_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM review_seen_fingerprint
            WHERE expires_at_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM review_store_sync_state
            WHERE expires_at_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM deidentification_failure
            WHERE expires_at_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM review_checkpoint
            WHERE expires_at_ms <= ?`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM kakao_place_observation
            WHERE expires_at_ms <= ?
              AND NOT EXISTS (
                SELECT 1 FROM raw_review_ciphertext review
                 WHERE review.observation_id =
                   kakao_place_observation.observation_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM kakao_place_locator locator
                 WHERE locator.observation_id =
                   kakao_place_observation.observation_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM review_checkpoint checkpoint
                 WHERE checkpoint.observation_id =
                   kakao_place_observation.observation_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM deidentification_failure failure
                 WHERE failure.observation_id =
                   kakao_place_observation.observation_id
              )`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM review_collection_run
            WHERE expires_at_ms <= ?
              AND NOT EXISTS (
                SELECT 1 FROM raw_review_ciphertext review
                 WHERE review.run_id =
                   review_collection_run.run_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM review_checkpoint checkpoint
                 WHERE checkpoint.run_id =
                   review_collection_run.run_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM deidentification_failure failure
                 WHERE failure.run_id =
                   review_collection_run.run_id
              )`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM kakao_discovery_run
            WHERE expires_at_ms <= ?
              AND NOT EXISTS (
                SELECT 1 FROM kakao_place_observation observation
                 WHERE observation.run_id =
                   kakao_discovery_run.run_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM review_collection_run review_run
                 WHERE review_run.discovery_run_id =
                   kakao_discovery_run.run_id
              )`
        )
        .run(options.nowMs).changes;
      deletedCount += options.rawDatabase.client
        .prepare(
          `DELETE FROM raw_delete_audit
            WHERE expires_at_ms <= ?
              AND delete_run_id <> ?`
        )
        .run(options.nowMs, options.deleteRunId).changes;

      options.rawDatabase.client
        .prepare(
          `UPDATE raw_delete_audit
              SET deleted_count = ?, status = 'SUCCEEDED',
                  finished_at_ms = ?
            WHERE delete_run_id = ?`
        )
        .run(deletedCount, options.nowMs, options.deleteRunId);
      return deletedCount;
    });
    const deletedCount = purge();
    return {
      status: "SUCCEEDED",
      attemptedCount,
      deletedCount,
      failedCount: 0,
      killSwitchActivated: false
    };
  } catch {
    try {
      options.rawDatabase.client
        .prepare(
          `INSERT INTO raw_delete_audit (
             delete_run_id, cutoff_at_ms, attempted_count,
             deleted_count, failed_count, status, started_at_ms,
             finished_at_ms, expires_at_ms
           ) VALUES (?, ?, ?, 0, ?, 'FAILED', ?, ?, ?)`
        )
        .run(
          options.deleteRunId,
          options.nowMs,
          attemptedCount,
          attemptedCount,
          options.nowMs,
          options.nowMs,
          options.nowMs + AUDIT_RETENTION_MS
        );
    } catch {
      // Best effort only: the kill switch must still activate.
    }
    options.onKillSwitch?.("RAW_DELETE_FAILED");
    return {
      status: "FAILED_FINAL",
      attemptedCount,
      deletedCount: 0,
      failedCount: attemptedCount,
      killSwitchActivated: true
    };
  }
}
