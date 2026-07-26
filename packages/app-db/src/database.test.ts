import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "./database.js";
import { migrateAppDatabase } from "./migrate.js";
import { appStorageMetadata } from "./schema/index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("app database", () => {
  it("migrates a blank database and persists service metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-app-db-"));
    cleanupPaths.push(directory);
    const handle = openAppDatabase({ path: join(directory, "app.sqlite") });

    migrateAppDatabase(handle, resolve("drizzle/app"));
    handle.db.insert(appStorageMetadata).values({
      key: "schema_owner",
      value: "app-db",
      updatedAt: new Date(0)
    }).run();

    const rows = handle.db.select().from(appStorageMetadata).all();
    expect(rows).toEqual([
      {
        key: "schema_owner",
        value: "app-db",
        updatedAt: new Date(0)
      }
    ]);

    handle.close();
  });
});
