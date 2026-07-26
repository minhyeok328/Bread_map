import { describe, expect, it } from "vitest";
import {
  decryptRawReview,
  encryptRawReview,
  type EncryptedRawReview,
  type EncryptedReviewPayloadV1,
  type ReviewAadV1
} from "./encrypt-raw-review.js";

const encryptionKey = Buffer.alloc(32, 3);
const payload: EncryptedReviewPayloadV1 = {
  schemaVersion: 1,
  body: "빵이 맛있어요",
  ratingBasisPoints: 4500,
  publishedDate: "2026-07-01",
  provider: "KAKAO_MAP"
};
const aad: ReviewAadV1 = {
  reviewId: "review_fixture",
  storeId: "store_fixture",
  provider: "KAKAO_MAP",
  schemaVersion: 1
};

function cloneEncrypted(
  encrypted: EncryptedRawReview
): EncryptedRawReview {
  return {
    ...encrypted,
    ciphertext: Buffer.from(encrypted.ciphertext),
    nonce: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag)
  };
}

describe("raw review encryption", () => {
  it("uses a unique 12-byte nonce and decrypts the payload", () => {
    const first = encryptRawReview(
      payload,
      aad,
      encryptionKey,
      "key-v1"
    );
    const second = encryptRawReview(
      payload,
      aad,
      encryptionKey,
      "key-v1"
    );

    expect(first.nonce).toHaveLength(12);
    expect(first.authTag).toHaveLength(16);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(
      decryptRawReview(first, aad, encryptionKey)
    ).toEqual(payload);
    expect(Object.keys(first).sort()).toEqual([
      "aadVersion",
      "authTag",
      "ciphertext",
      "keyVersion",
      "nonce"
    ]);
    expect(JSON.stringify(first)).not.toContain(payload.body);
    expect(JSON.stringify(first)).not.toContain("nickname");
  });

  it.each(["ciphertext", "authTag", "aad", "key"] as const)(
    "rejects tampered %s with one safe code",
    (target) => {
      const encrypted = encryptRawReview(
        payload,
        aad,
        encryptionKey,
        "key-v1"
      );
      const changed = cloneEncrypted(encrypted);
      let changedAad = aad;
      let changedKey = encryptionKey;

      if (target === "ciphertext") {
        changed.ciphertext[0] =
          (changed.ciphertext[0] ?? 0) ^ 1;
      } else if (target === "authTag") {
        changed.authTag[0] = (changed.authTag[0] ?? 0) ^ 1;
      } else if (target === "aad") {
        changedAad = { ...aad, storeId: "store_other" };
      } else {
        changedKey = Buffer.alloc(32, 9);
      }

      expect(() =>
        decryptRawReview(changed, changedAad, changedKey)
      ).toThrow("REVIEW_DECRYPT_FAILED");
    }
  );
});
