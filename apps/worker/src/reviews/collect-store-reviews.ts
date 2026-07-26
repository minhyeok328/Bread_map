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
  ReviewPageResult
} from "./extract-review-page.js";
import type { ReviewSecrets } from "./review-secrets.js";

const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const MAX_REVIEWS_PER_STORE = 20;

export type EncryptedReviewInsertResult =
  | "inserted"
  | "duplicate";

export interface ReviewPageSource {
  readPage(pageNumber: number): Promise<ReviewPageResult>;
}

export type StoreReviewCollectionResult =
  | {
      status: "COMPLETE" | "SKIPPED";
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    }
  | {
      status: "STOP_PROVIDER";
      reasonCode:
        | "LOGIN_REQUIRED"
        | "CAPTCHA"
        | "ACCESS_DENIED"
        | "DOM_CONTRACT_CHANGED";
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
  source: ReviewPageSource;
  secrets: ReviewSecrets;
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
       ON CONFLICT(store_id, provider, fingerprint) DO NOTHING`
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

function protectOneReview(
  raw: MemoryOnlyReview,
  options: CollectStoreReviewsOptions,
  pageNumber: number,
  reviewIndex: number,
  nowMs: number
): EncryptedReviewInsertResult | "rejected" {
  const normalizedNickname = normalizeNickname(raw.nickname);
  raw.nickname = "";
  const deidentified = deidentifyReview(raw.body);
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
    return "rejected";
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
  return insertResult;
}

export async function collectStoreReviews(
  options: CollectStoreReviewsOptions
): Promise<StoreReviewCollectionResult> {
  if (isAlreadyComplete(options)) {
    return {
      status: "SKIPPED",
      collectedCount: 0,
      duplicateCount: 0,
      rejectedPiiCount: 0
    };
  }

  const now = options.now ?? Date.now;
  let collectedCount = 0;
  let duplicateCount = 0;
  let rejectedPiiCount = 0;
  let processedCount = 0;
  let pageNumber = 1;

  while (processedCount < MAX_REVIEWS_PER_STORE) {
    let page: ReviewPageResult;
    try {
      page = await options.source.readPage(pageNumber);
    } catch {
      throw new StoreReviewCollectionError();
    }
    if (page.status === "STOP_PROVIDER") {
      return {
        ...page,
        collectedCount,
        duplicateCount,
        rejectedPiiCount
      };
    }
    if (page.reviews.length === 0 && page.hasNext) {
      throw new StoreReviewCollectionError();
    }

    for (const [reviewIndex, raw] of page.reviews.entries()) {
      if (processedCount >= MAX_REVIEWS_PER_STORE) {
        break;
      }
      processedCount += 1;
      const result = protectOneReview(
        raw,
        options,
        pageNumber,
        reviewIndex,
        now()
      );
      if (result === "inserted") {
        collectedCount += 1;
      } else if (result === "duplicate") {
        duplicateCount += 1;
      } else {
        rejectedPiiCount += 1;
      }
    }

    if (
      processedCount >= MAX_REVIEWS_PER_STORE ||
      !page.hasNext
    ) {
      break;
    }
    pageNumber += 1;
  }

  persistFinalCheckpoint({
    rawDatabase: options.rawDatabase,
    runId: options.runId,
    observationId: options.observationId,
    storeId: options.storeId,
    state: processedCount === 0 ? "NO_REVIEWS" : "COMPLETE",
    committedAtMs: now()
  });
  return {
    status: "COMPLETE",
    collectedCount,
    duplicateCount,
    rejectedPiiCount
  };
}
