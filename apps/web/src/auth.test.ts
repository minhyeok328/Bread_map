import { decode, encode } from "@auth/core/jwt";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_JWT_MAX_AGE_SECONDS,
  createAuthConfig,
  mapKakaoAccount,
  mapKakaoProfile
} from "./auth-config.js";

describe("Kakao Auth.js configuration", () => {
  it("maps only the provider account ID from a full Kakao profile", () => {
    expect(
      mapKakaoProfile({
        id: 123_456_789,
        properties: {
          nickname: "Private nickname",
          profile_image: "https://example.test/private.png"
        },
        kakao_account: {
          email: "private@example.test",
          name: "Private name",
          birthday: "0730",
          birthyear: "1990",
          gender: "female",
          phone_number: "+82 10-0000-0000",
          profile: {
            nickname: "Private nickname",
            profile_image_url:
              "https://example.test/private-profile.png"
          }
        }
      })
    ).toEqual({
      id: "123456789",
      name: null,
      email: null,
      image: null
    });
  });

  it("omits every OAuth token field from the adapter account payload", () => {
    expect(
      mapKakaoAccount({
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        scope: "account_email profile_nickname",
        token_type: "bearer",
        expires_at: 1_785_430_000
      })
    ).toEqual({});
  });

  it("registers a six-hour revocable session and exposes no secret claims", async () => {
    const register = vi.fn();
    const revoke = vi.fn();
    const config = createAuthConfig({
      registry: {
        register,
        resolve: vi.fn(() => ({
          userId: "user-a",
          authenticatedAtMs: 1_000,
          expiresAtMs:
            1_000 + AUTH_JWT_MAX_AGE_SECONDS * 1_000
        })),
        revoke
      },
      now: () => 1_000,
      generateSessionId: () => "session-a",
      clientId: "test-client",
      clientSecret: "test-client-secret",
      secret: "test-auth-secret"
    });

    const token = await config.callbacks!.jwt!({
      token: {
        name: "must disappear",
        email: "private@example.test",
        picture: "https://example.test/private.png"
      },
      user: {
        id: "user-a",
        name: null,
        email: null as unknown as string,
        emailVerified: null,
        image: null
      },
      account: {
        provider: "kakao",
        providerAccountId: "provider-a",
        type: "oauth",
        access_token: "kakao-access-token"
      },
      trigger: "signIn"
    });

    expect(token).toEqual({
      internalUserId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: 1_000,
      expiresAtMs:
        1_000 + AUTH_JWT_MAX_AGE_SECONDS * 1_000,
      kakaoAccessToken: "kakao-access-token"
    });
    expect(register).toHaveBeenCalledWith({
      userId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: 1_000,
      expiresAtMs:
        1_000 + AUTH_JWT_MAX_AGE_SECONDS * 1_000
    });

    const session = await config.callbacks!.session!({
      session: {
        user: {
          name: "must disappear",
          email: "private@example.test",
          image: "https://example.test/private.png"
        },
        expires: "2026-07-31T00:00:00.000Z"
      },
      token: token!,
      user: undefined as never,
      newSession: undefined,
      trigger: undefined
    } as never);

    expect(session).toEqual({
      user: { id: "user-a" },
      expires: new Date(
        1_000 + AUTH_JWT_MAX_AGE_SECONDS * 1_000
      ).toISOString(),
      authenticatedAtMs: 1_000
    });
    expect(JSON.stringify(session)).not.toContain(
      "kakao-access-token"
    );

    const encrypted = await encode({
      token: token!,
      secret: "test-auth-secret",
      salt: "authjs.session-token",
      maxAge: AUTH_JWT_MAX_AGE_SECONDS
    });
    expect(encrypted).not.toContain("kakao-access-token");
    await expect(
      decode({
        token: encrypted,
        secret: "test-auth-secret",
        salt: "authjs.session-token"
      })
    ).resolves.toMatchObject(token!);

    await config.events!.signOut!({ token });
    expect(revoke).toHaveBeenCalledWith("session-a");
  });

  it("rejects revoked and malformed protected tokens", async () => {
    const config = createAuthConfig({
      registry: {
        register: vi.fn(),
        resolve: vi.fn(() => null),
        revoke: vi.fn()
      },
      clientId: "test-client",
      clientSecret: "test-client-secret",
      secret: "test-auth-secret"
    });

    await expect(
      config.callbacks!.jwt!({
        token: {
          internalUserId: "user-a",
          sessionId: "revoked-session",
          authenticatedAtMs: 1_000,
          expiresAtMs:
            1_000 + AUTH_JWT_MAX_AGE_SECONDS * 1_000,
          kakaoAccessToken: "access-token"
        },
        user: undefined as never
      })
    ).resolves.toBeNull();
    await expect(
      config.callbacks!.jwt!({
        token: { internalUserId: "user-a" },
        user: undefined as never
      })
    ).resolves.toBeNull();
  });
});
