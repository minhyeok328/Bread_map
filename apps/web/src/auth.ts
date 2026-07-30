import NextAuth from "next-auth";
import {
  authConfig,
  enforceFixedAuthUrl
} from "./auth-config.js";

enforceFixedAuthUrl();

export const { handlers, auth, signIn, signOut } =
  NextAuth(authConfig);
export * from "./auth-config.js";
