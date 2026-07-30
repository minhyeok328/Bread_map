import { parseAccountWithdrawal } from "@bread-map/contracts";
import {
  apiErrorResponse,
  jsonError,
  readJsonBody,
  requireMutationOrigin
} from "./api-response.js";
import {
  AUTH_SESSION_COOKIE_NAME,
  type PrincipalResolver
} from "./authenticated-request.js";
import type { KakaoUnlinkResult } from "./kakao-unlink.js";
import type { createUserRepository } from "./user-repository.js";

export const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1_000;
const SECURE_AUTH_SESSION_COOKIE_NAME =
  `__Secure-${AUTH_SESSION_COOKIE_NAME}`;

type UserRepository = ReturnType<typeof createUserRepository>;

export interface AccountRouteDependencies {
  resolvePrincipal: PrincipalResolver;
  repository: UserRepository;
  unlink(accessToken: string): Promise<KakaoUnlinkResult>;
  now?: () => number;
}

function sessionCookieNames(request: Request): string[] {
  const names = new Set([
    AUTH_SESSION_COOKIE_NAME,
    SECURE_AUTH_SESSION_COOKIE_NAME
  ]);

  for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
    const name = pair.split("=", 1)[0]?.trim();
    if (
      name !== undefined &&
      /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(
        name
      )
    ) {
      names.add(name);
    }
  }

  return [...names];
}

function appendClearedAuthCookies(
  request: Request,
  response: Response
): Response {
  for (const name of sessionCookieNames(request)) {
    response.headers.append(
      "set-cookie",
      `${name}=; Path=/; Max-Age=0; HttpOnly;${
        name.startsWith("__Secure-") ? " Secure;" : ""
      } SameSite=Lax`
    );
  }

  return response;
}

export function createAccountRouteHandlers(
  dependencies: AccountRouteDependencies
) {
  const now = dependencies.now ?? Date.now;

  return {
    async DELETE(request: Request): Promise<Response> {
      const originFailure = requireMutationOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        parseAccountWithdrawal(await readJsonBody(request));
        const authenticationAgeMs =
          now() - principal.authenticatedAtMs;
        if (
          authenticationAgeMs < 0 ||
          authenticationAgeMs > RECENT_AUTH_MAX_AGE_MS
        ) {
          return jsonError(
            403,
            "RECENT_AUTHENTICATION_REQUIRED"
          );
        }

        const deleted = dependencies.repository.withdraw(
          principal.userId
        );
        if (deleted === null) {
          return jsonError(404, "RESOURCE_NOT_FOUND");
        }

        let providerUnlink: KakaoUnlinkResult;
        try {
          providerUnlink = await dependencies.unlink(
            principal.kakaoAccessToken
          );
        } catch {
          providerUnlink = "PENDING_MANUAL";
        }

        return appendClearedAuthCookies(
          request,
          Response.json(
            { providerUnlink },
            {
              status:
                providerUnlink === "UNLINKED" ? 200 : 202
            }
          )
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    }
  };
}
