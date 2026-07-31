import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  migrateAppDatabase,
  openAppDatabase
} from "../packages/app-db/src/index.js";
import {
  RECOMMENDATION_VERSION
} from "../packages/contracts/src/index.js";
import {
  migrateRawDatabase,
  openRawDatabase
} from "../packages/raw-db/src/index.js";
import {
  executeSqliteStoreSearch,
  resolveCurrentSqliteSearchDataVersion
} from "../packages/retrieval/src/index.js";
import {
  seedSqliteSearchFixture,
  SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
} from "../packages/testkit/src/index.js";
import {
  ingestCatalogCommand
} from "../apps/worker/src/commands/ingest-catalog.js";

export interface PrepareLocalMvpFixtureOptions {
  appPath: string;
  rawPath: string;
  appMigrationsDirectory: string;
  rawMigrationsDirectory: string;
  catalogFixturePath: string;
}

export interface LocalMvpFixtureReport {
  status: "VERIFIED";
  appMigrationCount: number;
  rawMigrationCount: number;
  catalogIngest: {
    readCount: 4;
    insertedCount: 3;
    updatedCount: 0;
    rejectedCount: 1;
    stagingRowCount: 3;
  };
  search: {
    dataSnapshotVersion: string;
    resultCount: 2;
    deterministic: true;
  };
}

function migrationCount(client: {
  prepare(sql: string): {
    get(): unknown;
  };
}): number {
  return (
    client
      .prepare(
        "SELECT COUNT(*) AS count FROM __drizzle_migrations"
      )
      .get() as { count: number }
  ).count;
}

export async function prepareLocalMvpFixture(
  options: PrepareLocalMvpFixtureOptions
): Promise<LocalMvpFixtureReport> {
  if (existsSync(options.appPath) || existsSync(options.rawPath)) {
    throw new Error("LOCAL_MVP_DATABASE_PATH_EXISTS");
  }

  const migratingApp = openAppDatabase({ path: options.appPath });
  try {
    migrateAppDatabase(
      migratingApp,
      options.appMigrationsDirectory
    );
  } finally {
    migratingApp.close();
  }

  const ingest = await ingestCatalogCommand({
    argv: [
      "--fixture",
      options.catalogFixturePath,
      "--app-db",
      options.appPath
    ],
    env: {},
    stdout: () => undefined,
    now: () => 1_785_034_800_000
  });

  const raw = openRawDatabase({ path: options.rawPath });
  let rawMigrationCount: number;
  try {
    migrateRawDatabase(raw, options.rawMigrationsDirectory);
    rawMigrationCount = migrationCount(raw.client);
  } finally {
    raw.close();
  }

  const app = openAppDatabase({ path: options.appPath });
  try {
    seedSqliteSearchFixture(app);
    const appMigrationCount = migrationCount(app.client);
    const stagingRowCount = (
      app.client
        .prepare(
          "SELECT COUNT(*) AS count FROM localdata_bakery_record WHERE snapshot_id <> 'snapshot_active'"
        )
        .get() as { count: number }
    ).count;
    const dataSnapshotVersion =
      resolveCurrentSqliteSearchDataVersion({
        appDatabase: app,
        requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
      });
    const input = {
      region: "마포구",
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
      appDatabase: app,
      input,
      requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    });
    const second = executeSqliteStoreSearch({
      appDatabase: app,
      input,
      requestTimeMs: SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    });
    if (
      ingest.readCount !== 4 ||
      ingest.insertedCount !== 3 ||
      ingest.updatedCount !== 0 ||
      ingest.rejectedCount !== 1 ||
      stagingRowCount !== 3 ||
      first.items.length !== 2 ||
      JSON.stringify(first) !== JSON.stringify(second)
    ) {
      throw new Error("LOCAL_MVP_FIXTURE_VERIFICATION_FAILED");
    }

    return {
      status: "VERIFIED",
      appMigrationCount,
      rawMigrationCount,
      catalogIngest: {
        readCount: 4,
        insertedCount: 3,
        updatedCount: 0,
        rejectedCount: 1,
        stagingRowCount: 3
      },
      search: {
        dataSnapshotVersion,
        resultCount: 2,
        deterministic: true
      }
    };
  } finally {
    app.close();
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  const runDirectoryIndex = process.argv.indexOf("--run-dir");
  const runDirectory = process.argv[runDirectoryIndex + 1];
  if (
    runDirectoryIndex < 0 ||
    runDirectory === undefined ||
    runDirectory.startsWith("--")
  ) {
    console.error("Usage: prepare-local-mvp-fixture --run-dir <path>");
    process.exitCode = 1;
  } else {
    prepareLocalMvpFixture({
      appPath: join(runDirectory, "app.sqlite"),
      rawPath: join(runDirectory, "raw.sqlite"),
      appMigrationsDirectory: resolve("drizzle/app"),
      rawMigrationsDirectory: resolve("drizzle/raw"),
      catalogFixturePath: resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      )
    })
      .then((report) => console.log(JSON.stringify(report)))
      .catch(() => {
        console.error("Local MVP fixture preparation failed.");
        process.exitCode = 1;
      });
  }
}
