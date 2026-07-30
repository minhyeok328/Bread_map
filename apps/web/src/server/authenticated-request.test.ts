import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encode } from "@auth/core/jwt";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_JWT_MAX_AGE_SECONDS,
  AUTH_ORIGIN
} from "../auth-config.js";
import {
  AUTH_SESSION_COOKIE_NAME,
  createAuthenticatedRequestResolver
} from "./authenticated-request.js";
import { createSessionRegistry } from "./session-registry.js";

let directory: string;
let database: AppDatabaseHandle;
let nowMs: number;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-authenticated-request-")
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

describe("authenticated request principal", () => {
  it("decodes only the HttpOnly session cookie and verifies its registry row", async () => {
    const secret = "test-auth-secret";
    const registry = createSessionRegistry(database.db, {
      now: () => nowMs
    });
    const claims = {
      internalUserId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: nowMs,
      expiresAtMs:
        nowMs + AUTH_JWT_MAX_AGE_SECONDS * 1_000,
      kakaoAccessToken: "kakao-access-token"
    };
    registry.register({
      userId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: nowMs,
      expiresAtMs:
        nowMs + AUTH_JWT_MAX_AGE_SECONDS * 1_000
    });
    const token = await encode({
      token: claims,
      secret,
      salt: AUTH_SESSION_COOKIE_NAME,
      maxAge: AUTH_JWT_MAX_AGE_SECONDS
    });
    const resolver = createAuthenticatedRequestResolver({
      secret,
      registry
    });

    await expect(
      resolver(
        new Request(`${AUTH_ORIGIN}/api/favorites`, {
          headers: {
            cookie: `${AUTH_SESSION_COOKIE_NAME}=${token}`
          }
        })
      )
    ).resolves.toEqual({
      userId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: 1_000,
      kakaoAccessToken: "kakao-access-token"
    });

    await expect(
      resolver(
        new Request(`${AUTH_ORIGIN}/api/favorites`, {
          headers: {
            authorization: `Bearer ${encodeURIComponent(token)}`
          }
        })
      )
    ).resolves.toBeNull();
  });

  it("rejects a revoked protected cookie immediately", async () => {
    const secret = "test-auth-secret";
    const registry = createSessionRegistry(database.db, {
      now: () => nowMs
    });
    const token = await encode({
      token: {
        internalUserId: "user-a",
        sessionId: "revoked-session",
        authenticatedAtMs: nowMs,
        expiresAtMs:
          nowMs + AUTH_JWT_MAX_AGE_SECONDS * 1_000,
        kakaoAccessToken: "token"
      },
      secret,
      salt: AUTH_SESSION_COOKIE_NAME,
      maxAge: AUTH_JWT_MAX_AGE_SECONDS
    });
    const resolver = createAuthenticatedRequestResolver({
      secret,
      registry
    });

    await expect(
      resolver(
        new Request(`${AUTH_ORIGIN}/api/history`, {
          headers: {
            cookie: `${AUTH_SESSION_COOKIE_NAME}=${token}`
          }
        })
      )
    ).resolves.toBeNull();
  });
});
