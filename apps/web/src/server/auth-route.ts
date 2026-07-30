import { AUTH_ORIGIN } from "../auth-config.js";

export type AuthRouteDelegate = (
  request: Request
) => Promise<Response>;

export interface AuthRouteDelegates {
  GET: AuthRouteDelegate;
  POST: AuthRouteDelegate;
}

function rejectUnexpectedOrigin(request: Request): Response | null {
  let requestOrigin: string;

  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return Response.json(
      { error: { code: "INVALID_AUTH_ORIGIN" } },
      { status: 400 }
    );
  }

  if (requestOrigin !== AUTH_ORIGIN) {
    return Response.json(
      { error: { code: "INVALID_AUTH_ORIGIN" } },
      { status: 400 }
    );
  }

  return null;
}

function readSessionCookieValue(cookie: string): string | null {
  const pair = cookie.split(";", 1)[0] ?? "";
  const separatorIndex = pair.indexOf("=");

  if (separatorIndex < 0) {
    return null;
  }

  const name = pair.slice(0, separatorIndex);
  const value = pair.slice(separatorIndex + 1);

  return /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(
    name
  )
    ? value
    : null;
}

function suppressRollingSessionCookie(
  request: Request,
  response: Response
): Response {
  if (
    new URL(request.url).pathname !== "/api/auth/session"
  ) {
    return response;
  }

  const setCookies = response.headers.getSetCookie();
  const hasRollingSessionCookie = setCookies.some(
    (cookie) => (readSessionCookieValue(cookie)?.length ?? 0) > 0
  );

  if (!hasRollingSessionCookie) {
    return response;
  }

  const retainedCookies = setCookies.filter(
    (cookie) => readSessionCookieValue(cookie) === null
  );
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of retainedCookies) {
    headers.append("set-cookie", cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function createAuthRouteHandlers(
  delegates: AuthRouteDelegates
): AuthRouteDelegates {
  return {
    async GET(request) {
      const originFailure = rejectUnexpectedOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      return suppressRollingSessionCookie(
        request,
        await delegates.GET(request)
      );
    },
    async POST(request) {
      const originFailure = rejectUnexpectedOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      return suppressRollingSessionCookie(
        request,
        await delegates.POST(request)
      );
    }
  };
}

export { AUTH_ORIGIN };
