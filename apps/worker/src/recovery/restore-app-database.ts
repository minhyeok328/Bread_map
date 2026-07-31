import { createHash } from "node:crypto";
import {
  existsSync
} from "node:fs";
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { RECOMMENDATION_VERSION } from "@bread-map/contracts";
import {
  executeSqliteStoreSearch,
  resolveCurrentSqliteSearchDataVersion
} from "@bread-map/retrieval";
import { backupSqliteFile } from "@bread-map/sqlite-core";

export interface RestoreAppDatabaseOptions {
  snapshotPath: string;
  destinationPath: string;
  migrationsDirectory: string;
  requestTimeMs: number;
  expectedExcludedStoreIds?: readonly string[];
}

export interface RestoreAppDatabaseReport {
  status: "VERIFIED";
  snapshotFile: string;
  destinationFile: string;
  integrityCheck: "ok";
  foreignKeyViolationCount: 0;
  migrationCount: number;
  applicationTableCount: number;
  applicationRowCount: number;
  reviewDocumentCount: number;
  ftsDocumentCount: number;
  logicalChecksum: string;
  logicalChecksumMatchesSnapshot: true;
  representativeSearch: {
    dataSnapshotVersion: string;
    resultCount: number;
    deterministic: true;
    excludedStoreViolationCount: 0;
  };
  swapCandidate: true;
}

interface LogicalDatabaseSignature {
  tableCount: number;
  rowCount: number;
  checksum: string;
}

const SAFE_PRECONDITION_ERRORS = new Set([
  "RESTORE_SNAPSHOT_NOT_FOUND",
  "RESTORE_PATH_MUST_BE_FILESYSTEM",
  "RESTORE_DESTINATION_MUST_BE_NEW",
  "RESTORE_DESTINATION_EXISTS"
]);

function isSqliteUrl(path: string): boolean {
  return /^(?:file|sqlite):/iu.test(path.trim());
}

function comparablePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function canonicalValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { bufferHex: value.toString("hex") };
  }
  if (typeof value === "bigint") {
    return { bigint: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)])
    );
  }
  return value;
}

function logicalDatabaseSignature(
  database: AppDatabaseHandle
): LogicalDatabaseSignature {
  const tables = database.client
    .prepare(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name <> '__drizzle_migrations'
        ORDER BY name`
    )
    .all() as { name: string }[];
  const hash = createHash("sha256");
  let rowCount = 0;

  for (const { name } of tables) {
    const rows = database.client
      .prepare(`SELECT * FROM ${quoteIdentifier(name)}`)
      .all()
      .map(canonicalValue)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
    rowCount += rows.length;
    hash.update(name);
    hash.update("\0");
    hash.update(JSON.stringify(rows));
    hash.update("\0");
  }

  return {
    tableCount: tables.length,
    rowCount,
    checksum: hash.digest("hex")
  };
}

function scalarCount(
  database: AppDatabaseHandle,
  table: string
): number {
  const row = database.client
    .prepare(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
    )
    .get() as { count: number };
  return row.count;
}

function assertDatabaseHealth(
  database: AppDatabaseHandle
): {
  migrationCount: number;
  integrityCheck: "ok";
  foreignKeyViolationCount: 0;
} {
  const integrity = database.client.pragma("integrity_check", {
    simple: true
  });
  if (integrity !== "ok") {
    throw new Error("RESTORE_INTEGRITY_FAILED");
  }
  const foreignKeyViolations = database.client.pragma(
    "foreign_key_check"
  ) as unknown[];
  if (foreignKeyViolations.length !== 0) {
    throw new Error("RESTORE_FOREIGN_KEY_FAILED");
  }
  const migrationCount = scalarCount(
    database,
    "__drizzle_migrations"
  );
  if (migrationCount < 1) {
    throw new Error("RESTORE_MIGRATION_HISTORY_MISSING");
  }
  return {
    migrationCount,
    integrityCheck: "ok",
    foreignKeyViolationCount: 0
  };
}

function verifyRepresentativeSearch(
  database: AppDatabaseHandle,
  requestTimeMs: number,
  expectedExcludedStoreIds: readonly string[]
): RestoreAppDatabaseReport["representativeSearch"] {
  const dataSnapshotVersion =
    resolveCurrentSqliteSearchDataVersion({
      appDatabase: database,
      requestTimeMs
    });
  const input = {
    region: null,
    storeName: null,
    menuName: null,
    categories: [],
    openNow: false,
    origin: null,
    maxDistanceM: null,
    reviewEvidenceStatus: "ANY",
    sortMode: "RELEVANCE",
    dataSnapshotVersion,
    recommendationVersion: RECOMMENDATION_VERSION
  } as const;
  const first = executeSqliteStoreSearch({
    appDatabase: database,
    input,
    requestTimeMs
  });
  const second = executeSqliteStoreSearch({
    appDatabase: database,
    input,
    requestTimeMs
  });
  if (first.items.length === 0) {
    throw new Error("RESTORE_REPRESENTATIVE_SEARCH_EMPTY");
  }
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("RESTORE_REPRESENTATIVE_SEARCH_NONDETERMINISTIC");
  }
  const excludedStoreViolationCount = first.items.filter((item) =>
    expectedExcludedStoreIds.includes(item.storeId)
  ).length;
  if (excludedStoreViolationCount !== 0) {
    throw new Error("RESTORE_EXCLUDED_STORE_VISIBLE");
  }
  return {
    dataSnapshotVersion,
    resultCount: first.items.length,
    deterministic: true,
    excludedStoreViolationCount: 0
  };
}

async function removePartialDestination(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map((candidate) =>
      rm(candidate, { force: true })
    )
  );
}

export async function restoreAppDatabase(
  options: RestoreAppDatabaseOptions
): Promise<RestoreAppDatabaseReport> {
  if (
    isSqliteUrl(options.snapshotPath) ||
    isSqliteUrl(options.destinationPath)
  ) {
    throw new Error("RESTORE_PATH_MUST_BE_FILESYSTEM");
  }
  const snapshotPath = resolve(options.snapshotPath);
  const destinationPath = resolve(options.destinationPath);

  if (!existsSync(snapshotPath)) {
    throw new Error("RESTORE_SNAPSHOT_NOT_FOUND");
  }
  if (
    comparablePath(snapshotPath) ===
    comparablePath(destinationPath)
  ) {
    throw new Error("RESTORE_DESTINATION_MUST_BE_NEW");
  }
  if (existsSync(destinationPath)) {
    throw new Error("RESTORE_DESTINATION_EXISTS");
  }

  let snapshot: AppDatabaseHandle | undefined;
  let restored: AppDatabaseHandle | undefined;
  let destinationCreated = false;
  let verified = false;
  try {
    snapshot = openAppDatabase({
      path: snapshotPath,
      readonly: true
    });
    const snapshotHealth = assertDatabaseHealth(snapshot);
    const snapshotSignature = logicalDatabaseSignature(snapshot);
    await backupSqliteFile(snapshot.client, destinationPath);
    destinationCreated = true;
    snapshot.close();
    snapshot = undefined;

    restored = openAppDatabase({ path: destinationPath });
    migrateAppDatabase(restored, options.migrationsDirectory);
    const restoredHealth = assertDatabaseHealth(restored);
    if (restoredHealth.migrationCount < snapshotHealth.migrationCount) {
      throw new Error("RESTORE_MIGRATION_HISTORY_REGRESSED");
    }
    const restoredSignature = logicalDatabaseSignature(restored);
    if (
      restoredSignature.checksum !== snapshotSignature.checksum ||
      restoredSignature.rowCount !== snapshotSignature.rowCount
    ) {
      throw new Error("RESTORE_LOGICAL_CHECKSUM_MISMATCH");
    }
    const reviewDocumentCount = scalarCount(
      restored,
      "review_document"
    );
    const ftsDocumentCount = scalarCount(restored, "review_fts");
    if (reviewDocumentCount !== ftsDocumentCount) {
      throw new Error("RESTORE_FTS_COUNT_MISMATCH");
    }
    const representativeSearch = verifyRepresentativeSearch(
      restored,
      options.requestTimeMs,
      options.expectedExcludedStoreIds ?? []
    );

    const report: RestoreAppDatabaseReport = {
      status: "VERIFIED",
      snapshotFile: basename(snapshotPath),
      destinationFile: basename(destinationPath),
      integrityCheck: restoredHealth.integrityCheck,
      foreignKeyViolationCount:
        restoredHealth.foreignKeyViolationCount,
      migrationCount: restoredHealth.migrationCount,
      applicationTableCount: restoredSignature.tableCount,
      applicationRowCount: restoredSignature.rowCount,
      reviewDocumentCount,
      ftsDocumentCount,
      logicalChecksum: restoredSignature.checksum,
      logicalChecksumMatchesSnapshot: true,
      representativeSearch,
      swapCandidate: true
    };
    verified = true;
    return report;
  } catch (error) {
    if (
      error instanceof Error &&
      SAFE_PRECONDITION_ERRORS.has(error.message)
    ) {
      throw error;
    }
    void error;
    throw new Error("RESTORE_VERIFICATION_FAILED");
  } finally {
    snapshot?.close();
    restored?.close();
    if (destinationCreated && !verified) {
      await removePartialDestination(destinationPath);
    }
  }
}
