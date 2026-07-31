import {
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase
} from "@bread-map/app-db";
import {
  seedSqliteSearchFixture,
  SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
} from "@bread-map/testkit";
import { backupSqliteFile } from "@bread-map/sqlite-core";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  restoreAppDatabase
} from "./restore-app-database.js";

let directory: string;
const migrationsDirectory = resolve("drizzle/app");

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-app-restore-")
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function createSnapshot(): Promise<string> {
  const sourcePath = join(directory, "active-app.sqlite");
  const snapshotPath = join(directory, "snapshot.sqlite");
  const source = openAppDatabase({ path: sourcePath });
  try {
    migrateAppDatabase(source, migrationsDirectory);
    seedSqliteSearchFixture(source);
    await backupSqliteFile(source.client, snapshotPath);
  } finally {
    source.close();
  }
  return snapshotPath;
}

describe("app database restore rehearsal", () => {
  it("restores a snapshot to a new verified swap candidate", async () => {
    const snapshotPath = await createSnapshot();
    const destinationPath = join(directory, "restored-app.sqlite");

    const report = await restoreAppDatabase({
      snapshotPath,
      destinationPath,
      migrationsDirectory,
      requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS,
      expectedExcludedStoreIds: ["store_hidden"]
    });

    expect(report).toMatchObject({
      status: "VERIFIED",
      snapshotFile: "snapshot.sqlite",
      destinationFile: "restored-app.sqlite",
      integrityCheck: "ok",
      foreignKeyViolationCount: 0,
      logicalChecksumMatchesSnapshot: true,
      reviewDocumentCount: 5,
      ftsDocumentCount: 5,
      swapCandidate: true,
      representativeSearch: {
        resultCount: 2,
        deterministic: true,
        excludedStoreViolationCount: 0
      }
    });
    expect(report.migrationCount).toBeGreaterThan(0);
    expect(report.applicationTableCount).toBeGreaterThan(10);
    expect(report.applicationRowCount).toBeGreaterThan(20);
    expect(report.logicalChecksum).toMatch(/^[a-f0-9]{64}$/);

    const restored = openAppDatabase({
      path: destinationPath,
      readonly: true
    });
    try {
      expect(
        restored.client
          .prepare("SELECT COUNT(*) AS count FROM store")
          .get()
      ).toEqual({ count: 3 });
    } finally {
      restored.close();
    }
  });

  it("rejects URLs, missing, identical, and preexisting destinations", async () => {
    const snapshotPath = await createSnapshot();
    const existingPath = join(directory, "existing.sqlite");
    await writeFile(existingPath, "keep-me", "utf8");

    await expect(
      restoreAppDatabase({
        snapshotPath: "file:active.sqlite",
        destinationPath: join(directory, "url-output.sqlite"),
        migrationsDirectory,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      })
    ).rejects.toThrow("RESTORE_PATH_MUST_BE_FILESYSTEM");
    await expect(
      restoreAppDatabase({
        snapshotPath: join(directory, "missing.sqlite"),
        destinationPath: join(directory, "missing-output.sqlite"),
        migrationsDirectory,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      })
    ).rejects.toThrow("RESTORE_SNAPSHOT_NOT_FOUND");
    await expect(
      restoreAppDatabase({
        snapshotPath,
        destinationPath: snapshotPath,
        migrationsDirectory,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      })
    ).rejects.toThrow("RESTORE_DESTINATION_MUST_BE_NEW");
    await expect(
      restoreAppDatabase({
        snapshotPath,
        destinationPath: existingPath,
        migrationsDirectory,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      })
    ).rejects.toThrow("RESTORE_DESTINATION_EXISTS");
  });

  it("fails closed and removes a partial destination for corrupt input", async () => {
    const snapshotPath = join(directory, "corrupt.sqlite");
    const destinationPath = join(directory, "corrupt-restored.sqlite");
    await writeFile(snapshotPath, "not a sqlite database", "utf8");

    await expect(
      restoreAppDatabase({
        snapshotPath,
        destinationPath,
        migrationsDirectory,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      })
    ).rejects.toThrow("RESTORE_VERIFICATION_FAILED");

    await expect(
      () =>
        openAppDatabase({
          path: destinationPath,
          readonly: true
        })
    ).toThrow();
  });
});
