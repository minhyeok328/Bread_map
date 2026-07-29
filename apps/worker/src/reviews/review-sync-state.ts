import { createHash } from "node:crypto";
import type { RawDatabaseHandle } from "@bread-map/raw-db";

const FOUR_HUNDRED_DAYS_MS = 400 * 24 * 60 * 60 * 1000;
const provider = "KAKAO_MAP";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export interface SeenFingerprintKey {
  storeId: string;
  fingerprint: Buffer;
  keyVersion: string;
}

export type StoreSyncStateResult =
  | { status: "NONE" }
  | { status: "KEY_VERSION_MISMATCH" }
  | {
      status: "READY";
      anchorFingerprint: Buffer;
      anchorPublishedDate: string;
      lastSuccessfulAsOfDate: string;
      lastSuccessfulRunId: string;
    };

export class ReviewSyncStateError extends Error {
  readonly code = "REVIEW_SYNC_STATE_INVALID";

  constructor() {
    super("REVIEW_SYNC_STATE_INVALID");
    this.name = "ReviewSyncStateError";
  }
}

function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function assertSeenKey(input: SeenFingerprintKey): void {
  if (
    input.storeId.trim() === "" ||
    input.keyVersion.trim() === "" ||
    input.fingerprint.length !== 32
  ) {
    throw new ReviewSyncStateError();
  }
}

function stableId(
  namespace: "review_seen" | "review_store_sync",
  parts: Array<string | Buffer>
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `${namespace}_${hash.digest("hex").slice(0, 24)}`;
}

export function findSeenFingerprint(
  input: { rawDatabase: RawDatabaseHandle } & SeenFingerprintKey
): boolean {
  assertSeenKey(input);
  return (
    input.rawDatabase.client
      .prepare(
        `SELECT 1
           FROM review_seen_fingerprint
          WHERE store_id = ?
            AND provider = ?
            AND fingerprint_key_version = ?
            AND fingerprint = ?
          LIMIT 1`
      )
      .get(
        input.storeId,
        provider,
        input.keyVersion,
        input.fingerprint
      ) !== undefined
  );
}

export function recordSeenFingerprint(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  fingerprint: Buffer;
  keyVersion: string;
  publishedDate: string;
  nowMs: number;
}): "inserted" | "seen" {
  assertSeenKey(input);
  if (
    !isIsoDate(input.publishedDate) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0
  ) {
    throw new ReviewSyncStateError();
  }
  const wasSeen = findSeenFingerprint(input);
  const seenId = stableId("review_seen", [
    input.storeId,
    provider,
    input.keyVersion,
    input.fingerprint
  ]);
  input.rawDatabase.client
    .prepare(
      `INSERT INTO review_seen_fingerprint (
         seen_id, store_id, provider, fingerprint_key_version,
         fingerprint, published_date, first_seen_at_ms, last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(
         store_id, provider, fingerprint_key_version, fingerprint
       ) DO UPDATE SET
         last_seen_at_ms = max(
           review_seen_fingerprint.last_seen_at_ms,
           excluded.last_seen_at_ms
         ),
         expires_at_ms = max(
           review_seen_fingerprint.expires_at_ms,
           excluded.expires_at_ms
         )`
    )
    .run(
      seenId,
      input.storeId,
      provider,
      input.keyVersion,
      input.fingerprint,
      input.publishedDate,
      input.nowMs,
      input.nowMs,
      input.nowMs + FOUR_HUNDRED_DAYS_MS
    );
  return wasSeen ? "seen" : "inserted";
}

export function loadStoreSyncState(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  keyVersion: string;
}): StoreSyncStateResult {
  if (input.storeId.trim() === "" || input.keyVersion.trim() === "") {
    throw new ReviewSyncStateError();
  }
  const row = input.rawDatabase.client
    .prepare(
      `SELECT anchor_fingerprint AS anchorFingerprint,
              anchor_fingerprint_key_version AS anchorKeyVersion,
              anchor_published_date AS anchorPublishedDate,
              last_successful_as_of_date AS lastSuccessfulAsOfDate,
              last_successful_run_id AS lastSuccessfulRunId
         FROM review_store_sync_state
        WHERE store_id = ?
          AND provider = ?`
    )
    .get(input.storeId, provider) as
    | {
        anchorFingerprint: Buffer | null;
        anchorKeyVersion: string | null;
        anchorPublishedDate: string | null;
        lastSuccessfulAsOfDate: string;
        lastSuccessfulRunId: string;
      }
    | undefined;

  if (row === undefined) {
    return { status: "NONE" };
  }
  if (row.anchorKeyVersion !== input.keyVersion) {
    return { status: "KEY_VERSION_MISMATCH" };
  }
  if (
    row.anchorFingerprint === null ||
    row.anchorPublishedDate === null
  ) {
    return { status: "NONE" };
  }
  return {
    status: "READY",
    anchorFingerprint: Buffer.from(row.anchorFingerprint),
    anchorPublishedDate: row.anchorPublishedDate,
    lastSuccessfulAsOfDate: row.lastSuccessfulAsOfDate,
    lastSuccessfulRunId: row.lastSuccessfulRunId
  };
}

export function persistSuccessfulStoreSync(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  runId: string;
  mode: "INITIAL_BACKFILL" | "INCREMENTAL" | "BACKFILL_FALLBACK";
  asOfDate: string;
  keyVersion: string;
  anchorFingerprint: Buffer;
  anchorPublishedDate: string;
  completedAtMs: number;
}): void {
  assertSeenKey({
    storeId: input.storeId,
    fingerprint: input.anchorFingerprint,
    keyVersion: input.keyVersion
  });
  if (
    input.runId.trim() === "" ||
    !isIsoDate(input.asOfDate) ||
    !isIsoDate(input.anchorPublishedDate) ||
    !Number.isSafeInteger(input.completedAtMs) ||
    input.completedAtMs < 0
  ) {
    throw new ReviewSyncStateError();
  }
  const syncStateId = stableId("review_store_sync", [
    input.storeId,
    provider
  ]);
  input.rawDatabase.client
    .prepare(
      `INSERT INTO review_store_sync_state (
         sync_state_id, store_id, provider, anchor_fingerprint,
         anchor_fingerprint_key_version, anchor_published_date,
         last_successful_mode, last_successful_run_id,
         last_successful_as_of_date, completed_at_ms, expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(store_id, provider) DO UPDATE SET
         anchor_fingerprint = excluded.anchor_fingerprint,
         anchor_fingerprint_key_version =
           excluded.anchor_fingerprint_key_version,
         anchor_published_date = excluded.anchor_published_date,
         last_successful_mode = excluded.last_successful_mode,
         last_successful_run_id = excluded.last_successful_run_id,
         last_successful_as_of_date =
           excluded.last_successful_as_of_date,
         completed_at_ms = excluded.completed_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(
      syncStateId,
      input.storeId,
      provider,
      input.anchorFingerprint,
      input.keyVersion,
      input.anchorPublishedDate,
      input.mode,
      input.runId,
      input.asOfDate,
      input.completedAtMs,
      input.completedAtMs + FOUR_HUNDRED_DAYS_MS
    );
}
