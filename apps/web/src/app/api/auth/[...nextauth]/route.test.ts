import { describe, expect, it, vi } from "vitest";
import {
  AUTH_ORIGIN,
  createAuthRouteHandlers
} from "../../../../server/auth-route.js";

describe("Auth.js fixed-origin route wrapper", () => {
  it("rejects localhost and does not delegate", async () => {
    const delegate = vi.fn(async () => new Response("delegated"));
    const handlers = createAuthRouteHandlers({
      GET: delegate,
      POST: delegate
    });

    const response = await handlers.GET(
      new Request("http://localhost:3000/api/auth/session")
    );

    expect(response.status).toBe(400);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("delegates only the exact fixed origin and ignores forwarded hosts", async () => {
    const delegate = vi.fn(async () => new Response("delegated"));
    const handlers = createAuthRouteHandlers({
      GET: delegate,
      POST: delegate
    });
    const request = new Request(
      `${AUTH_ORIGIN}/api/auth/callback/kakao`,
      {
        headers: {
          host: "attacker.example",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https"
        }
      }
    );

    const response = await handlers.GET(request);

    expect(response.status).toBe(200);
    expect(response.text()).resolves.toBe("delegated");
    expect(delegate).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("applies the same fixed-origin check to POST requests", async () => {
    const delegate = vi.fn(async () => new Response(null, {
      status: 204
    }));
    const handlers = createAuthRouteHandlers({
      GET: delegate,
      POST: delegate
    });

    const rejected = await handlers.POST(
      new Request("https://127.0.0.1:3000/api/auth/signout", {
        method: "POST"
      })
    );
    const accepted = await handlers.POST(
      new Request(`${AUTH_ORIGIN}/api/auth/signout`, {
        method: "POST"
      })
    );

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(204);
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  it("suppresses rolling session cookies while preserving cookie deletion", async () => {
    const delegate = vi.fn(async () => {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "authjs.session-token=refreshed-jwe; Path=/; HttpOnly; Expires=Fri, 31 Jul 2026 12:00:00 GMT"
      );
      headers.append(
        "set-cookie",
        "authjs.session-token.0=; Path=/; Max-Age=0; HttpOnly"
      );
      headers.append(
        "set-cookie",
        "authjs.callback-url=%2F; Path=/; HttpOnly"
      );
      return new Response("session", { headers });
    });
    const handlers = createAuthRouteHandlers({
      GET: delegate,
      POST: delegate
    });

    const response = await handlers.GET(
      new Request(`${AUTH_ORIGIN}/api/auth/session`)
    );

    expect(response.headers.getSetCookie()).toEqual([
      "authjs.callback-url=%2F; Path=/; HttpOnly"
    ]);

    const callbackResponse = await handlers.GET(
      new Request(`${AUTH_ORIGIN}/api/auth/callback/kakao`)
    );
    expect(callbackResponse.headers.getSetCookie()).toContain(
      "authjs.session-token=refreshed-jwe; Path=/; HttpOnly; Expires=Fri, 31 Jul 2026 12:00:00 GMT"
    );
  });

  it("preserves session-cookie deletion for invalid sessions", async () => {
    const delegate = vi.fn(async () => {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "authjs.session-token=; Path=/; Max-Age=0; HttpOnly"
      );
      return new Response(null, { headers });
    });
    const handlers = createAuthRouteHandlers({
      GET: delegate,
      POST: delegate
    });

    const response = await handlers.GET(
      new Request(`${AUTH_ORIGIN}/api/auth/session`)
    );

    expect(response.headers.getSetCookie()).toEqual([
      "authjs.session-token=; Path=/; Max-Age=0; HttpOnly"
    ]);
  });
});
