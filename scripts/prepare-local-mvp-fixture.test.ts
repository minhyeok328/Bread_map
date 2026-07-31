import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  prepareLocalMvpFixture
} from "./prepare-local-mvp-fixture.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-local-mvp-bootstrap-")
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local MVP fixture bootstrap", () => {
  it("takes empty files through migrations, catalog ingest and real search", async () => {
    const report = await prepareLocalMvpFixture({
      appPath: join(directory, "app.sqlite"),
      rawPath: join(directory, "raw.sqlite"),
      appMigrationsDirectory: resolve("drizzle/app"),
      rawMigrationsDirectory: resolve("drizzle/raw"),
      catalogFixturePath: resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      )
    });

    expect(report).toMatchObject({
      status: "VERIFIED",
      appMigrationCount: 6,
      catalogIngest: {
        readCount: 4,
        insertedCount: 3,
        updatedCount: 0,
        rejectedCount: 1,
        stagingRowCount: 3
      },
      search: {
        resultCount: 2,
        deterministic: true
      }
    });
    expect(report.rawMigrationCount).toBeGreaterThan(0);
    expect(report.search.dataSnapshotVersion).toMatch(
      /^search-data-v1_[a-f0-9]{64}$/
    );
    expect(JSON.stringify(report)).not.toContain(directory);
  });

  it("refuses to reuse either database path", async () => {
    const appPath = join(directory, "same.sqlite");
    const rawPath = join(directory, "raw.sqlite");
    await prepareLocalMvpFixture({
      appPath,
      rawPath,
      appMigrationsDirectory: resolve("drizzle/app"),
      rawMigrationsDirectory: resolve("drizzle/raw"),
      catalogFixturePath: resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      )
    });

    await expect(
      prepareLocalMvpFixture({
        appPath,
        rawPath: join(directory, "raw-two.sqlite"),
        appMigrationsDirectory: resolve("drizzle/app"),
        rawMigrationsDirectory: resolve("drizzle/raw"),
        catalogFixturePath: resolve(
          "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
        )
      })
    ).rejects.toThrow("LOCAL_MVP_DATABASE_PATH_EXISTS");
  });
});
