import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRegistry,
  hashSessionId
} from "./session-registry.js";

let directory: string;
let database: AppDatabaseHandle;
let nowMs: number;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-session-registry-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  database.client
    .prepare(
      `INSERT INTO user (
         user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
       ) VALUES ('user-a', 'ACTIVE', 1, 1, NULL)`
    )
    .run();
  nowMs = 1_000;
});

afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});

describe("hashed session registry", () => {
  it("stores the independently derived SHA-256 hash, never the session ID", () => {
    const registry = createSessionRegistry(database.db, {
      now: () => nowMs
    });
    registry.register({
      sessionId: "plain-session-id",
      userId: "user-a",
      authenticatedAtMs: 1_000,
      expiresAtMs: 2_000
    });

    expect(hashSessionId("plain-session-id")).toBe(
      "2e82b969476bd619b2991d9756f9ee0e614b43acb63afaf0411967fa6d2fdc46"
    );
    expect(
      database.client
        .prepare(
          `SELECT user_id, session_token_hash, authenticated_at_ms,
             expires_at_ms
           FROM session`
        )
        .all()
    ).toEqual([
      {
        user_id: "user-a",
        session_token_hash:
          "2e82b969476bd619b2991d9756f9ee0e614b43acb63afaf0411967fa6d2fdc46",
        authenticated_at_ms: 1_000,
        expires_at_ms: 2_000
      }
    ]);
    expect(database.client.serialize().includes("plain-session-id")).toBe(
      false
    );
  });

  it("resolves only active, unexpired, unrevoked sessions", () => {
    const registry = createSessionRegistry(database.db, {
      now: () => nowMs
    });
    registry.register({
      sessionId: "session-a",
      userId: "user-a",
      authenticatedAtMs: 1_000,
      expiresAtMs: 2_000
    });

    expect(registry.resolve("session-a")).toEqual({
      userId: "user-a",
      authenticatedAtMs: 1_000,
      expiresAtMs: 2_000
    });

    registry.revoke("session-a");
    expect(registry.resolve("session-a")).toBeNull();

    registry.register({
      sessionId: "session-expiring",
      userId: "user-a",
      authenticatedAtMs: 1_000,
      expiresAtMs: 2_000
    });
    nowMs = 2_001;
    expect(registry.resolve("session-expiring")).toBeNull();
    expect(
      database.client
        .prepare("SELECT count(*) AS count FROM session")
        .get()
    ).toEqual({ count: 0 });
  });

  it("rejects sessions as soon as an account enters deleting state", () => {
    const registry = createSessionRegistry(database.db, {
      now: () => nowMs
    });
    registry.register({
      sessionId: "session-a",
      userId: "user-a",
      authenticatedAtMs: 1_000,
      expiresAtMs: 2_000
    });
    database.client
      .prepare(
        `UPDATE user
         SET status = 'DELETING', deleted_at_ms = 1001,
           updated_at_ms = 1001
         WHERE user_id = 'user-a'`
      )
      .run();

    expect(registry.resolve("session-a")).toBeNull();
  });
});
