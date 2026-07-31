import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";
import { openAppDatabase } from "@bread-map/app-db";
import type { Cookie } from "@playwright/test";
import {
  AUTH_JWT_MAX_AGE_SECONDS,
  AUTH_ORIGIN
} from "../../src/auth-config.js";
import {
  AUTH_SESSION_COOKIE_NAME
} from "../../src/server/authenticated-request.js";
import {
  createSessionRegistry
} from "../../src/server/session-registry.js";

export interface LocalMvpSession {
  userId: string;
  cookie: Cookie;
  cookieHeader: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

export async function createLocalMvpSession(
  label: string
): Promise<LocalMvpSession> {
  const appPath = requiredEnvironment(
    "LOCAL_MVP_APP_SQLITE_PATH"
  );
  const secret = requiredEnvironment("LOCAL_MVP_AUTH_SECRET");
  const nowMs = Date.now();
  const expiresAtMs =
    nowMs + AUTH_JWT_MAX_AGE_SECONDS * 1_000;
  const userId = `e2e-${label}-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const database = openAppDatabase({ path: appPath });
  try {
    database.client
      .prepare(
        `INSERT INTO user (
           user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
         ) VALUES (?, 'ACTIVE', ?, ?, NULL)`
      )
      .run(userId, nowMs, nowMs);
    createSessionRegistry(database.db, {
      now: () => nowMs
    }).register({
      userId,
      sessionId,
      authenticatedAtMs: nowMs,
      expiresAtMs
    });
  } finally {
    database.close();
  }

  const token = await encode({
    token: {
      internalUserId: userId,
      sessionId,
      authenticatedAtMs: nowMs,
      expiresAtMs,
      kakaoAccessToken: `encrypted-fixture-${randomUUID()}`
    },
    secret,
    salt: AUTH_SESSION_COOKIE_NAME,
    maxAge: AUTH_JWT_MAX_AGE_SECONDS
  });
  const cookie: Cookie = {
    name: AUTH_SESSION_COOKIE_NAME,
    value: token,
    url: AUTH_ORIGIN,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    expires: Math.floor(expiresAtMs / 1_000)
  };
  return {
    userId,
    cookie,
    cookieHeader: `${AUTH_SESSION_COOKIE_NAME}=${token}`
  };
}
