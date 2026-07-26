import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRawDatabase } from "./database.js";
import { migrateRawDatabase } from "./migrate.js";
import { rawStorageMetadata } from "./schema/index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("raw database", () => {
  it("migrates a blank database and persists service metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-raw-db-"));
    cleanupPaths.push(directory);
    const handle = openRawDatabase({ path: join(directory, "raw.sqlite") });

    migrateRawDatabase(handle, resolve("drizzle/raw"));
    handle.db.insert(rawStorageMetadata).values({
      key: "schema_owner",
      value: "raw-db",
      updatedAt: new Date(0)
    }).run();

    const rows = handle.db.select().from(rawStorageMetadata).all();
    expect(rows).toEqual([
      {
        key: "schema_owner",
        value: "raw-db",
        updatedAt: new Date(0)
      }
    ]);

    handle.close();
  });
});
