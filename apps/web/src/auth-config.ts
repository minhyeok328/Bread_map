import { randomUUID } from "node:crypto";
import type { Adapter } from "@auth/core/adapters";
import type { JWT } from "@auth/core/jwt";
import type { KakaoProfile } from "@auth/core/providers/kakao";
import Kakao from "@auth/core/providers/kakao";
import type { NextAuthConfig } from "next-auth";
import {
  createLazyMinimalAuthAdapter
} from "./server/auth-adapter.js";
import { getAppDatabase } from "./server/app-database.js";
import {
  createSessionRegistry,
  type RegisteredSession
} from "./server/session-registry.js";

export const AUTH_ORIGIN = "http://127.0.0.1:3000";
export const AUTH_CALLBACK_URL =
  `${AUTH_ORIGIN}/api/auth/callback/kakao`;
export const AUTH_JWT_MAX_AGE_SECONDS = 6 * 60 * 60;

interface SessionRegistry {
  register(session: RegisteredSession): void;
  resolve(sessionId: string): Omit<
    RegisteredSession,
    "sessionId"
  > | null;
  revoke(sessionId: string): void;
}

export interface AuthConfigDependencies {
  registry?: SessionRegistry;
  adapter?: Adapter;
  getDatabase?: typeof getAppDatabase;
  now?: () => number;
  generateSessionId?: () => string;
  clientId?: string;
  clientSecret?: string;
  secret?: string;
}

export interface ProtectedAuthClaims extends JWT {
  internalUserId: string;
  sessionId: string;
  authenticatedAtMs: number;
  expiresAtMs: number;
  kakaoAccessToken: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function readProtectedAuthClaims(
  token: JWT | null | undefined
): ProtectedAuthClaims | null {
  if (
    !token ||
    !isNonEmptyString(token.internalUserId) ||
    !isNonEmptyString(token.sessionId) ||
    typeof token.authenticatedAtMs !== "number" ||
    !Number.isSafeInteger(token.authenticatedAtMs) ||
    typeof token.expiresAtMs !== "number" ||
    !Number.isSafeInteger(token.expiresAtMs) ||
    token.expiresAtMs <= token.authenticatedAtMs ||
    !isNonEmptyString(token.kakaoAccessToken)
  ) {
    return null;
  }

  return {
    internalUserId: token.internalUserId,
    sessionId: token.sessionId,
    authenticatedAtMs: token.authenticatedAtMs,
    expiresAtMs: token.expiresAtMs,
    kakaoAccessToken: token.kakaoAccessToken
  };
}

export function mapKakaoProfile(
  profile: KakaoProfile
): {
  id: string;
  name: null;
  email: null;
  image: null;
} {
  return {
    id: String(profile.id),
    name: null,
    email: null,
    image: null
  };
}

export function mapKakaoAccount(
  tokens: Record<string, unknown>
): Record<string, never> {
  void tokens;
  return {};
}

export function enforceFixedAuthUrl(
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (
    environment.AUTH_URL !== undefined &&
    environment.AUTH_URL !== "" &&
    environment.AUTH_URL !== AUTH_ORIGIN
  ) {
    throw new Error(
      `AUTH_URL must be exactly ${AUTH_ORIGIN}`
    );
  }

  environment.AUTH_URL = AUTH_ORIGIN;
}

export function createAuthConfig(
  dependencies: AuthConfigDependencies = {}
): NextAuthConfig {
  const getDatabase =
    dependencies.getDatabase ?? getAppDatabase;
  const now = dependencies.now ?? Date.now;
  const generateSessionId =
    dependencies.generateSessionId ?? randomUUID;
  const registry: SessionRegistry =
    dependencies.registry ?? {
      register(session) {
        createSessionRegistry(getDatabase().db, { now }).register(
          session
        );
      },
      resolve(sessionId) {
        return createSessionRegistry(
          getDatabase().db,
          { now }
        ).resolve(sessionId);
      },
      revoke(sessionId) {
        createSessionRegistry(getDatabase().db, { now }).revoke(
          sessionId
        );
      }
    };
  const secret = dependencies.secret ?? process.env.AUTH_SECRET;

  return {
    ...(secret === undefined || secret === ""
      ? {}
      : { secret }),
    trustHost: true,
    adapter:
      dependencies.adapter ??
      createLazyMinimalAuthAdapter(() => getDatabase().db),
    providers: [
      Kakao({
        clientId:
          dependencies.clientId ??
          process.env.KAKAO_CLIENT_ID ??
          "",
        clientSecret:
          dependencies.clientSecret ??
          process.env.KAKAO_CLIENT_SECRET ??
          "",
        profile: mapKakaoProfile,
        account: mapKakaoAccount
      })
    ],
    pages: {
      error: "/"
    },
    session: {
      strategy: "jwt",
      maxAge: AUTH_JWT_MAX_AGE_SECONDS
    },
    jwt: {
      maxAge: AUTH_JWT_MAX_AGE_SECONDS
    },
    callbacks: {
      async redirect({ url }) {
        const destination = new URL(url, AUTH_ORIGIN);

        return destination.origin === AUTH_ORIGIN
          ? destination.toString()
          : AUTH_ORIGIN;
      },
      async jwt({ token, user, account }) {
        if (account !== undefined && account !== null) {
          if (
            account.provider !== "kakao" ||
            !isNonEmptyString(user?.id) ||
            !isNonEmptyString(account.access_token)
          ) {
            return null;
          }

          const authenticatedAtMs = now();
          const expiresAtMs =
            authenticatedAtMs +
            AUTH_JWT_MAX_AGE_SECONDS * 1_000;
          const sessionId = generateSessionId();
          const claims: ProtectedAuthClaims = {
            internalUserId: user.id,
            sessionId,
            authenticatedAtMs,
            expiresAtMs,
            kakaoAccessToken: account.access_token
          };

          registry.register({
            userId: user.id,
            sessionId,
            authenticatedAtMs,
            expiresAtMs
          });

          return claims;
        }

        const claims = readProtectedAuthClaims(token);

        if (claims === null) {
          return null;
        }

        const registered = registry.resolve(claims.sessionId);

        if (
          registered === null ||
          registered.userId !== claims.internalUserId ||
          registered.authenticatedAtMs !==
            claims.authenticatedAtMs ||
          registered.expiresAtMs !== claims.expiresAtMs
        ) {
          return null;
        }

        return claims;
      },
      async session({ token }) {
        const claims = readProtectedAuthClaims(token);

        if (claims === null) {
          throw new Error("invalid protected session");
        }

        return {
          user: {
            id: claims.internalUserId
          },
          expires: new Date(claims.expiresAtMs).toISOString(),
          authenticatedAtMs: claims.authenticatedAtMs
        };
      }
    },
    events: {
      async signOut(message) {
        if (!("token" in message)) {
          return;
        }

        const claims = readProtectedAuthClaims(message.token);

        if (claims !== null) {
          registry.revoke(claims.sessionId);
        }
      }
    }
  };
}

export const authConfig = createAuthConfig();
