import { createHash } from "node:crypto";
import type { RawDatabaseHandle } from "@bread-map/raw-db";
import {
  reviewCollectionSummarySchema,
  type ReviewCollectionSummary
} from "@bread-map/contracts";
import {
  collectStoreReviews,
  ReviewSyncKeyVersionMismatchError,
  StoreReviewCollectionError,
  type ReviewPageSource,
  type ReviewStoreCollectionMode,
  type StoreReviewCollectionResult
} from "./collect-store-reviews.js";
import type { ReviewSecrets } from "./review-secrets.js";
import { loadStoreSyncState } from "./review-sync-state.js";

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
  selectorContractVersion: "kakao-review-dom-v2";
  asOfDate: string;
  runBudgetMs: number;
  secrets: ReviewSecrets;
  now?: () => number;
  shouldPauseOperator?: () => boolean;
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
  as_of_date: string;
  fingerprint_key_version: string;
  run_budget_ms: number;
  status: string;
  store_count: number;
  initial_backfill_store_count: number;
  incremental_store_count: number;
  backfill_fallback_store_count: number;
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
    mode?: ReviewStoreCollectionMode;
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
       ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?, ?)
       ON CONFLICT(run_id, store_id, page_number) DO UPDATE SET
         page_cursor = excluded.page_cursor,
         state = excluded.state,
         committed_at_ms = excluded.committed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      checkpointId,
      input.runId,
      input.target.observationId,
      input.target.storeId,
      `batch|${input.mode ?? "INITIAL_BACKFILL"}`,
      input.state,
      input.nowMs,
      input.nowMs + AUDIT_RETENTION_MS
    );
}

function checkpointMode(
  rawDatabase: RawDatabaseHandle,
  runId: string,
  storeId: string
): ReviewStoreCollectionMode | null {
  const row = rawDatabase.client
    .prepare(
      `SELECT page_cursor AS pageCursor
         FROM review_checkpoint
        WHERE run_id = ?
          AND store_id = ?
          AND page_number = 0`
    )
    .get(runId, storeId) as { pageCursor: string | null } | undefined;
  const mode = row?.pageCursor?.split("|")[1];
  return mode === "INITIAL_BACKFILL" ||
    mode === "INCREMENTAL" ||
    mode === "BACKFILL_FALLBACK"
    ? mode
    : null;
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
    initialBackfillStoreCount: number;
    incrementalStoreCount: number;
    backfillFallbackStoreCount: number;
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
              initial_backfill_store_count = ?,
              incremental_store_count = ?,
              backfill_fallback_store_count = ?,
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
      input.initialBackfillStoreCount,
      input.incrementalStoreCount,
      input.backfillFallbackStoreCount,
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
         initial_backfill_store_count AS initialBackfillStoreCount,
         incremental_store_count AS incrementalStoreCount,
         backfill_fallback_store_count AS backfillFallbackStoreCount,
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
  if (
    !Number.isInteger(options.runBudgetMs) ||
    options.runBudgetMs < 1 ||
    options.runBudgetMs > 28_800_000
  ) {
    throw new Error("REVIEW_RUN_BUDGET_INVALID");
  }
  const invocationStartedAtMs = now();
  const budgetDeadlineMs =
    invocationStartedAtMs + options.runBudgetMs;
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
        options.selectorContractVersion ||
      run.as_of_date !== options.asOfDate ||
      run.fingerprint_key_version !== options.secrets.keyVersion ||
      run.run_budget_ms !== options.runBudgetMs)
  ) {
    throw new Error("REVIEW_RUN_CONFLICT");
  }
  if (run?.status === "SUCCEEDED" || run?.status === "PARTIAL") {
    return summaryFromRow(options.rawDatabase, options.runId);
  }

  const targets = loadTargets(
    options.rawDatabase,
    options.discoveryRunId
  );

  if (run === undefined) {
    const targetModes = new Map<
      string,
      ReviewStoreCollectionMode
    >();
    let initialBackfillStoreCount = 0;
    let incrementalStoreCount = 0;
    for (const target of targets) {
      const syncState = loadStoreSyncState({
        rawDatabase: options.rawDatabase,
        storeId: target.storeId,
        keyVersion: options.secrets.keyVersion
      });
      if (syncState.status === "KEY_VERSION_MISMATCH") {
        throw new ReviewSyncKeyVersionMismatchError();
      }
      const mode =
        syncState.status === "READY"
          ? "INCREMENTAL"
          : "INITIAL_BACKFILL";
      targetModes.set(target.storeId, mode);
      if (mode === "INCREMENTAL") {
        incrementalStoreCount += 1;
      } else {
        initialBackfillStoreCount += 1;
      }
    }
    const startedAtMs = now();
    options.rawDatabase.client
      .prepare(
        `INSERT INTO review_collection_run (
           run_id, discovery_run_id, catalog_snapshot_id,
           policy_snapshot_id, selector_contract_version, as_of_date,
           fingerprint_key_version, run_budget_ms, status, active_slot,
           store_count, initial_backfill_store_count,
           incremental_store_count, backfill_fallback_store_count,
           collected_count, duplicate_count, rejected_pii_count,
           failed_store_count, started_at_ms, finished_at_ms,
           expires_at_ms
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', 1, ?, ?, ?, 0,
           0, 0, 0, 0, ?, NULL, ?
         )`
      )
      .run(
        options.runId,
        options.discoveryRunId,
        options.catalogSnapshotId,
        options.policySnapshotId,
        options.selectorContractVersion,
        options.asOfDate,
        options.secrets.keyVersion,
        options.runBudgetMs,
        targets.length,
        initialBackfillStoreCount,
        incrementalStoreCount,
        startedAtMs,
        startedAtMs + AUDIT_RETENTION_MS
      );
    for (const target of targets) {
      upsertStoreState(options.rawDatabase, {
        runId: options.runId,
        target,
        state: "PENDING",
        mode:
          targetModes.get(target.storeId) ??
          "INITIAL_BACKFILL",
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
      initialBackfillStoreCount:
        run.initial_backfill_store_count,
      incrementalStoreCount: run.incremental_store_count,
      backfillFallbackStoreCount:
        run.backfill_fallback_store_count,
      finishedAtMs: null
    });
  }

  let collectedCount = run.collected_count;
  let duplicateCount = run.duplicate_count;
  let rejectedPiiCount = run.rejected_pii_count;
  let failedStoreCount = run.failed_store_count;
  const initialBackfillStoreCount =
    run.initial_backfill_store_count;
  let incrementalStoreCount = run.incremental_store_count;
  let backfillFallbackStoreCount =
    run.backfill_fallback_store_count;
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
    if (options.shouldPauseOperator?.() === true) {
      finalStatus = "PAUSED_OPERATOR";
      break;
    }
    if (now() >= budgetDeadlineMs) {
      finalStatus = "PAUSED_BUDGET";
      break;
    }
    const targetMode =
      checkpointMode(
        options.rawDatabase,
        options.runId,
        target.storeId
      ) ?? "INITIAL_BACKFILL";
    upsertStoreState(options.rawDatabase, {
      runId: options.runId,
      target,
      state: "RUNNING",
      mode: targetMode,
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
              asOfDate: options.asOfDate,
              source:
                options.pageSourceFactory?.(target) ??
                (() => {
                  throw new StoreReviewCollectionError();
                })(),
              secrets: options.secrets,
              shouldPauseBudget: () => now() >= budgetDeadlineMs,
              now
            });
      collectedCount += result.collectedCount;
      duplicateCount += result.duplicateCount;
      rejectedPiiCount += result.rejectedPiiCount;

      if (
        result.mode === "BACKFILL_FALLBACK" &&
        targetMode === "INCREMENTAL"
      ) {
        incrementalStoreCount -= 1;
        backfillFallbackStoreCount += 1;
      }

      if (result.status === "PAUSED_BUDGET") {
        upsertStoreState(options.rawDatabase, {
          runId: options.runId,
          target,
          state: "RUNNING",
          mode: result.mode,
          nowMs: now()
        });
        finalStatus = "PAUSED_BUDGET";
        break;
      }
      if (result.status === "STOP_PROVIDER") {
        upsertStoreState(options.rawDatabase, {
          runId: options.runId,
          target,
          state: "STOPPED_PROVIDER",
          mode: result.mode,
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
        mode: result.mode,
        nowMs: now()
      });
    } catch (error) {
      if (error instanceof StoreReviewCollectionError) {
        failedStoreCount += 1;
        upsertStoreState(options.rawDatabase, {
          runId: options.runId,
          target,
          state: "FAILED_STORE",
          mode: targetMode,
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
        initialBackfillStoreCount,
        incrementalStoreCount,
        backfillFallbackStoreCount,
        finishedAtMs: null
      });
    }
  }

  if (finalStatus === "SUCCEEDED" && failedStoreCount > 0) {
    finalStatus = "PARTIAL";
  }
  const paused =
    finalStatus === "PAUSED_OPERATOR" ||
    finalStatus === "PAUSED_BUDGET";
  const finishRun = options.rawDatabase.client.transaction(() => {
    updateRun(options.rawDatabase, {
      runId: options.runId,
      status: finalStatus,
      active: false,
      collectedCount,
      duplicateCount,
      rejectedPiiCount,
      failedStoreCount,
      initialBackfillStoreCount,
      incrementalStoreCount,
      backfillFallbackStoreCount,
      finishedAtMs: paused ? null : now()
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
