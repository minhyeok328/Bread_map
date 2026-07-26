import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appStorageMetadata,
  migrateAppDatabase,
  openAppDatabase
} from "../packages/app-db/src/index.js";
import { backupAppDatabase } from "./backup-app-database.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("backupAppDatabase", () => {
  it("backs up app data to the explicit output path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-app-backup-"));
    cleanupPaths.push(directory);
    const appPath = join(directory, "app.sqlite");
    const backupPath = join(directory, "backups", "app.sqlite");
    const app = openAppDatabase({ path: appPath });
    migrateAppDatabase(app, resolve("drizzle/app"));
    app.db.insert(appStorageMetadata).values({
      key: "schema_owner",
      value: "app-db",
      updatedAt: new Date(0)
    }).run();
    app.close();

    const backupResult = await backupAppDatabase({
      appPath,
      outputPath: backupPath
    });

    expect(backupResult.outputPath).toBe(backupPath);
    const backup = openAppDatabase({ path: backupPath, readonly: true });
    try {
      expect(backup.db.select().from(appStorageMetadata).all()).toEqual([
        {
          key: "schema_owner",
          value: "app-db",
          updatedAt: new Date(0)
        }
      ]);
    } finally {
      backup.close();
    }
  });
});
