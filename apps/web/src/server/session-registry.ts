import { createHash, randomUUID } from "node:crypto";
import {
  sessions,
  users,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { eq, lte } from "drizzle-orm";

type AppDatabase = AppDatabaseHandle["db"];

export interface RegisteredSession {
  sessionId: string;
  userId: string;
  authenticatedAtMs: number;
  expiresAtMs: number;
}

export interface SessionRegistryOptions {
  now?: () => number;
}

export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function createSessionRegistry(
  database: AppDatabase,
  options: SessionRegistryOptions = {}
) {
  const now = options.now ?? Date.now;

  return {
    register(session: RegisteredSession): void {
      if (session.expiresAtMs <= now()) {
        throw new Error("future session expiry required");
      }

      const user = database
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, session.userId))
        .get();

      if (user?.status !== "ACTIVE") {
        throw new Error("active user required");
      }

      database
        .insert(sessions)
        .values({
          sessionId: randomUUID(),
          userId: session.userId,
          sessionToken: hashSessionId(session.sessionId),
          authenticatedAtMs: session.authenticatedAtMs,
          expires: new Date(session.expiresAtMs),
          createdAtMs: now()
        })
        .run();
    },
    resolve(sessionId: string): Omit<
      RegisteredSession,
      "sessionId"
    > | null {
      const currentTimeMs = now();
      database
        .delete(sessions)
        .where(lte(sessions.expires, new Date(currentTimeMs)))
        .run();

      const sessionToken = hashSessionId(sessionId);
      const row = database
        .select({
          userId: sessions.userId,
          authenticatedAtMs: sessions.authenticatedAtMs,
          expires: sessions.expires,
          userStatus: users.status
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.sessionToken, sessionToken))
        .get();

      if (row === undefined) {
        return null;
      }

      const expiresAtMs = row.expires.getTime();

      if (row.userStatus !== "ACTIVE") {
        return null;
      }

      return {
        userId: row.userId,
        authenticatedAtMs: row.authenticatedAtMs,
        expiresAtMs
      };
    },
    revoke(sessionId: string): void {
      database
        .delete(sessions)
        .where(eq(sessions.sessionToken, hashSessionId(sessionId)))
        .run();
    },
    revokeAllForUser(userId: string): void {
      database
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .run();
    },
    cleanupExpired(): void {
      database
        .delete(sessions)
        .where(lte(sessions.expires, new Date(now())))
        .run();
    }
  };
}
