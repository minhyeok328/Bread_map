import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../packages/app-db/src/index.js";
import { openRawDatabase } from "../packages/raw-db/src/index.js";
import { migrateDatabases } from "./migrate-databases.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("migrateDatabases", () => {
  it("migrates the app and raw databases at explicit local paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-migrate-"));
    cleanupPaths.push(directory);
    const appPath = join(directory, "app.sqlite");
    const rawPath = join(directory, "raw.sqlite");

    const result = migrateDatabases({ appPath, rawPath });

    expect(result).toEqual({
      appDatabasePath: appPath,
      rawDatabasePath: rawPath
    });

    const app = openAppDatabase({ path: appPath, readonly: true });
    const raw = openRawDatabase({ path: rawPath, readonly: true });
    try {
      expect(
        app.client.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_metadata'"
        ).get()
      ).toEqual({ name: "storage_metadata" });
      expect(
        raw.client.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_metadata'"
        ).get()
      ).toEqual({ name: "storage_metadata" });
    } finally {
      raw.close();
      app.close();
    }
  });
});
