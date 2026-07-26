import { createHash } from "node:crypto";
import type { RawDatabaseHandle } from "@bread-map/raw-db";
import {
  reviewCollectionSummarySchema,
  type ReviewCollectionSummary
} from "@bread-map/contracts";
import {
  collectStoreReviews,
  StoreReviewCollectionError,
  type ReviewPageSource,
  type StoreReviewCollectionResult
} from "./collect-store-reviews.js";
import type { ReviewSecrets } from "./review-secrets.js";

export { StoreReviewCollectionError };

const AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export interface ReviewBatchTarget {
  observationId: string;
  storeId: string;
  locator: string;
}

export interface RunReviewBatchOptions {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  discoveryRunId: string;
  catalogSnapshotId: string;
  policySnapshotId: string;
  selectorContractVersion: string;
  secrets: ReviewSecrets;
  now?: () => number;
  shouldPause?: () => boolean;
  pageSourceFactory?: (
    target: ReviewBatchTarget
  ) => ReviewPageSource;
  collectStoreImpl?: (
    target: ReviewBatchTarget
  ) => Promise<StoreReviewCollectionResult>;
}

interface RunRow {
  discovery_run_id: string;
  catalog_snapshot_id: string;
  policy_snapshot_id: string;
  selector_contract_version: string;
  status: string;
  store_count: number;
  collected_count: number;
  duplicate_count: number;
  rejected_pii_count: number;
  failed_store_count: number;
}

function stableId(namespace: string, input: string): string {
  return `${namespace}_${createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 24)}`;
}

function loadTargets(
  rawDatabase: RawDatabaseHandle,
  discoveryRunId: string
): ReviewBatchTarget[] {
  return rawDatabase.client
    .prepare(
      `SELECT
         observation.observation_id AS observationId,
         observation.matched_store_id AS storeId,
         locator.place_url AS locator
       FROM kakao_place_observation observation
       JOIN kakao_place_locator locator
         ON locator.observation_id = observation.observation_id
       WHERE observation.run_id = ?
         AND observation.match_status = 'MATCHED_ELIGIBLE'
       ORDER BY observation.matched_store_id`
    )
    .all(discoveryRunId) as ReviewBatchTarget[];
}

function upsertStoreState(
  rawDatabase: RawDatabaseHandle,
  input: {
    runId: string;
    target: ReviewBatchTarget;
    state:
      | "PENDING"
      | "RUNNING"
      | "COMPLETE"
      | "FAILED_STORE"
      | "STOPPED_PROVIDER";
    nowMs: number;
  }
): void {
  const checkpointId = stableId(
    "review_checkpoint",
    `${input.runId}:${input.target.storeId}:0`
  );
  rawDatabase.client
    .prepare(
      `INSERT INTO review_checkpoint (
         checkpoint_id, run_id, observation_id, store_id, page_number,
         page_cursor, last_fingerprint, state, committed_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, 0, 'batch', NULL, ?, ?, ?)
       ON CONFLICT(run_id, store_id, page_number) DO UPDATE SET
         state = excluded.state,
         committed_at_ms = excluded.committed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      checkpointId,
      input.runId,
      input.target.observationId,
      input.target.storeId,
      input.state,
      input.nowMs,
      input.nowMs + AUDIT_RETENTION_MS
    );
}

function checkpointState(
  rawDatabase: RawDatabaseHandle,
  runId: string,
  storeId: string
): string | null {
  const row = rawDatabase.client
    .prepare(
      `SELECT state
         FROM review_checkpoint
        WHERE run_id = ?
          AND store_id = ?
          AND page_number = 0`
    )
    .get(runId, storeId) as { state: string } | undefined;
  return row?.state ?? null;
}

function updateRun(
  rawDatabase: RawDatabaseHandle,
  input: {
    runId: string;
    status: ReviewCollectionSummary["status"];
    active: boolean;
    collectedCount: number;
    duplicateCount: number;
    rejectedPiiCount: number;
    failedStoreCount: number;
    finishedAtMs: number | null;
  }
): void {
  rawDatabase.client
    .prepare(
      `UPDATE review_collection_run
          SET status = ?,
              active_slot = ?,
              collected_count = ?,
              duplicate_count = ?,
              rejected_pii_count = ?,
              failed_store_count = ?,
              finished_at_ms = ?
        WHERE run_id = ?`
    )
    .run(
      input.status,
      input.active ? 1 : null,
      input.collectedCount,
      input.duplicateCount,
      input.rejectedPiiCount,
      input.failedStoreCount,
      input.finishedAtMs,
      input.runId
    );
}

function summaryFromRow(
  rawDatabase: RawDatabaseHandle,
  runId: string
): ReviewCollectionSummary {
  const row = rawDatabase.client
    .prepare(
      `SELECT
         run_id AS runId,
         status,
         store_count AS storeCount,
         collected_count AS collectedCount,
         duplicate_count AS duplicateCount,
         rejected_pii_count AS rejectedPiiCount,
         failed_store_count AS failedStoreCount
       FROM review_collection_run
       WHERE run_id = ?`
    )
    .get(runId);
  return reviewCollectionSummarySchema.parse(row);
}

export async function runReviewBatch(
  options: RunReviewBatchOptions
): Promise<ReviewCollectionSummary> {
  const now = options.now ?? Date.now;
  let run = options.rawDatabase.client
    .prepare(
      `SELECT *
         FROM review_collection_run
        WHERE run_id = ?`
    )
    .get(options.runId) as RunRow | undefined;

  if (
    run !== undefined &&
    (run.discovery_run_id !== options.discoveryRunId ||
      run.catalog_snapshot_id !== options.catalogSnapshotId ||
      run.policy_snapshot_id !== options.policySnapshotId ||
      run.selector_contract_version !==
        options.selectorContractVersion)
  ) {
    throw new Error("REVIEW_RUN_CONFLICT");
  }
  if (run?.status === "SUCCEEDED") {
    return summaryFromRow(options.rawDatabase, options.runId);
  }

  const targets = loadTargets(
    options.rawDatabase,
    options.discoveryRunId
  );

  if (run === undefined) {
    const startedAtMs = now();
    options.rawDatabase.client
      .prepare(
        `INSERT INTO review_collection_run (
           run_id, discovery_run_id, catalog_snapshot_id,
           policy_snapshot_id, selector_contract_version, status,
           active_slot, store_count, collected_count, duplicate_count,
           rejected_pii_count, failed_store_count, started_at_ms,
           finished_at_ms, expires_at_ms
         ) VALUES (
           ?, ?, ?, ?, ?, 'RUNNING', 1, ?, 0, 0, 0, 0, ?, NULL, ?
         )`
      )
      .run(
        options.runId,
        options.discoveryRunId,
        options.catalogSnapshotId,
        options.policySnapshotId,
        options.selectorContractVersion,
        targets.length,
        startedAtMs,
        startedAtMs + AUDIT_RETENTION_MS
      );
    for (const target of targets) {
      upsertStoreState(options.rawDatabase, {
        runId: options.runId,
        target,
        state: "PENDING",
        nowMs: startedAtMs
      });
    }
    run = options.rawDatabase.client
      .prepare(
        `SELECT * FROM review_collection_run WHERE run_id = ?`
      )
      .get(options.runId) as RunRow;
  } else {
    if (run.store_count !== targets.length) {
      throw new Error("REVIEW_RUN_CONFLICT");
    }
    updateRun(options.rawDatabase, {
      runId: options.runId,
      status: "RUNNING",
      active: true,
      collectedCount: run.collected_count,
      duplicateCount: run.duplicate_count,
      rejectedPiiCount: run.rejected_pii_count,
      failedStoreCount: run.failed_store_count,
      finishedAtMs: null
    });
  }

  let collectedCount = run.collected_count;
  let duplicateCount = run.duplicate_count;
  let rejectedPiiCount = run.rejected_pii_count;
  let failedStoreCount = run.failed_store_count;
  let finalStatus: ReviewCollectionSummary["status"] = "SUCCEEDED";

  for (const target of targets) {
    const state = checkpointState(
      options.rawDatabase,
      options.runId,
      target.storeId
    );
    if (state === "COMPLETE" || state === "NO_REVIEWS") {
      continue;
    }
    if (options.shouldPause?.() === true) {
      finalStatus = "PAUSED";
      break;
    }
    upsertStoreState(options.rawDatabase, {
      runId: options.runId,
      target,
      state: "RUNNING",
      nowMs: now()
    });

    try {
      const result =
        options.collectStoreImpl !== undefined
          ? await options.collectStoreImpl(target)
          : await collectStoreReviews({
              rawDatabase: options.rawDatabase,
              runId: options.runId,
              observationId: target.observationId,
              storeId: target.storeId,
              source:
                options.pageSourceFactory?.(target) ??
                (() => {
                  throw new StoreReviewCollectionError();
                })(),
              secrets: options.secrets,
              now
            });
      collectedCount += result.collectedCount;
      duplicateCount += result.duplicateCount;
      rejectedPiiCount += result.rejectedPiiCount;

      if (result.status === "STOP_PROVIDER") {
        upsertStoreState(options.rawDatabase, {
          runId: options.runId,
          target,
          state: "STOPPED_PROVIDER",
          nowMs: now()
        });
        finalStatus =
          result.reasonCode === "DOM_CONTRACT_CHANGED"
            ? "STOPPED_POLICY"
            : "STOPPED_ACCESS";
        break;
      }
      upsertStoreState(options.rawDatabase, {
        runId: options.runId,
        target,
        state: "COMPLETE",
        nowMs: now()
      });
    } catch (error) {
      if (error instanceof StoreReviewCollectionError) {
        failedStoreCount += 1;
        upsertStoreState(options.rawDatabase, {
          runId: options.runId,
          target,
          state: "FAILED_STORE",
          nowMs: now()
        });
        continue;
      }
      finalStatus = "FAILED_FINAL";
      break;
    } finally {
      updateRun(options.rawDatabase, {
        runId: options.runId,
        status:
          finalStatus === "SUCCEEDED" ? "RUNNING" : finalStatus,
        active: finalStatus === "SUCCEEDED",
        collectedCount,
        duplicateCount,
        rejectedPiiCount,
        failedStoreCount,
        finishedAtMs: null
      });
    }
  }

  const finishRun = options.rawDatabase.client.transaction(() => {
    updateRun(options.rawDatabase, {
      runId: options.runId,
      status: finalStatus,
      active: false,
      collectedCount,
      duplicateCount,
      rejectedPiiCount,
      failedStoreCount,
      finishedAtMs: now()
    });
    if (finalStatus === "SUCCEEDED") {
      options.rawDatabase.client
        .prepare(
          `DELETE FROM kakao_place_locator
            WHERE observation_id IN (
              SELECT observation_id
                FROM kakao_place_observation
               WHERE run_id = ?
            )`
        )
        .run(options.discoveryRunId);
    }
  });
  finishRun();
  return summaryFromRow(options.rawDatabase, options.runId);
}
