import { describe, expect, it } from "vitest";
import {
  resolvePublicAuthError
} from "./auth-error.js";

describe("public OAuth failure mapping", () => {
  it("maps only recognized Auth.js failures to one stable public ID", () => {
    expect(resolvePublicAuthError("OAuthCallback")).toBe(
      "AUTH_OAUTH_FAILED"
    );
    expect(resolvePublicAuthError(["AccessDenied"])).toBe(
      "AUTH_OAUTH_FAILED"
    );
    expect(resolvePublicAuthError("unknown-provider-detail")).toBeNull();
    expect(resolvePublicAuthError(undefined)).toBeNull();
  });
});
