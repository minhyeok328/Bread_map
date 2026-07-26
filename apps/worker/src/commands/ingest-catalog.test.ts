import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestCatalogCommand } from "./ingest-catalog.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("ingestCatalogCommand", () => {
  it("requires an explicit fixture or live mode", async () => {
    await expect(
      ingestCatalogCommand({ argv: [], env: {} })
    ).rejects.toThrow("INGEST_MODE_REQUIRED");
  });

  it("requires the documented public-data key before live access", async () => {
    let requested = false;

    await expect(
      ingestCatalogCommand({
        argv: ["--live", "--basis-date", "2026-07-24"],
        env: {},
        fetchImpl: async () => {
          requested = true;
          throw new Error("unexpected network request");
        }
      })
    ).rejects.toThrow("DATA_GO_KR_SERVICE_KEY_REQUIRED");
    expect(requested).toBe(false);
  });

  it("runs the fixed fixture twice without network or staging duplicates", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-ingest-command-")
    );
    cleanupPaths.push(directory);
    const appPath = join(directory, "app.sqlite");
    const fixturePath = resolve(
      "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
    );
    const output: string[] = [];
    let requested = false;
    const argv = [
      "--fixture",
      fixturePath,
      "--app-db",
      appPath
    ];

    const first = await ingestCatalogCommand({
      argv,
      env: {},
      fetchImpl: async () => {
        requested = true;
        throw new Error("unexpected network request");
      },
      stdout: (line) => output.push(line),
      now: () => 1785034800000
    });
    const second = await ingestCatalogCommand({
      argv,
      env: {},
      fetchImpl: async () => {
        requested = true;
        throw new Error("unexpected network request");
      },
      stdout: (line) => output.push(line),
      now: () => 1785034860000
    });

    expect(first).toMatchObject({
      readCount: 4,
      insertedCount: 3,
      updatedCount: 0,
      rejectedCount: 1
    });
    expect(second).toMatchObject({
      runId: first.runId,
      readCount: 4,
      insertedCount: 0,
      updatedCount: 0,
      rejectedCount: 1
    });
    expect(requested).toBe(false);
    expect(output).toHaveLength(2);
    expect(JSON.parse(output[0] ?? "{}")).toEqual(first);
    expect(JSON.parse(output[1] ?? "{}")).toEqual(second);
    expect(existsSync(appPath)).toBe(true);
    expect(existsSync(join(directory, "raw.sqlite"))).toBe(false);
  });
});
