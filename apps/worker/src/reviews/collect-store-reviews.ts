import { createHash } from "node:crypto";
import type { RawDatabaseHandle } from "@bread-map/raw-db";
import { deidentifyReview } from "./deidentify-review.js";
import {
  encryptRawReview,
  type EncryptedRawReview,
  type EncryptedReviewPayloadV1,
  type ReviewAadV1
} from "./encrypt-raw-review.js";
import {
  createReviewId,
  fingerprintReview,
  normalizeNickname,
  ReviewFingerprintError
} from "./fingerprint-review.js";
import type {
  MemoryOnlyReview,
  ReviewPageResult,
  ReviewProviderStopReason
} from "./extract-review-page.js";
import type { ReviewSecrets } from "./review-secrets.js";
import {
  findSeenFingerprint,
  loadStoreSyncState,
  persistSuccessfulStoreSync,
  recordSeenFingerprint
} from "./review-sync-state.js";

const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export type ReviewStoreCollectionMode =
  | "INITIAL_BACKFILL"
  | "INCREMENTAL"
  | "BACKFILL_FALLBACK";

export type EncryptedReviewInsertResult =
  | "inserted"
  | "duplicate";

export interface ReviewPageSource {
  readPage(pageNumber: number): Promise<ReviewPageResult>;
}

export type StoreReviewCollectionResult =
  | {
      status: "COMPLETE" | "SKIPPED";
      mode: ReviewStoreCollectionMode;
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    }
  | {
      status: "PAUSED_BUDGET";
      mode: ReviewStoreCollectionMode;
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    }
  | {
      status: "STOP_PROVIDER";
      reasonCode: ReviewProviderStopReason;
      mode: ReviewStoreCollectionMode;
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    };

export class StoreReviewCollectionError extends Error {
  readonly code = "STORE_REVIEW_COLLECTION_FAILED";

  constructor() {
    super("STORE_REVIEW_COLLECTION_FAILED");
    this.name = "StoreReviewCollectionError";
  }
}

export class ReviewSyncKeyVersionMismatchError extends Error {
  readonly code = "REVIEW_SYNC_KEY_VERSION_MISMATCH";

  constructor() {
    super("REVIEW_SYNC_KEY_VERSION_MISMATCH");
    this.name = "ReviewSyncKeyVersionMismatchError";
  }
}

export interface PersistEncryptedReviewInput {
  rawDatabase: RawDatabaseHandle;
  reviewId: string;
  runId: string;
  observationId: string;
  storeId: string;
  encrypted: EncryptedRawReview;
  fingerprint: Buffer;
  collectedAtMs: number;
  retentionUntilMs: number;
}

export interface PersistDeidentificationFailureInput {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  reasonCode: "REJECTED_PII" | "REJECTED_EMPTY";
  occurredAtMs: number;
  failureKey?: string;
}

export interface PersistReviewCheckpointInput {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  pageNumber: number;
  pageCursor: string;
  fingerprint: Buffer;
  insertResult: EncryptedReviewInsertResult;
  committedAtMs: number;
}

export interface CollectStoreReviewsOptions {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  asOfDate: string;
  source: ReviewPageSource;
  secrets: ReviewSecrets;
  shouldPauseBudget?: () => boolean;
  now?: () => number;
  afterRawCommit?: () => void;
}

function stableId(namespace: string, input: string): string {
  return `${namespace}_${createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 24)}`;
}

export function persistEncryptedReview(
  input: PersistEncryptedReviewInput
): EncryptedReviewInsertResult {
  const result = input.rawDatabase.client
    .prepare(
      `INSERT INTO raw_review_ciphertext (
         review_id, run_id, observation_id, store_id, provider,
         ciphertext, nonce, auth_tag, key_version, aad_version,
         fingerprint, collected_at_ms, retention_until_ms
       ) VALUES (
         ?, ?, ?, ?, 'KAKAO_MAP', ?, ?, ?, ?, ?, ?, ?, ?
       )
       ON CONFLICT(
         store_id, provider, key_version, fingerprint
       ) DO NOTHING`
    )
    .run(
      input.reviewId,
      input.runId,
      input.observationId,
      input.storeId,
      input.encrypted.ciphertext,
      input.encrypted.nonce,
      input.encrypted.authTag,
      input.encrypted.keyVersion,
      input.encrypted.aadVersion,
      input.fingerprint,
      input.collectedAtMs,
      input.retentionUntilMs
    );
  return result.changes === 1 ? "inserted" : "duplicate";
}

export function persistDeidentificationFailure(
  input: PersistDeidentificationFailureInput
): void {
  const failureId = stableId(
    "deid_failure",
    [
      input.runId,
      input.storeId,
      input.reasonCode,
      input.failureKey ?? String(input.occurredAtMs)
    ].join(":")
  );
  input.rawDatabase.client
    .prepare(
      `INSERT INTO deidentification_failure (
         failure_id, run_id, observation_id, store_id, reason_code,
         occurred_at_ms, expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(failure_id) DO NOTHING`
    )
    .run(
      failureId,
      input.runId,
      input.observationId,
      input.storeId,
      input.reasonCode,
      input.occurredAtMs,
      input.occurredAtMs + AUDIT_RETENTION_MS
    );
}

export function persistReviewCheckpoint(
  input: PersistReviewCheckpointInput
): void {
  const checkpointId = stableId(
    "review_checkpoint",
    `${input.runId}:${input.storeId}:${input.pageNumber}`
  );
  input.rawDatabase.client
    .prepare(
      `INSERT INTO review_checkpoint (
         checkpoint_id, run_id, observation_id, store_id, page_number,
         page_cursor, last_fingerprint, state, committed_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?)
       ON CONFLICT(run_id, store_id, page_number) DO UPDATE SET
         page_cursor = excluded.page_cursor,
         last_fingerprint = excluded.last_fingerprint,
         state = 'RUNNING',
         committed_at_ms = excluded.committed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      checkpointId,
      input.runId,
      input.observationId,
      input.storeId,
      input.pageNumber,
      input.pageCursor,
      input.fingerprint,
      input.committedAtMs,
      input.committedAtMs + AUDIT_RETENTION_MS
    );
}

function persistFinalCheckpoint(
  input: {
    rawDatabase: RawDatabaseHandle;
    runId: string;
    observationId: string;
    storeId: string;
    state: "COMPLETE" | "NO_REVIEWS";
    committedAtMs: number;
  }
): void {
  const checkpointId = stableId(
    "review_checkpoint",
    `${input.runId}:${input.storeId}:0`
  );
  input.rawDatabase.client
    .prepare(
      `INSERT INTO review_checkpoint (
         checkpoint_id, run_id, observation_id, store_id, page_number,
         page_cursor, last_fingerprint, state, committed_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, 0, 'final', NULL, ?, ?, ?)
       ON CONFLICT(run_id, store_id, page_number) DO UPDATE SET
         page_cursor = 'final',
         last_fingerprint = NULL,
         state = excluded.state,
         committed_at_ms = excluded.committed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      checkpointId,
      input.runId,
      input.observationId,
      input.storeId,
      input.state,
      input.committedAtMs,
      input.committedAtMs + AUDIT_RETENTION_MS
    );
}

function isAlreadyComplete(
  options: CollectStoreReviewsOptions
): boolean {
  const row = options.rawDatabase.client
    .prepare(
      `SELECT state
         FROM review_checkpoint
        WHERE run_id = ?
          AND store_id = ?
          AND page_number = 0`
    )
    .get(options.runId, options.storeId) as
    | { state: string }
    | undefined;
  return row?.state === "COMPLETE" || row?.state === "NO_REVIEWS";
}

interface StoreResumeState {
  pageNumber: number;
  mode: ReviewStoreCollectionMode;
  previousAnchorSeen: boolean;
  newAnchorFingerprint: Buffer | null;
  newAnchorPublishedDate: string | null;
}

function isCollectionMode(
  value: string
): value is ReviewStoreCollectionMode {
  return (
    value === "INITIAL_BACKFILL" ||
    value === "INCREMENTAL" ||
    value === "BACKFILL_FALLBACK"
  );
}

function loadResumeState(
  options: CollectStoreReviewsOptions,
  initialMode: ReviewStoreCollectionMode
): StoreResumeState {
  const latest = options.rawDatabase.client
    .prepare(
      `SELECT page_number AS pageNumber, page_cursor AS pageCursor
         FROM review_checkpoint
        WHERE run_id = ?
          AND store_id = ?
          AND page_number > 0
        ORDER BY page_number DESC
        LIMIT 1`
    )
    .get(options.runId, options.storeId) as
    | { pageNumber: number; pageCursor: string | null }
    | undefined;
  const completed = options.rawDatabase.client
    .prepare(
      `SELECT page_number AS pageNumber, page_cursor AS pageCursor,
              last_fingerprint AS anchorFingerprint
         FROM review_checkpoint
        WHERE run_id = ?
          AND store_id = ?
          AND page_number > 0
          AND page_cursor LIKE 'page-complete|%'
        ORDER BY page_number DESC
        LIMIT 1`
    )
    .get(options.runId, options.storeId) as
    | {
        pageNumber: number;
        pageCursor: string;
        anchorFingerprint: Buffer | null;
      }
    | undefined;

  if (completed === undefined) {
    return {
      pageNumber: latest?.pageNumber ?? 1,
      mode: initialMode,
      previousAnchorSeen: false,
      newAnchorFingerprint: null,
      newAnchorPublishedDate: null
    };
  }
  const [, storedMode, anchorSeenValue, anchorDateValue] =
    completed.pageCursor.split("|");
  if (
    storedMode === undefined ||
    !isCollectionMode(storedMode) ||
    (anchorSeenValue !== "0" && anchorSeenValue !== "1") ||
    anchorDateValue === undefined ||
    ((completed.anchorFingerprint === null) !==
      (anchorDateValue === "-"))
  ) {
    throw new Error("REVIEW_CHECKPOINT_INVALID");
  }
  const latestWasCompleted =
    latest?.pageCursor?.startsWith("page-complete|") === true;
  return {
    pageNumber:
      latest === undefined
        ? 1
        : latest.pageNumber + (latestWasCompleted ? 1 : 0),
    mode: storedMode,
    previousAnchorSeen: anchorSeenValue === "1",
    newAnchorFingerprint:
      completed.anchorFingerprint === null
        ? null
        : Buffer.from(completed.anchorFingerprint),
    newAnchorPublishedDate:
      anchorDateValue === "-" ? null : anchorDateValue
  };
}

function persistCompletedPageCheckpoint(input: {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  pageNumber: number;
  mode: ReviewStoreCollectionMode;
  previousAnchorSeen: boolean;
  newAnchorFingerprint: Buffer | null;
  newAnchorPublishedDate: string | null;
  committedAtMs: number;
}): void {
  const checkpointId = stableId(
    "review_checkpoint",
    `${input.runId}:${input.storeId}:${input.pageNumber}`
  );
  const anchorDate = input.newAnchorPublishedDate ?? "-";
  input.rawDatabase.client
    .prepare(
      `INSERT INTO review_checkpoint (
         checkpoint_id, run_id, observation_id, store_id, page_number,
         page_cursor, last_fingerprint, state, committed_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?)
       ON CONFLICT(run_id, store_id, page_number) DO UPDATE SET
         page_cursor = excluded.page_cursor,
         last_fingerprint = excluded.last_fingerprint,
         state = 'RUNNING',
         committed_at_ms = excluded.committed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      checkpointId,
      input.runId,
      input.observationId,
      input.storeId,
      input.pageNumber,
      [
        "page-complete",
        input.mode,
        input.previousAnchorSeen ? "1" : "0",
        anchorDate
      ].join("|"),
      input.newAnchorFingerprint,
      input.committedAtMs,
      input.committedAtMs + AUDIT_RETENTION_MS
    );
}

type ProtectedReviewResult =
  | { disposition: "rejected" }
  | {
      disposition: EncryptedReviewInsertResult;
      fingerprint: Buffer;
      publishedDate: string;
      wasSeen: boolean;
    };

function protectOneReview(
  raw: MemoryOnlyReview,
  options: CollectStoreReviewsOptions,
  pageNumber: number,
  reviewIndex: number,
  nowMs: number
): ProtectedReviewResult {
  const normalizedNickname = normalizeNickname(raw.nickname);
  raw.nickname = "";
  const deidentified = deidentifyReview(raw.body);
  raw.body = "";
  if (!deidentified.accepted) {
    persistDeidentificationFailure({
      rawDatabase: options.rawDatabase,
      runId: options.runId,
      observationId: options.observationId,
      storeId: options.storeId,
      reasonCode: deidentified.reasonCode,
      occurredAtMs: nowMs,
      failureKey: `${pageNumber}:${reviewIndex}`
    });
    return { disposition: "rejected" };
  }

  let fingerprint: Buffer;
  try {
    fingerprint = fingerprintReview(
      {
        provider: "KAKAO_MAP",
        storeId: options.storeId,
        normalizedNickname,
        publishedDate: raw.publishedDate,
        normalizedDeidentifiedText: deidentified.text
      },
      options.secrets.hmacKey
    );
  } catch (error) {
    if (error instanceof ReviewFingerprintError) {
      throw new StoreReviewCollectionError();
    }
    throw error;
  }
  const wasSeen = findSeenFingerprint({
    rawDatabase: options.rawDatabase,
    storeId: options.storeId,
    fingerprint,
    keyVersion: options.secrets.keyVersion
  });
  if (wasSeen) {
    recordSeenFingerprint({
      rawDatabase: options.rawDatabase,
      storeId: options.storeId,
      fingerprint,
      keyVersion: options.secrets.keyVersion,
      publishedDate: raw.publishedDate,
      nowMs
    });
    persistReviewCheckpoint({
      rawDatabase: options.rawDatabase,
      runId: options.runId,
      observationId: options.observationId,
      storeId: options.storeId,
      pageNumber,
      pageCursor: `${pageNumber}:${reviewIndex}`,
      fingerprint,
      insertResult: "duplicate",
      committedAtMs: nowMs
    });
    return {
      disposition: "duplicate",
      fingerprint,
      publishedDate: raw.publishedDate,
      wasSeen: true
    };
  }

  const reviewId = createReviewId(options.storeId, fingerprint);
  const payload: EncryptedReviewPayloadV1 = {
    schemaVersion: 1,
    body: deidentified.text,
    ratingBasisPoints: raw.ratingBasisPoints,
    publishedDate: raw.publishedDate,
    provider: "KAKAO_MAP"
  };
  const aad: ReviewAadV1 = {
    reviewId,
    storeId: options.storeId,
    provider: "KAKAO_MAP",
    schemaVersion: 1
  };
  const encrypted = encryptRawReview(
    payload,
    aad,
    options.secrets.encryptionKey,
    options.secrets.keyVersion
  );
  const insertResult = persistEncryptedReview({
    rawDatabase: options.rawDatabase,
    reviewId,
    runId: options.runId,
    observationId: options.observationId,
    storeId: options.storeId,
    encrypted,
    fingerprint,
    collectedAtMs: nowMs,
    retentionUntilMs: nowMs + RAW_RETENTION_MS
  });
  options.afterRawCommit?.();
  recordSeenFingerprint({
    rawDatabase: options.rawDatabase,
    storeId: options.storeId,
    fingerprint,
    keyVersion: options.secrets.keyVersion,
    publishedDate: raw.publishedDate,
    nowMs
  });
  persistReviewCheckpoint({
    rawDatabase: options.rawDatabase,
    runId: options.runId,
    observationId: options.observationId,
    storeId: options.storeId,
    pageNumber,
    pageCursor: `${pageNumber}:${reviewIndex}`,
    fingerprint,
    insertResult,
    committedAtMs: nowMs
  });
  return {
    disposition: insertResult,
    fingerprint,
    publishedDate: raw.publishedDate,
    wasSeen: false
  };
}

export async function collectStoreReviews(
  options: CollectStoreReviewsOptions
): Promise<StoreReviewCollectionResult> {
  const syncState = loadStoreSyncState({
    rawDatabase: options.rawDatabase,
    storeId: options.storeId,
    keyVersion: options.secrets.keyVersion
  });
  if (syncState.status === "KEY_VERSION_MISMATCH") {
    throw new ReviewSyncKeyVersionMismatchError();
  }
  const initialMode: ReviewStoreCollectionMode =
    syncState.status === "READY"
      ? "INCREMENTAL"
      : "INITIAL_BACKFILL";
  if (isAlreadyComplete(options)) {
    return {
      status: "SKIPPED",
      mode: initialMode,
      collectedCount: 0,
      duplicateCount: 0,
      rejectedPiiCount: 0
    };
  }

  const now = options.now ?? Date.now;
  const resumeState = loadResumeState(options, initialMode);
  let mode = resumeState.mode;
  let previousAnchorSeen = resumeState.previousAnchorSeen;
  let newAnchorFingerprint = resumeState.newAnchorFingerprint;
  let newAnchorPublishedDate =
    resumeState.newAnchorPublishedDate;
  const previousAnchorFingerprint =
    syncState.status === "READY"
      ? syncState.anchorFingerprint
      : null;
  let collectedCount = 0;
  let duplicateCount = 0;
  let rejectedPiiCount = 0;
  let pageNumber = resumeState.pageNumber;

  while (true) {
    let page: ReviewPageResult;
    try {
      page = await options.source.readPage(pageNumber);
    } catch {
      throw new StoreReviewCollectionError();
    }
    if (page.status === "STOP_PROVIDER") {
      return {
        ...page,
        mode,
        collectedCount,
        duplicateCount,
        rejectedPiiCount
      };
    }
    if (page.reviews.length === 0 && page.boundary === "MORE") {
      throw new StoreReviewCollectionError();
    }

    for (const [reviewIndex, raw] of page.reviews.entries()) {
      const protectedReview = protectOneReview(
        raw,
        options,
        pageNumber,
        reviewIndex,
        now()
      );
      if (protectedReview.disposition === "rejected") {
        rejectedPiiCount += 1;
        continue;
      }
      newAnchorFingerprint ??= protectedReview.fingerprint;
      newAnchorPublishedDate ??= protectedReview.publishedDate;

      if (
        mode === "INCREMENTAL" &&
        previousAnchorFingerprint !== null
      ) {
        const isPreviousAnchor =
          protectedReview.fingerprint.equals(
            previousAnchorFingerprint
          );
        if (isPreviousAnchor) {
          previousAnchorSeen = true;
          if (!protectedReview.wasSeen) {
            mode = "BACKFILL_FALLBACK";
          }
        } else if (
          previousAnchorSeen &&
          !protectedReview.wasSeen
        ) {
          mode = "BACKFILL_FALLBACK";
        }
      }

      if (protectedReview.disposition === "inserted") {
        collectedCount += 1;
      } else {
        duplicateCount += 1;
      }
    }

    const committedAtMs = now();
    persistCompletedPageCheckpoint({
      rawDatabase: options.rawDatabase,
      runId: options.runId,
      observationId: options.observationId,
      storeId: options.storeId,
      pageNumber,
      mode,
      previousAnchorSeen,
      newAnchorFingerprint,
      newAnchorPublishedDate,
      committedAtMs
    });

    let complete = false;
    if (mode === "INCREMENTAL" && previousAnchorSeen) {
      complete = true;
    } else if (page.boundary !== "MORE") {
      if (mode === "INCREMENTAL" && !previousAnchorSeen) {
        mode = "BACKFILL_FALLBACK";
        persistCompletedPageCheckpoint({
          rawDatabase: options.rawDatabase,
          runId: options.runId,
          observationId: options.observationId,
          storeId: options.storeId,
          pageNumber,
          mode,
          previousAnchorSeen,
          newAnchorFingerprint,
          newAnchorPublishedDate,
          committedAtMs
        });
      }
      complete = true;
    }

    if (complete) {
      const completeStore = options.rawDatabase.client.transaction(() => {
        persistFinalCheckpoint({
          rawDatabase: options.rawDatabase,
          runId: options.runId,
          observationId: options.observationId,
          storeId: options.storeId,
          state:
            newAnchorFingerprint === null &&
            initialMode === "INITIAL_BACKFILL"
              ? "NO_REVIEWS"
              : "COMPLETE",
          committedAtMs: now()
        });
        if (
          newAnchorFingerprint !== null &&
          newAnchorPublishedDate !== null
        ) {
          persistSuccessfulStoreSync({
            rawDatabase: options.rawDatabase,
            storeId: options.storeId,
            runId: options.runId,
            mode,
            asOfDate: options.asOfDate,
            keyVersion: options.secrets.keyVersion,
            anchorFingerprint: newAnchorFingerprint,
            anchorPublishedDate: newAnchorPublishedDate,
            completedAtMs: now()
          });
        }
      });
      completeStore();
      return {
        status: "COMPLETE",
        mode,
        collectedCount,
        duplicateCount,
        rejectedPiiCount
      };
    }

    if (options.shouldPauseBudget?.() === true) {
      return {
        status: "PAUSED_BUDGET",
        mode,
        collectedCount,
        duplicateCount,
        rejectedPiiCount
      };
    }
    pageNumber += 1;
  }
}
