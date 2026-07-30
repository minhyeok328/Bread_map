import { getToken } from "@auth/core/jwt";
import {
  readProtectedAuthClaims
} from "../auth-config.js";
import { getAppDatabase } from "./app-database.js";
import { createSessionRegistry } from "./session-registry.js";

export const AUTH_SESSION_COOKIE_NAME =
  "authjs.session-token";

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  authenticatedAtMs: number;
  kakaoAccessToken: string;
}

interface PrincipalSessionRegistry {
  resolve(sessionId: string): {
    userId: string;
    authenticatedAtMs: number;
    expiresAtMs: number;
  } | null;
}

export interface AuthenticatedRequestDependencies {
  secret: string;
  registry: PrincipalSessionRegistry;
}

export type PrincipalResolver = (
  request: Request
) => Promise<AuthenticatedPrincipal | null>;

export function createAuthenticatedRequestResolver(
  dependencies: AuthenticatedRequestDependencies
): PrincipalResolver {
  return async (request) => {
    if (dependencies.secret.length === 0) {
      return null;
    }

    const cookie = request.headers.get("cookie");
    if (cookie === null) {
      return null;
    }

    const token = await getToken({
      req: {
        headers: new Headers({ cookie })
      },
      secret: dependencies.secret,
      salt: AUTH_SESSION_COOKIE_NAME,
      cookieName: AUTH_SESSION_COOKIE_NAME,
      secureCookie: false
    });
    const claims = readProtectedAuthClaims(token);

    if (claims === null) {
      return null;
    }

    const registered = dependencies.registry.resolve(
      claims.sessionId
    );
    if (
      registered === null ||
      registered.userId !== claims.internalUserId ||
      registered.authenticatedAtMs !== claims.authenticatedAtMs ||
      registered.expiresAtMs !== claims.expiresAtMs
    ) {
      return null;
    }

    return {
      userId: claims.internalUserId,
      sessionId: claims.sessionId,
      authenticatedAtMs: claims.authenticatedAtMs,
      kakaoAccessToken: claims.kakaoAccessToken
    };
  };
}

export const resolveAuthenticatedPrincipal: PrincipalResolver =
  async (request) => {
    const secret = process.env.AUTH_SECRET;

    if (secret === undefined || secret.length === 0) {
      return null;
    }

    return createAuthenticatedRequestResolver({
      secret,
      registry: {
        resolve(sessionId) {
          return createSessionRegistry(
            getAppDatabase().db
          ).resolve(sessionId);
        }
      }
    })(request);
  };
