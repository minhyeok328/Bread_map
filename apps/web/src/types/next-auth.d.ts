import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    };
    expires: DefaultSession["expires"];
    authenticatedAtMs: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    internalUserId?: string;
    sessionId?: string;
    authenticatedAtMs?: number;
    expiresAtMs?: number;
    kakaoAccessToken?: string;
  }
}
