import { createHash, type Hash } from "node:crypto";
import {
  REVIEW_FTS_INDEX_VERSION,
  REVIEW_PUBLISH_CONTRACT_VERSION,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import type { RawDatabaseHandle } from "@bread-map/raw-db";
import { normalizeReviewText } from "@bread-map/retrieval";
import {
  decryptRawReview,
  type EncryptedRawReview,
  type EncryptedReviewPayloadV1,
  type ReviewAadV1
} from "./encrypt-raw-review.js";

type TerminalReviewRunStatus = "SUCCEEDED" | "PARTIAL";
const SQLITE_SAFE_BIND_BATCH_SIZE = 500;

export type ReviewPublishErrorCode =
  | "REVIEW_PUBLISH_RUN_NOT_FOUND"
  | "REVIEW_PUBLISH_RUN_NOT_TERMINAL"
  | "REVIEW_PUBLISH_KEY_UNAVAILABLE"
  | "REVIEW_PUBLISH_DECRYPT_FAILED"
  | "REVIEW_PUBLISH_STORE_NOT_PUBLIC"
  | "REVIEW_PUBLISH_FTS_INCONSISTENT"
  | "REVIEW_PUBLISH_STALE_REPLAY"
  | "REVIEW_PUBLISH_INPUT_EXPIRED"
  | "REVIEW_PUBLISH_INPUT_NOT_ELIGIBLE"
  | "REVIEW_PUBLISH_INPUT_KEY_VERSION_MISMATCH"
  | "REVIEW_PUBLISH_INPUT_INCOMPLETE"
  | "REVIEW_PUBLISH_INPUT_INVALID"
  | "REVIEW_PUBLISH_DATABASE_UNAVAILABLE";

export class ReviewPublishError extends Error {
  readonly code: ReviewPublishErrorCode;

  constructor(code: ReviewPublishErrorCode) {
    super(code);
    this.name = "ReviewPublishError";
    this.code = code;
  }
}

export interface PublishReviewRunOptions {
  rawDatabase: RawDatabaseHandle;
  appDatabase: AppDatabaseHandle;
  runId: string;
  encryptionKeys: ReadonlyMap<string, Buffer>;
  now?: () => number;
}

export interface ReviewPublishSummary {
  versionId: string;
  sourceRunId: string;
  sourceRunStatus: TerminalReviewRunStatus;
  sourceAsOfDate: string;
  documentCount: number;
  ftsDocumentCount: number;
  corpusChecksum: string;
  status: "ACTIVE" | "SUPERSEDED";
  replayed: boolean;
}

interface SourceRunRow {
  runId: string;
  discoveryRunId: string;
  status: string;
  asOfDate: string;
  fingerprintKeyVersion: string;
  collectedCount: number;
  expiresAtMs: number;
}

interface RawReviewRow {
  reviewId: string;
  runId: string;
  observationId: string;
  storeId: string;
  provider: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
  aadVersion: string;
  collectedAtMs: number;
  retentionUntilMs: number;
  observationRunId: string;
  observationMatchStatus: string;
  observationStoreId: string | null;
  observationExpiresAtMs: number;
}

interface PublicReviewDocument {
  reviewId: string;
  storeId: string;
  provider: "KAKAO_MAP";
  body: string;
  normalizedBody: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  collectedAtMs: number;
  sourceRunId: string;
}

export interface ReviewOwnership {
  reviewId: string;
  storeId: string;
}

interface StoredReviewDocument extends PublicReviewDocument {
  rowId: number;
  publishVersionId: string;
}

interface FtsReviewRow {
  rowId: number;
  reviewId: string;
  storeId: string;
  normalizedBody: string;
}

interface ExistingPublishRow {
  versionId: string;
  sourceRunId: string;
  sourceRunStatus: TerminalReviewRunStatus;
  sourceAsOfDate: string;
  status: "BUILDING" | "ACTIVE" | "SUPERSEDED";
  activeSlot: number | null;
  documentCount: number;
  ftsDocumentCount: number;
  corpusChecksum: string;
}

function fail(code: ReviewPublishErrorCode): never {
  throw new ReviewPublishError(code);
}

function stableId(namespace: string, value: string): string {
  return `${namespace}_${createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24)}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);
  const year = Number(match?.groups?.year);
  const month = Number(match?.groups?.month);
  const day = Number(match?.groups?.day);
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    fail("REVIEW_PUBLISH_INPUT_INVALID");
  }
  return { year, month, day };
}

function subtractCalendarYear(value: string): string {
  const { year, month, day } = parseIsoDate(value);
  if (year === 1) {
    fail("REVIEW_PUBLISH_INPUT_INVALID");
  }
  const cutoffYear = year - 1;
  const cutoffDay = Math.min(day, daysInMonth(cutoffYear, month));
  return `${String(cutoffYear).padStart(4, "0")}-${String(
    month
  ).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;
}

function updateField(hash: Hash, value: string): void {
  hash.update(String(Buffer.byteLength(value, "utf8")));
  hash.update(":");
  hash.update(value);
  hash.update(";");
}

function corpusChecksum(
  documents: readonly StoredReviewDocument[]
): string {
  const hash = createHash("sha256");
  for (const document of documents) {
    updateField(hash, document.reviewId);
    updateField(hash, document.storeId);
    updateField(hash, document.provider);
    updateField(hash, document.body);
    updateField(hash, document.normalizedBody);
    updateField(
      hash,
      document.ratingBasisPoints === null
        ? ""
        : String(document.ratingBasisPoints)
    );
    updateField(hash, document.publishedDate);
    updateField(hash, String(document.collectedAtMs));
    updateField(hash, document.sourceRunId);
  }
  return hash.digest("hex");
}

function loadExistingPublish(
  appDatabase: AppDatabaseHandle,
  runId: string
): ExistingPublishRow | undefined {
  return appDatabase.client
    .prepare(
      `SELECT
         version_id AS versionId,
         source_run_id AS sourceRunId,
         source_run_status AS sourceRunStatus,
         source_as_of_date AS sourceAsOfDate,
         status,
         active_slot AS activeSlot,
         document_count AS documentCount,
         fts_document_count AS ftsDocumentCount,
         corpus_checksum AS corpusChecksum
       FROM review_publish_version
      WHERE source_run_id = ?`
    )
    .get(runId) as ExistingPublishRow | undefined;
}

function replaySummary(
  appDatabase: AppDatabaseHandle,
  existing: ExistingPublishRow
): ReviewPublishSummary {
  if (existing.status !== "ACTIVE" || existing.activeSlot !== 1) {
    fail("REVIEW_PUBLISH_STALE_REPLAY");
  }
  assertStoredDocumentsPublic(appDatabase);
  const documents = loadStoredDocuments(appDatabase);
  assertFtsConsistent(appDatabase, documents);
  const checksum = corpusChecksum(documents);
  const indexState = appDatabase.client
    .prepare(
      `SELECT
         index_version AS indexVersion,
         publish_version_id AS publishVersionId,
         document_count AS documentCount,
         corpus_checksum AS corpusChecksum
       FROM fts_index_state
      WHERE status = 'ACTIVE'
        AND active_slot = 1`
    )
    .get() as
    | {
        indexVersion: string;
        publishVersionId: string;
        documentCount: number;
        corpusChecksum: string;
      }
    | undefined;
  if (
    documents.length !== existing.documentCount ||
    existing.ftsDocumentCount !== existing.documentCount ||
    checksum !== existing.corpusChecksum ||
    indexState === undefined ||
    indexState.indexVersion !== REVIEW_FTS_INDEX_VERSION ||
    indexState.publishVersionId !== existing.versionId ||
    indexState.documentCount !== existing.documentCount ||
    indexState.corpusChecksum !== existing.corpusChecksum
  ) {
    fail("REVIEW_PUBLISH_FTS_INCONSISTENT");
  }
  return {
    versionId: existing.versionId,
    sourceRunId: existing.sourceRunId,
    sourceRunStatus: existing.sourceRunStatus,
    sourceAsOfDate: existing.sourceAsOfDate,
    documentCount: existing.documentCount,
    ftsDocumentCount: existing.ftsDocumentCount,
    corpusChecksum: existing.corpusChecksum,
    status: "ACTIVE",
    replayed: true
  };
}

function loadSourceRun(
  rawDatabase: RawDatabaseHandle,
  runId: string,
  nowMs: number
): SourceRunRow {
  const row = rawDatabase.client
    .prepare(
      `SELECT
         run_id AS runId,
         discovery_run_id AS discoveryRunId,
         status,
         as_of_date AS asOfDate,
         fingerprint_key_version AS fingerprintKeyVersion,
         collected_count AS collectedCount,
         expires_at_ms AS expiresAtMs
       FROM review_collection_run
      WHERE run_id = ?`
    )
    .get(runId) as SourceRunRow | undefined;
  if (row === undefined) {
    fail("REVIEW_PUBLISH_RUN_NOT_FOUND");
  }
  if (row.status !== "SUCCEEDED" && row.status !== "PARTIAL") {
    fail("REVIEW_PUBLISH_RUN_NOT_TERMINAL");
  }
  if (row.expiresAtMs <= nowMs) {
    fail("REVIEW_PUBLISH_INPUT_EXPIRED");
  }
  parseIsoDate(row.asOfDate);
  return row;
}

function loadRawRows(
  rawDatabase: RawDatabaseHandle,
  runId: string
): readonly RawReviewRow[] {
  return rawDatabase.client
    .prepare(
      `SELECT
         raw.review_id AS reviewId,
         raw.run_id AS runId,
         raw.observation_id AS observationId,
         raw.store_id AS storeId,
         raw.provider,
         raw.ciphertext,
         raw.nonce,
         raw.auth_tag AS authTag,
         raw.key_version AS keyVersion,
         raw.aad_version AS aadVersion,
         raw.collected_at_ms AS collectedAtMs,
         raw.retention_until_ms AS retentionUntilMs,
         observation.run_id AS observationRunId,
         observation.match_status AS observationMatchStatus,
         observation.matched_store_id AS observationStoreId,
         observation.expires_at_ms AS observationExpiresAtMs
       FROM raw_review_ciphertext AS raw
       JOIN kakao_place_observation AS observation
         ON observation.observation_id = raw.observation_id
      WHERE raw.run_id = ?
      ORDER BY raw.review_id`
    )
    .all(runId) as RawReviewRow[];
}

function decryptRows(
  rows: readonly RawReviewRow[],
  run: SourceRunRow,
  encryptionKeys: ReadonlyMap<string, Buffer>,
  nowMs: number
): readonly PublicReviewDocument[] {
  return rows.map((row) => {
    if (
      row.runId !== run.runId ||
      row.observationRunId !== run.discoveryRunId ||
      row.observationMatchStatus !== "MATCHED_ELIGIBLE" ||
      row.observationStoreId !== row.storeId
    ) {
      fail("REVIEW_PUBLISH_INPUT_NOT_ELIGIBLE");
    }
    if (
      row.retentionUntilMs <= nowMs ||
      row.observationExpiresAtMs <= nowMs
    ) {
      fail("REVIEW_PUBLISH_INPUT_EXPIRED");
    }
    if (row.keyVersion !== run.fingerprintKeyVersion) {
      fail("REVIEW_PUBLISH_INPUT_KEY_VERSION_MISMATCH");
    }
    if (
      row.provider !== "KAKAO_MAP" ||
      row.aadVersion !== "review-aad-v1" ||
      row.reviewId.length === 0 ||
      row.storeId.length === 0 ||
      !Number.isInteger(row.collectedAtMs) ||
      row.collectedAtMs < 0
    ) {
      fail("REVIEW_PUBLISH_INPUT_INVALID");
    }
    const encryptionKey = encryptionKeys.get(row.keyVersion);
    if (encryptionKey === undefined || encryptionKey.length !== 32) {
      fail("REVIEW_PUBLISH_KEY_UNAVAILABLE");
    }
    const encrypted: EncryptedRawReview = {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
      aadVersion: "review-aad-v1"
    };
    const aad: ReviewAadV1 = {
      reviewId: row.reviewId,
      storeId: row.storeId,
      provider: "KAKAO_MAP",
      schemaVersion: 1
    };
    let payload: EncryptedReviewPayloadV1;
    try {
      payload = decryptRawReview(encrypted, aad, encryptionKey);
    } catch {
      fail("REVIEW_PUBLISH_DECRYPT_FAILED");
    }
    parseIsoDate(payload.publishedDate);
    if (payload.publishedDate > run.asOfDate) {
      fail("REVIEW_PUBLISH_INPUT_INVALID");
    }
    const normalizedBody = normalizeReviewText(payload.body);
    if (
      normalizedBody.length === 0 ||
      payload.provider !== row.provider
    ) {
      fail("REVIEW_PUBLISH_INPUT_INVALID");
    }
    return {
      reviewId: row.reviewId,
      storeId: row.storeId,
      provider: "KAKAO_MAP",
      body: payload.body,
      normalizedBody,
      ratingBasisPoints: payload.ratingBasisPoints,
      publishedDate: payload.publishedDate,
      collectedAtMs: row.collectedAtMs,
      sourceRunId: run.runId
    };
  });
}

function assertPublicStores(
  appDatabase: AppDatabaseHandle,
  documents: readonly PublicReviewDocument[]
): void {
  const storeIds = [
    ...new Set(documents.map((document) => document.storeId))
  ];
  if (storeIds.length === 0) {
    return;
  }
  const publicStoreIds = new Set<string>();
  for (
    let offset = 0;
    offset < storeIds.length;
    offset += SQLITE_SAFE_BIND_BATCH_SIZE
  ) {
    const batch = storeIds.slice(
      offset,
      offset + SQLITE_SAFE_BIND_BATCH_SIZE
    );
    const placeholders = batch.map(() => "?").join(", ");
    const rows = appDatabase.client
      .prepare(
        `SELECT store_id AS storeId
           FROM store
          WHERE store_id IN (${placeholders})
            AND catalog_status = 'published'
            AND business_status = 'active'`
      )
      .all(...batch) as Array<{ storeId: string }>;
    rows.forEach((row) => publicStoreIds.add(row.storeId));
  }
  if (publicStoreIds.size !== storeIds.length) {
    fail("REVIEW_PUBLISH_STORE_NOT_PUBLIC");
  }
}

export function assertStableReviewOwnership(
  appDatabase: AppDatabaseHandle,
  documents: readonly ReviewOwnership[]
): void {
  if (documents.length === 0) {
    return;
  }
  const reviewIds = documents.map((document) => document.reviewId);
  const expectedStores = new Map(
    documents.map((document) => [
      document.reviewId,
      document.storeId
    ])
  );
  for (
    let offset = 0;
    offset < reviewIds.length;
    offset += SQLITE_SAFE_BIND_BATCH_SIZE
  ) {
    const batch = reviewIds.slice(
      offset,
      offset + SQLITE_SAFE_BIND_BATCH_SIZE
    );
    const placeholders = batch.map(() => "?").join(", ");
    const existing = appDatabase.client
      .prepare(
        `SELECT review_id AS reviewId, store_id AS storeId
           FROM review_document
          WHERE review_id IN (${placeholders})`
      )
      .all(...batch) as Array<{
      reviewId: string;
      storeId: string;
    }>;
    if (
      existing.some(
        (row) => expectedStores.get(row.reviewId) !== row.storeId
      )
    ) {
      fail("REVIEW_PUBLISH_INPUT_INVALID");
    }
  }
}

function assertStoredDocumentsPublic(
  appDatabase: AppDatabaseHandle
): void {
  const row = appDatabase.client
    .prepare(
      `SELECT count(*) AS count
         FROM review_document AS document
         LEFT JOIN store
           ON store.store_id = document.store_id
        WHERE store.store_id IS NULL
           OR store.catalog_status != 'published'
           OR store.business_status != 'active'`
    )
    .get() as { count: number };
  if (row.count !== 0) {
    fail("REVIEW_PUBLISH_STORE_NOT_PUBLIC");
  }
}

function loadStoredDocuments(
  appDatabase: AppDatabaseHandle
): readonly StoredReviewDocument[] {
  return appDatabase.client
    .prepare(
      `SELECT
         rowid AS rowId,
         review_id AS reviewId,
         store_id AS storeId,
         provider,
         body,
         normalized_body AS normalizedBody,
         rating_basis_points AS ratingBasisPoints,
         published_date AS publishedDate,
         collected_at_ms AS collectedAtMs,
         source_run_id AS sourceRunId,
         publish_version_id AS publishVersionId
       FROM review_document
      ORDER BY review_id`
    )
    .all() as StoredReviewDocument[];
}

function assertFtsConsistent(
  appDatabase: AppDatabaseHandle,
  documents: readonly StoredReviewDocument[]
): void {
  const ftsRows = appDatabase.client
    .prepare(
      `SELECT
         rowid AS rowId,
         review_id AS reviewId,
         store_id AS storeId,
         normalized_body AS normalizedBody
       FROM review_fts
      ORDER BY review_id`
    )
    .all() as FtsReviewRow[];
  if (
    ftsRows.length !== documents.length ||
    ftsRows.some((row, index) => {
      const document = documents[index];
      return (
        document === undefined ||
        row.rowId !== document.rowId ||
        row.reviewId !== document.reviewId ||
        row.storeId !== document.storeId ||
        row.normalizedBody !== document.normalizedBody
      );
    })
  ) {
    fail("REVIEW_PUBLISH_FTS_INCONSISTENT");
  }
}

function persistPublish(
  appDatabase: AppDatabaseHandle,
  run: SourceRunRow & { status: TerminalReviewRunStatus },
  documents: readonly PublicReviewDocument[],
  nowMs: number
): ReviewPublishSummary {
  const versionId = stableId(
    "review_publish",
    `${REVIEW_PUBLISH_CONTRACT_VERSION}:${run.runId}`
  );
  const stateId = stableId(
    "review_fts",
    `${REVIEW_FTS_INDEX_VERSION}:${versionId}`
  );
  const cutoffDate = subtractCalendarYear(run.asOfDate);
  const emptyChecksum = createHash("sha256").digest("hex");

  const transaction = appDatabase.client.transaction(() => {
    const activeVersion = appDatabase.client
      .prepare(
        `SELECT source_as_of_date AS sourceAsOfDate
           FROM review_publish_version
          WHERE status = 'ACTIVE'
            AND active_slot = 1`
      )
      .get() as { sourceAsOfDate: string } | undefined;
    if (
      activeVersion !== undefined &&
      activeVersion.sourceAsOfDate > run.asOfDate
    ) {
      fail("REVIEW_PUBLISH_STALE_REPLAY");
    }

    appDatabase.client
      .prepare(
        `INSERT INTO review_publish_version (
           version_id, source_run_id, source_run_status,
           source_as_of_date, status, active_slot, document_count,
           fts_document_count, corpus_checksum, published_at_ms
         ) VALUES (?, ?, ?, ?, 'BUILDING', NULL, 0, 0, ?, ?)`
      )
      .run(
        versionId,
        run.runId,
        run.status,
        run.asOfDate,
        emptyChecksum,
        nowMs
      );

    const upsert = appDatabase.client.prepare(
      `INSERT INTO review_document (
         review_id, store_id, provider, body, normalized_body,
         rating_basis_points, published_date, collected_at_ms,
         source_run_id, publish_version_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(review_id) DO UPDATE SET
         store_id = excluded.store_id,
         provider = excluded.provider,
         body = excluded.body,
         normalized_body = excluded.normalized_body,
         rating_basis_points = excluded.rating_basis_points,
         published_date = excluded.published_date,
         collected_at_ms = excluded.collected_at_ms,
         source_run_id = excluded.source_run_id,
         publish_version_id = excluded.publish_version_id`
    );
    for (const document of documents) {
      upsert.run(
        document.reviewId,
        document.storeId,
        document.provider,
        document.body,
        document.normalizedBody,
        document.ratingBasisPoints,
        document.publishedDate,
        document.collectedAtMs,
        document.sourceRunId,
        versionId
      );
    }

    appDatabase.client
      .prepare(
        `DELETE FROM review_document
          WHERE published_date < ?`
      )
      .run(cutoffDate);
    appDatabase.client
      .prepare(
        `UPDATE review_document
            SET publish_version_id = ?
          WHERE publish_version_id != ?`
      )
      .run(versionId, versionId);

    assertStoredDocumentsPublic(appDatabase);
    const storedDocuments = loadStoredDocuments(appDatabase);
    assertFtsConsistent(appDatabase, storedDocuments);
    const checksum = corpusChecksum(storedDocuments);
    const documentCount = storedDocuments.length;

    appDatabase.client
      .prepare(
        `UPDATE fts_index_state
            SET status = 'SUPERSEDED', active_slot = NULL
          WHERE status = 'ACTIVE' OR active_slot = 1`
      )
      .run();
    appDatabase.client
      .prepare(
        `UPDATE review_publish_version
            SET status = 'SUPERSEDED', active_slot = NULL
          WHERE version_id != ?
            AND (status = 'ACTIVE' OR active_slot = 1)`
      )
      .run(versionId);
    appDatabase.client
      .prepare(
        `UPDATE review_publish_version
            SET status = 'ACTIVE',
                active_slot = 1,
                document_count = ?,
                fts_document_count = ?,
                corpus_checksum = ?
          WHERE version_id = ?`
      )
      .run(documentCount, documentCount, checksum, versionId);
    appDatabase.client
      .prepare(
        `INSERT INTO fts_index_state (
           state_id, index_version, publish_version_id, status,
           active_slot, document_count, corpus_checksum, built_at_ms
         ) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?, ?)`
      )
      .run(
        stateId,
        REVIEW_FTS_INDEX_VERSION,
        versionId,
        documentCount,
        checksum,
        nowMs
      );

    return {
      versionId,
      sourceRunId: run.runId,
      sourceRunStatus: run.status,
      sourceAsOfDate: run.asOfDate,
      documentCount,
      ftsDocumentCount: documentCount,
      corpusChecksum: checksum,
      status: "ACTIVE" as const,
      replayed: false
    };
  });

  try {
    return transaction();
  } catch (error) {
    if (error instanceof ReviewPublishError) {
      throw error;
    }
    fail("REVIEW_PUBLISH_FTS_INCONSISTENT");
  }
}

function publishReviewRunUnsafe(
  options: PublishReviewRunOptions
): ReviewPublishSummary {
  const runId = options.runId.trim();
  const nowMs = (options.now ?? Date.now)();
  if (
    runId.length === 0 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    fail("REVIEW_PUBLISH_INPUT_INVALID");
  }

  const existing = loadExistingPublish(options.appDatabase, runId);
  if (existing !== undefined) {
    return replaySummary(options.appDatabase, existing);
  }

  const run = loadSourceRun(options.rawDatabase, runId, nowMs);
  const rawRows = loadRawRows(options.rawDatabase, runId);
  if (rawRows.length < run.collectedCount) {
    fail("REVIEW_PUBLISH_INPUT_INCOMPLETE");
  }
  const documents = decryptRows(
    rawRows,
    run,
    options.encryptionKeys,
    nowMs
  );
  assertPublicStores(options.appDatabase, documents);
  assertStableReviewOwnership(options.appDatabase, documents);

  return persistPublish(
    options.appDatabase,
    {
      ...run,
      status: run.status as TerminalReviewRunStatus
    },
    documents,
    nowMs
  );
}

export function publishReviewRun(
  options: PublishReviewRunOptions
): ReviewPublishSummary {
  try {
    return publishReviewRunUnsafe(options);
  } catch (error) {
    if (error instanceof ReviewPublishError) {
      throw error;
    }
    fail("REVIEW_PUBLISH_DATABASE_UNAVAILABLE");
  }
}
