export type PublicAuthErrorCode = "AUTH_OAUTH_FAILED";

const RECOGNIZED_AUTH_ERRORS = new Set([
  "AccessDenied",
  "Configuration",
  "Default",
  "OAuthAccountNotLinked",
  "OAuthCallback",
  "OAuthCreateAccount",
  "OAuthProfileParseError",
  "Verification"
]);

export function resolvePublicAuthError(
  error: string | string[] | undefined
): PublicAuthErrorCode | null {
  const value = Array.isArray(error) ? error[0] : error;
  return value !== undefined && RECOGNIZED_AUTH_ERRORS.has(value)
    ? "AUTH_OAUTH_FAILED"
    : null;
}
