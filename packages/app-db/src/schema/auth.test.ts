import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../database.js";
import { migrateAppDatabase } from "../migrate.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createMigratedDatabase() {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-auth-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(handle, resolve("drizzle/app"));
  return handle;
}

function tableColumns(
  client: ReturnType<typeof openAppDatabase>["client"],
  table: string
): string[] {
  return client
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function insertUser(
  client: ReturnType<typeof openAppDatabase>["client"],
  userId: string
): void {
  client
    .prepare(
      `INSERT INTO user (
         user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
       ) VALUES (?, 'ACTIVE', 1, 1, NULL)`
    )
    .run(userId);
}

describe("authentication app schema", () => {
  it("creates only the approved account and session fields", async () => {
    const handle = await createMigratedDatabase();

    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));

      const tableNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).toEqual(
        expect.arrayContaining(["user", "account", "session"])
      );

      expect(tableColumns(handle.client, "user")).toEqual([
        "user_id",
        "status",
        "created_at_ms",
        "updated_at_ms",
        "deleted_at_ms"
      ]);
      expect(tableColumns(handle.client, "account")).toEqual([
        "account_id",
        "user_id",
        "type",
        "provider",
        "provider_account_id",
        "created_at_ms"
      ]);
      expect(tableColumns(handle.client, "session")).toEqual([
        "session_id",
        "user_id",
        "session_token_hash",
        "authenticated_at_ms",
        "expires_at_ms",
        "created_at_ms"
      ]);

      const allColumns = [
        ...tableColumns(handle.client, "user"),
        ...tableColumns(handle.client, "account"),
        ...tableColumns(handle.client, "session")
      ];
      expect(allColumns).not.toEqual(
        expect.arrayContaining([
          "email",
          "phone",
          "birthday",
          "gender",
          "nickname",
          "image",
          "access_token",
          "refresh_token",
          "id_token",
          "session_token"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("enforces minimized Kakao identity and hashed session constraints", async () => {
    const handle = await createMigratedDatabase();

    try {
      insertUser(handle.client, "user-a");
      insertUser(handle.client, "user-b");

      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO user (
               user_id, status, created_at_ms, updated_at_ms,
               deleted_at_ms
             ) VALUES ('invalid-user', 'SUSPENDED', 1, 1, NULL)`
          )
          .run()
      ).toThrow();

      handle.client
        .prepare(
          `INSERT INTO account (
             account_id, user_id, type, provider,
             provider_account_id, created_at_ms
           ) VALUES ('account-a', 'user-a', 'oauth', 'kakao',
             'provider-a', 1)`
        )
        .run();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO account (
               account_id, user_id, type, provider,
               provider_account_id, created_at_ms
             ) VALUES ('account-duplicate', 'user-b', 'oauth',
               'kakao', 'provider-a', 1)`
          )
          .run()
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO account (
               account_id, user_id, type, provider,
               provider_account_id, created_at_ms
             ) VALUES ('account-wrong-provider', 'user-b', 'oauth',
               'google', 'provider-b', 1)`
          )
          .run()
      ).toThrow();

      const validHash = "a".repeat(64);
      handle.client
        .prepare(
          `INSERT INTO session (
             session_id, user_id, session_token_hash,
             authenticated_at_ms, expires_at_ms, created_at_ms
           ) VALUES ('session-a', 'user-a', ?, 10, 20, 10)`
        )
        .run(validHash);
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO session (
               session_id, user_id, session_token_hash,
               authenticated_at_ms, expires_at_ms, created_at_ms
             ) VALUES ('session-uppercase', 'user-b', ?, 10, 20, 10)`
          )
          .run("A".repeat(64))
      ).toThrow();
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO session (
               session_id, user_id, session_token_hash,
               authenticated_at_ms, expires_at_ms, created_at_ms
             ) VALUES ('session-plaintext', 'user-b',
               'plain-session-token', 10, 20, 10)`
          )
          .run()
      ).toThrow();

      handle.client
        .prepare("DELETE FROM user WHERE user_id = 'user-a'")
        .run();
      expect(
        handle.client
          .prepare(
            "SELECT count(*) AS count FROM account WHERE user_id = 'user-a'"
          )
          .get()
      ).toEqual({ count: 0 });
      expect(
        handle.client
          .prepare(
            "SELECT count(*) AS count FROM session WHERE user_id = 'user-a'"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      handle.close();
    }
  });
});
