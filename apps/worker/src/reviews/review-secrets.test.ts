import { describe, expect, it } from "vitest";
import { loadReviewSecrets } from "./review-secrets.js";

const encryptionKey = Buffer.alloc(32, 1).toString("base64");
const hmacKey = Buffer.alloc(32, 2).toString("base64");

describe("review secrets", () => {
  it.each([
    {},
    {
      REVIEW_ENCRYPTION_KEY_BASE64: "***",
      REVIEW_HMAC_KEY_BASE64: hmacKey,
      REVIEW_KEY_VERSION: "key-v1"
    },
    {
      REVIEW_ENCRYPTION_KEY_BASE64: Buffer.alloc(31).toString(
        "base64"
      ),
      REVIEW_HMAC_KEY_BASE64: hmacKey,
      REVIEW_KEY_VERSION: "key-v1"
    },
    {
      REVIEW_ENCRYPTION_KEY_BASE64: encryptionKey,
      REVIEW_HMAC_KEY_BASE64: encryptionKey,
      REVIEW_KEY_VERSION: "key-v1"
    }
  ])("rejects missing, malformed, short or equal keys", (env) => {
    expect(() => loadReviewSecrets(env)).toThrow(
      "REVIEW_SECRET_INVALID"
    );
  });

  it("loads two separate 32-byte keys and a non-sensitive version", () => {
    const result = loadReviewSecrets({
      REVIEW_ENCRYPTION_KEY_BASE64: encryptionKey,
      REVIEW_HMAC_KEY_BASE64: hmacKey,
      REVIEW_KEY_VERSION: "key-v1"
    });

    expect(result.encryptionKey).toEqual(Buffer.alloc(32, 1));
    expect(result.hmacKey).toEqual(Buffer.alloc(32, 2));
    expect(result.keyVersion).toBe("key-v1");
  });
});
