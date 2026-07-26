import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  migrateAppDatabase,
  openAppDatabase
} from "../packages/app-db/src/index.js";
import {
  migrateRawDatabase,
  openRawDatabase
} from "../packages/raw-db/src/index.js";

export interface MigrateDatabasePaths {
  appPath?: string;
  rawPath?: string;
}

export function migrateDatabases(
  paths: MigrateDatabasePaths = {}
): {
  appDatabasePath: string;
  rawDatabasePath: string;
} {
  const app = openAppDatabase(
    paths.appPath === undefined ? {} : { path: paths.appPath }
  );
  const raw = openRawDatabase(
    paths.rawPath === undefined ? {} : { path: paths.rawPath }
  );
  try {
    migrateAppDatabase(app, resolve("drizzle/app"));
    migrateRawDatabase(raw, resolve("drizzle/raw"));
    return {
      appDatabasePath: app.path,
      rawDatabasePath: raw.path
    };
  } finally {
    raw.close();
    app.close();
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1];

if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === pathToFileURL(currentFile).href
) {
  try {
    const result = migrateDatabases();
    console.log(result.appDatabasePath);
    console.log(result.rawDatabasePath);
  } catch {
    console.error("Database migration failed.");
    process.exitCode = 1;
  }
}
