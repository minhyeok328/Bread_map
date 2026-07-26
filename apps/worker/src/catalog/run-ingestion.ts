import { createHash } from "node:crypto";
import {
  ingestionSummarySchema,
  type IngestionSummary,
  type LocaldataPage,
  type LocaldataSourceRow
} from "@bread-map/contracts";
import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  LOCALDATA_BAKERIES_INFO_URL,
  type LocaldataClient
} from "./localdata-client.js";
import {
  normalizeSourceRow,
  type LocaldataStagingRow
} from "./normalize-source-row.js";

export const LOCALDATA_SOURCE_ID = "src_localdata_bakeries";
export const LOCALDATA_SOURCE_KEY = "localdata:bakeries";
export const LOCALDATA_ADAPTER_VERSION = "localdata-bakeries-v1";

const requiredSourceFields = [
  "OPN_ATMY_GRP_CD",
  "MNG_NO",
  "LCPMT_YMD",
  "SALS_STTS_CD",
  "SALS_STTS_NM",
  "DTL_SALS_STTS_CD",
  "DTL_SALS_STTS_NM",
  "CLSBIZ_YMD",
  "BPLC_NM",
  "ROAD_NM_ADDR",
  "LOTNO_ADDR",
  "CRD_INFO_X",
  "CRD_INFO_Y",
  "DAT_UPDT_PNT",
  "LAST_MDFCN_PNT"
] as const;

export type SafeCatalogLogEvent =
  | {
      event: "catalog_page_committed";
      runId: string;
      sourceId: string;
      snapshotId: string;
      pageNo: number;
      readCount: number;
      insertedCount: number;
      updatedCount: number;
      rejectedCount: number;
    }
  | {
      event: "catalog_ingestion_completed";
      runId: string;
      sourceId: string;
      snapshotId: string;
      pageCount: number;
      readCount: number;
      insertedCount: number;
      updatedCount: number;
      rejectedCount: number;
    };

export interface RunLocaldataIngestionOptions {
  appDatabase: AppDatabaseHandle;
  client: LocaldataClient;
  basisDate: string;
  pageSize?: number;
  now?: () => number;
  logger?: (event: SafeCatalogLogEvent) => void;
}

interface ExistingStagingRow {
  source_row_id: string;
  mng_no: string;
  open_authority_group_code: string;
  permit_date: string | null;
  business_status_code: string;
  business_status_name: string;
  detailed_business_status_code: string | null;
  detailed_business_status_name: string | null;
  closed_date: string | null;
  business_name: string;
  road_name_address: string | null;
  lot_number_address: string | null;
  source_coordinate_x: string | null;
  source_coordinate_y: string | null;
  data_updated_at_ms: number | null;
  last_modified_at_ms: number | null;
}

interface PageCounts {
  readCount: number;
  insertedCount: number;
  updatedCount: number;
  rejectedCount: number;
}

function hashBuffer(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hashBuffer(value).toString("hex").slice(0, 24)}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function assertIngestionInput(
  basisDate: string,
  pageSize: number
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(basisDate)) {
    throw new Error("CATALOG_BASIS_DATE_INVALID");
  }
  const parsedBasisDate = new Date(`${basisDate}T00:00:00Z`);
  if (
    Number.isNaN(parsedBasisDate.getTime()) ||
    parsedBasisDate.toISOString().slice(0, 10) !== basisDate
  ) {
    throw new Error("CATALOG_BASIS_DATE_INVALID");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("CATALOG_PAGE_SIZE_INVALID");
  }
}

function assertSnapshotPages(pages: LocaldataPage[]): void {
  if (pages.length === 0) {
    throw new Error("CATALOG_SNAPSHOT_EMPTY");
  }

  const pageNumbers = new Set<number>();
  const sourceKeys = new Set<string>();
  for (const page of pages) {
    if (pageNumbers.has(page.pageNo)) {
      throw new Error("CATALOG_PAGE_DUPLICATE");
    }
    pageNumbers.add(page.pageNo);
    for (const row of page.items) {
      if (sourceKeys.has(row.managementNumber)) {
        throw new Error("CATALOG_SOURCE_KEY_DUPLICATE");
      }
      sourceKeys.add(row.managementNumber);
    }
  }
}

function toSnapshotPayload(pages: LocaldataPage[]): unknown {
  return pages.map((page) => ({
    pageNo: page.pageNo,
    numOfRows: page.numOfRows,
    totalCount: page.totalCount,
    items: page.items
  }));
}

function toExistingComparable(
  sourceRowId: string,
  value: LocaldataStagingRow
): ExistingStagingRow {
  return {
    source_row_id: sourceRowId,
    mng_no: value.mngNo,
    open_authority_group_code: value.openAuthorityGroupCode,
    permit_date: value.permitDate,
    business_status_code: value.businessStatusCode,
    business_status_name: value.businessStatusName,
    detailed_business_status_code:
      value.detailedBusinessStatusCode,
    detailed_business_status_name:
      value.detailedBusinessStatusName,
    closed_date: value.closedDate,
    business_name: value.businessName,
    road_name_address: value.roadNameAddress,
    lot_number_address: value.lotNumberAddress,
    source_coordinate_x: value.sourceCoordinateX,
    source_coordinate_y: value.sourceCoordinateY,
    data_updated_at_ms: value.dataUpdatedAtMs,
    last_modified_at_ms: value.lastModifiedAtMs
  };
}

function stagingRowsEqual(
  existing: ExistingStagingRow,
  expected: ExistingStagingRow
): boolean {
  return (
    existing.source_row_id === expected.source_row_id &&
    existing.mng_no === expected.mng_no &&
    existing.open_authority_group_code ===
      expected.open_authority_group_code &&
    existing.permit_date === expected.permit_date &&
    existing.business_status_code ===
      expected.business_status_code &&
    existing.business_status_name ===
      expected.business_status_name &&
    existing.detailed_business_status_code ===
      expected.detailed_business_status_code &&
    existing.detailed_business_status_name ===
      expected.detailed_business_status_name &&
    existing.closed_date === expected.closed_date &&
    existing.business_name === expected.business_name &&
    existing.road_name_address === expected.road_name_address &&
    existing.lot_number_address === expected.lot_number_address &&
    existing.source_coordinate_x === expected.source_coordinate_x &&
    existing.source_coordinate_y === expected.source_coordinate_y &&
    existing.data_updated_at_ms === expected.data_updated_at_ms &&
    existing.last_modified_at_ms === expected.last_modified_at_ms
  );
}

function upsertSourceCatalog(
  database: AppDatabaseHandle,
  nowMs: number
): void {
  database.client
    .prepare(
      `INSERT INTO source_catalog (
         source_id, source_key, official_url, required_fields_json,
         terms_checked_at_ms, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         official_url = excluded.official_url,
         required_fields_json = excluded.required_fields_json`
    )
    .run(
      LOCALDATA_SOURCE_ID,
      LOCALDATA_SOURCE_KEY,
      LOCALDATA_BAKERIES_INFO_URL,
      canonicalJson(requiredSourceFields),
      nowMs,
      nowMs
    );
}

function upsertSnapshot(
  database: AppDatabaseHandle,
  basisDate: string,
  snapshotSha256: Buffer,
  byteSize: number,
  nowMs: number
): string {
  const snapshotId = stableId(
    "snapshot",
    `${LOCALDATA_SOURCE_ID}:${snapshotSha256.toString("hex")}`
  );
  database.client
    .prepare(
      `INSERT OR IGNORE INTO source_snapshot (
         snapshot_id, source_id, sha256, byte_size, basis_date,
         downloaded_at_ms, adapter_version, local_path_hint
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      snapshotId,
      LOCALDATA_SOURCE_ID,
      snapshotSha256,
      byteSize,
      basisDate,
      nowMs,
      LOCALDATA_ADAPTER_VERSION
    );

  const existing = database.client
    .prepare(
      `SELECT snapshot_id FROM source_snapshot
       WHERE source_id = ? AND sha256 = ?`
    )
    .get(LOCALDATA_SOURCE_ID, snapshotSha256) as
    | { snapshot_id: string }
    | undefined;
  if (existing === undefined) {
    throw new Error("CATALOG_SNAPSHOT_PERSIST_FAILED");
  }
  return existing.snapshot_id;
}

function startRun(
  database: AppDatabaseHandle,
  snapshotId: string,
  nowMs: number
): string {
  const runId = stableId(
    "run",
    `${LOCALDATA_SOURCE_ID}:${snapshotId}:${LOCALDATA_ADAPTER_VERSION}`
  );
  database.client
    .prepare(
      `INSERT INTO ingestion_run (
         run_id, source_id, snapshot_id, adapter_version, status,
         started_at_ms, finished_at_ms, attempt_count, page_count,
         read_count, inserted_count, updated_count, rejected_count
       ) VALUES (?, ?, ?, ?, 'RUNNING', ?, NULL, 1, 0, 0, 0, 0, 0)
       ON CONFLICT(source_id, snapshot_id, adapter_version) DO UPDATE SET
         status = 'RUNNING',
         started_at_ms = excluded.started_at_ms,
         finished_at_ms = NULL,
         attempt_count = ingestion_run.attempt_count + 1,
         page_count = 0,
         read_count = 0,
         inserted_count = 0,
         updated_count = 0,
         rejected_count = 0`
    )
    .run(
      runId,
      LOCALDATA_SOURCE_ID,
      snapshotId,
      LOCALDATA_ADAPTER_VERSION,
      nowMs
    );

  const existing = database.client
    .prepare(
      `SELECT run_id FROM ingestion_run
       WHERE source_id = ? AND snapshot_id = ? AND adapter_version = ?`
    )
    .get(
      LOCALDATA_SOURCE_ID,
      snapshotId,
      LOCALDATA_ADAPTER_VERSION
    ) as { run_id: string };
  return existing.run_id;
}

function persistSourceRow(
  database: AppDatabaseHandle,
  snapshotId: string,
  pageNo: number,
  rowIndex: number,
  row: LocaldataSourceRow,
  nowMs: number
): { sourceRowId: string; payloadJson: string } {
  const payloadJson = canonicalJson(row);
  const sourceRowId = stableId(
    "source_row",
    `${snapshotId}:${row.managementNumber}`
  );
  const existing = database.client
    .prepare(
      `SELECT source_row_id, payload_json
       FROM source_snapshot_row
       WHERE snapshot_id = ? AND source_row_key = ?`
    )
    .get(snapshotId, row.managementNumber) as
    | { source_row_id: string; payload_json: string }
    | undefined;

  if (existing !== undefined) {
    if (existing.payload_json !== payloadJson) {
      throw new Error("CATALOG_SOURCE_ROW_IMMUTABLE_CONFLICT");
    }
    return {
      sourceRowId: existing.source_row_id,
      payloadJson
    };
  }

  database.client
    .prepare(
      `INSERT INTO source_snapshot_row (
         source_row_id, snapshot_id, page_no, row_index, source_row_key,
         payload_json, payload_sha256, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sourceRowId,
      snapshotId,
      pageNo,
      rowIndex,
      row.managementNumber,
      payloadJson,
      hashBuffer(payloadJson),
      nowMs
    );
  return { sourceRowId, payloadJson };
}

function persistRejectedRow(
  database: AppDatabaseHandle,
  runId: string,
  sourceRowId: string,
  reasonCode: string,
  nowMs: number
): void {
  const issueId = stableId(
    "quality",
    `${runId}:${sourceRowId}:${reasonCode}`
  );
  database.client
    .prepare(
      `INSERT INTO data_quality_issue (
         issue_id, run_id, source_row_id, rule_code, severity, status,
         redacted_details_json, occurred_at_ms
       ) VALUES (?, ?, ?, ?, 'REJECTED', 'OPEN', '{}', ?)
       ON CONFLICT(run_id, source_row_id, rule_code) DO UPDATE SET
         occurred_at_ms = excluded.occurred_at_ms`
    )
    .run(issueId, runId, sourceRowId, reasonCode, nowMs);
}

function persistStagingRow(
  database: AppDatabaseHandle,
  snapshotId: string,
  sourceRowId: string,
  value: LocaldataStagingRow,
  nowMs: number
): "inserted" | "updated" | "unchanged" {
  const existing = database.client
    .prepare(
      `SELECT
         source_row_id, mng_no, open_authority_group_code, permit_date,
         business_status_code, business_status_name,
         detailed_business_status_code, detailed_business_status_name,
         closed_date, business_name, road_name_address,
         lot_number_address, source_coordinate_x, source_coordinate_y,
         data_updated_at_ms, last_modified_at_ms
       FROM localdata_bakery_record
       WHERE snapshot_id = ? AND mng_no = ?`
    )
    .get(snapshotId, value.mngNo) as ExistingStagingRow | undefined;
  const expected = toExistingComparable(sourceRowId, value);

  if (existing === undefined) {
    database.client
      .prepare(
        `INSERT INTO localdata_bakery_record (
           record_id, snapshot_id, source_row_id, mng_no,
           open_authority_group_code, permit_date, business_status_code,
           business_status_name, detailed_business_status_code,
           detailed_business_status_name, closed_date, business_name,
           road_name_address, lot_number_address, source_coordinate_x,
           source_coordinate_y, data_updated_at_ms, last_modified_at_ms,
           staged_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stableId("record", `${snapshotId}:${value.mngNo}`),
        snapshotId,
        sourceRowId,
        value.mngNo,
        value.openAuthorityGroupCode,
        value.permitDate,
        value.businessStatusCode,
        value.businessStatusName,
        value.detailedBusinessStatusCode,
        value.detailedBusinessStatusName,
        value.closedDate,
        value.businessName,
        value.roadNameAddress,
        value.lotNumberAddress,
        value.sourceCoordinateX,
        value.sourceCoordinateY,
        value.dataUpdatedAtMs,
        value.lastModifiedAtMs,
        nowMs
      );
    return "inserted";
  }

  if (stagingRowsEqual(existing, expected)) {
    return "unchanged";
  }

  database.client
    .prepare(
      `UPDATE localdata_bakery_record SET
         source_row_id = ?,
         open_authority_group_code = ?,
         permit_date = ?,
         business_status_code = ?,
         business_status_name = ?,
         detailed_business_status_code = ?,
         detailed_business_status_name = ?,
         closed_date = ?,
         business_name = ?,
         road_name_address = ?,
         lot_number_address = ?,
         source_coordinate_x = ?,
         source_coordinate_y = ?,
         data_updated_at_ms = ?,
         last_modified_at_ms = ?,
         staged_at_ms = ?
       WHERE snapshot_id = ? AND mng_no = ?`
    )
    .run(
      sourceRowId,
      value.openAuthorityGroupCode,
      value.permitDate,
      value.businessStatusCode,
      value.businessStatusName,
      value.detailedBusinessStatusCode,
      value.detailedBusinessStatusName,
      value.closedDate,
      value.businessName,
      value.roadNameAddress,
      value.lotNumberAddress,
      value.sourceCoordinateX,
      value.sourceCoordinateY,
      value.dataUpdatedAtMs,
      value.lastModifiedAtMs,
      nowMs,
      snapshotId,
      value.mngNo
    );
  return "updated";
}

function persistCheckpoint(
  database: AppDatabaseHandle,
  runId: string,
  snapshotId: string,
  page: LocaldataPage,
  counts: PageCounts,
  nowMs: number
): void {
  const lastCommittedKey =
    page.items.at(-1)?.managementNumber ?? null;
  database.client
    .prepare(
      `INSERT INTO source_checkpoint (
         checkpoint_id, run_id, page_no, last_committed_key, state,
         read_count, inserted_count, updated_count, rejected_count,
         committed_at_ms
       ) VALUES (?, ?, ?, ?, 'COMMITTED', ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, page_no) DO UPDATE SET
         last_committed_key = excluded.last_committed_key,
         state = excluded.state,
         read_count = excluded.read_count,
         inserted_count = excluded.inserted_count,
         updated_count = excluded.updated_count,
         rejected_count = excluded.rejected_count,
         committed_at_ms = excluded.committed_at_ms`
    )
    .run(
      stableId("checkpoint", `${runId}:${page.pageNo}`),
      runId,
      page.pageNo,
      lastCommittedKey,
      counts.readCount,
      counts.insertedCount,
      counts.updatedCount,
      counts.rejectedCount,
      nowMs
    );
}

function persistPage(
  database: AppDatabaseHandle,
  snapshotId: string,
  runId: string,
  page: LocaldataPage,
  nowMs: number
): PageCounts {
  return database.client.transaction(() => {
    const counts: PageCounts = {
      readCount: page.items.length,
      insertedCount: 0,
      updatedCount: 0,
      rejectedCount: 0
    };

    page.items.forEach((row, rowIndex) => {
      const { sourceRowId } = persistSourceRow(
        database,
        snapshotId,
        page.pageNo,
        rowIndex,
        row,
        nowMs
      );
      const normalized = normalizeSourceRow(row);
      if (!normalized.accepted) {
        persistRejectedRow(
          database,
          runId,
          sourceRowId,
          normalized.reasonCode,
          nowMs
        );
        counts.rejectedCount += 1;
        return;
      }

      const result = persistStagingRow(
        database,
        snapshotId,
        sourceRowId,
        normalized.value,
        nowMs
      );
      if (result === "inserted") {
        counts.insertedCount += 1;
      } else if (result === "updated") {
        counts.updatedCount += 1;
      }
    });

    persistCheckpoint(
      database,
      runId,
      snapshotId,
      page,
      counts,
      nowMs
    );
    return counts;
  })();
}

function finishRun(
  database: AppDatabaseHandle,
  summary: IngestionSummary,
  nowMs: number
): void {
  database.client
    .prepare(
      `UPDATE ingestion_run SET
         status = 'SUCCEEDED',
         finished_at_ms = ?,
         page_count = ?,
         read_count = ?,
         inserted_count = ?,
         updated_count = ?,
         rejected_count = ?
       WHERE run_id = ?`
    )
    .run(
      nowMs,
      summary.pageCount,
      summary.readCount,
      summary.insertedCount,
      summary.updatedCount,
      summary.rejectedCount,
      summary.runId
    );
}

function failRun(
  database: AppDatabaseHandle,
  runId: string,
  nowMs: number
): void {
  database.client
    .prepare(
      `UPDATE ingestion_run
       SET status = 'FAILED_FINAL', finished_at_ms = ?
       WHERE run_id = ?`
    )
    .run(nowMs, runId);
}

export async function runLocaldataIngestion({
  appDatabase,
  client,
  basisDate,
  pageSize = 500,
  now = Date.now,
  logger
}: RunLocaldataIngestionOptions): Promise<IngestionSummary> {
  assertIngestionInput(basisDate, pageSize);
  const pages = await client.fetchAllPages({ numOfRows: pageSize });
  assertSnapshotPages(pages);

  const snapshotPayload = canonicalJson(toSnapshotPayload(pages));
  const snapshotSha256 = hashBuffer(snapshotPayload);
  const nowMs = now();
  upsertSourceCatalog(appDatabase, nowMs);
  const snapshotId = upsertSnapshot(
    appDatabase,
    basisDate,
    snapshotSha256,
    Buffer.byteLength(snapshotPayload, "utf8"),
    nowMs
  );
  const runId = startRun(appDatabase, snapshotId, nowMs);
  const total: PageCounts = {
    readCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    rejectedCount: 0
  };

  try {
    for (const page of pages) {
      const counts = persistPage(
        appDatabase,
        snapshotId,
        runId,
        page,
        now()
      );
      total.readCount += counts.readCount;
      total.insertedCount += counts.insertedCount;
      total.updatedCount += counts.updatedCount;
      total.rejectedCount += counts.rejectedCount;
      logger?.({
        event: "catalog_page_committed",
        runId,
        sourceId: LOCALDATA_SOURCE_ID,
        snapshotId,
        pageNo: page.pageNo,
        ...counts
      });
    }

    const summary = ingestionSummarySchema.parse({
      runId,
      sourceId: LOCALDATA_SOURCE_ID,
      snapshotId,
      status: "SUCCEEDED",
      pageCount: pages.length,
      ...total
    });
    finishRun(appDatabase, summary, now());
    logger?.({
      event: "catalog_ingestion_completed",
      runId,
      sourceId: LOCALDATA_SOURCE_ID,
      snapshotId,
      pageCount: summary.pageCount,
      readCount: summary.readCount,
      insertedCount: summary.insertedCount,
      updatedCount: summary.updatedCount,
      rejectedCount: summary.rejectedCount
    });
    return summary;
  } catch {
    failRun(appDatabase, runId, now());
    throw new Error("CATALOG_INGESTION_FAILED");
  }
}
