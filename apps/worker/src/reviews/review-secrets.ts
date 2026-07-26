import { timingSafeEqual } from "node:crypto";

export interface ReviewSecrets {
  encryptionKey: Buffer;
  hmacKey: Buffer;
  keyVersion: string;
}

export class ReviewSecretError extends Error {
  readonly code = "REVIEW_SECRET_INVALID";

  constructor() {
    super("REVIEW_SECRET_INVALID");
    this.name = "ReviewSecretError";
  }
}

const strictBase64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function decodeKey(value: string | undefined): Buffer {
  const normalized = value?.trim() ?? "";
  if (
    normalized === "" ||
    !strictBase64Pattern.test(normalized)
  ) {
    throw new ReviewSecretError();
  }
  const decoded = Buffer.from(normalized, "base64");
  if (
    decoded.length !== 32 ||
    decoded.toString("base64") !== normalized
  ) {
    throw new ReviewSecretError();
  }
  return decoded;
}

export function loadReviewSecrets(
  env: Record<string, string | undefined>
): ReviewSecrets {
  const encryptionKey = decodeKey(
    env.REVIEW_ENCRYPTION_KEY_BASE64
  );
  const hmacKey = decodeKey(env.REVIEW_HMAC_KEY_BASE64);
  const keyVersion = env.REVIEW_KEY_VERSION?.trim() ?? "";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyVersion) ||
    timingSafeEqual(encryptionKey, hmacKey)
  ) {
    throw new ReviewSecretError();
  }
  return { encryptionKey, hmacKey, keyVersion };
}
