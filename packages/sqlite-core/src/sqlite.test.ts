import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupSqliteFile,
  openSqliteFile,
  resolveSqlitePath
} from "./sqlite.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("openSqliteFile", () => {
  it("creates a local SQLite file with the approved pragmas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-sqlite-"));
    cleanupPaths.push(directory);
    const handle = openSqliteFile(join(directory, "app.sqlite"));

    expect(handle.client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.client.pragma("busy_timeout", { simple: true })).toBe(5000);

    handle.close();
  });

  it("creates a readable online backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-backup-"));
    cleanupPaths.push(directory);
    const source = openSqliteFile(join(directory, "app.sqlite"));
    try {
      source.client.exec("CREATE TABLE sample (value TEXT NOT NULL)");
      source.client.prepare("INSERT INTO sample VALUES (?)").run("bread");

      const backupPath = join(directory, "backups", "app.sqlite");
      await backupSqliteFile(source.client, backupPath);
      const backup = openSqliteFile(backupPath, {
        readonly: true,
        fileMustExist: true
      });

      try {
        expect(
          backup.client.prepare("SELECT value FROM sample").get()
        ).toEqual({ value: "bread" });
      } finally {
        backup.close();
      }
    } finally {
      source.close();
    }
  });
});

describe("resolveSqlitePath", () => {
  it("uses the fallback for blank values and permits in-memory tests", () => {
    expect(resolveSqlitePath(" ", "var/app.sqlite")).toMatch(
      /var[\\/]app\.sqlite$/
    );
    expect(resolveSqlitePath(":memory:", "unused.sqlite")).toBe(":memory:");
  });

  it("rejects a remote database URL", () => {
    expect(() =>
      resolveSqlitePath("libsql://example.turso.io", "var/app.sqlite")
    ).toThrow("Local SQLite paths only");
  });
});
