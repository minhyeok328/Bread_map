import { describe, expect, it, vi } from "vitest";
import {
  KAKAO_UNLINK_URL,
  unlinkKakaoAccount
} from "./kakao-unlink.js";

describe("Kakao unlink boundary", () => {
  it("sends the access token only in the Authorization header", async () => {
    const fetchImpl = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        void input;
        void init;
        return new Response(null, { status: 200 });
      }
    );

    await expect(
      unlinkKakaoAccount({
        accessToken: "sensitive-access-token",
        fetchImpl,
        timeoutMs: 1_000
      })
    ).resolves.toBe("UNLINKED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    if (init === undefined) {
      throw new Error("expected fetch request options");
    }
    expect(url).toBe(KAKAO_UNLINK_URL);
    expect(String(url)).not.toContain("sensitive-access-token");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer sensitive-access-token",
        "content-type": "application/x-www-form-urlencoded"
      }
    });
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns only a non-sensitive pending result on provider failure", async () => {
    const rejected = await unlinkKakaoAccount({
      accessToken: "token-a",
      fetchImpl: async () =>
        new Response('{"id":123456789}', { status: 503 })
    });
    const unavailable = await unlinkKakaoAccount({
      accessToken: "token-b",
      fetchImpl: async () => {
        throw new Error("provider response included private details");
      }
    });

    expect(rejected).toBe("PENDING_MANUAL");
    expect(unavailable).toBe("PENDING_MANUAL");
    expect(JSON.stringify({ rejected, unavailable })).not.toContain(
      "123456789"
    );
  });
});
