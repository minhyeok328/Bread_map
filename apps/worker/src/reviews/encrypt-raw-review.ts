import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { z } from "zod";

export interface EncryptedReviewPayloadV1 {
  schemaVersion: 1;
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  provider: "KAKAO_MAP";
}

export interface ReviewAadV1 {
  reviewId: string;
  storeId: string;
  provider: "KAKAO_MAP";
  schemaVersion: 1;
}

export interface EncryptedRawReview {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
  aadVersion: "review-aad-v1";
}

export type ReviewCryptoErrorCode =
  | "REVIEW_ENCRYPT_FAILED"
  | "REVIEW_DECRYPT_FAILED";

export class ReviewCryptoError extends Error {
  readonly code: ReviewCryptoErrorCode;

  constructor(code: ReviewCryptoErrorCode) {
    super(code);
    this.name = "ReviewCryptoError";
    this.code = code;
  }
}

const payloadSchema = z.object({
  schemaVersion: z.literal(1),
  body: z.string().min(1),
  ratingBasisPoints: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .nullable(),
  publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  provider: z.literal("KAKAO_MAP")
});

const aadSchema = z.object({
  reviewId: z.string().min(1),
  storeId: z.string().min(1),
  provider: z.literal("KAKAO_MAP"),
  schemaVersion: z.literal(1)
});

function canonicalAad(aad: ReviewAadV1): Buffer {
  const parsed = aadSchema.parse(aad);
  return Buffer.from(
    JSON.stringify({
      reviewId: parsed.reviewId,
      storeId: parsed.storeId,
      provider: parsed.provider,
      schemaVersion: parsed.schemaVersion
    }),
    "utf8"
  );
}

export function encryptRawReview(
  payload: EncryptedReviewPayloadV1,
  aad: ReviewAadV1,
  encryptionKey: Buffer,
  keyVersion: string
): EncryptedRawReview {
  try {
    if (
      encryptionKey.length !== 32 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyVersion)
    ) {
      throw new Error();
    }
    const parsedPayload = payloadSchema.parse(payload);
    const aadBytes = canonicalAad(aad);
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      encryptionKey,
      nonce,
      { authTagLength: 16 }
    );
    cipher.setAAD(aadBytes);
    const plaintext = Buffer.from(
      JSON.stringify(parsedPayload),
      "utf8"
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);

    return {
      ciphertext,
      nonce,
      authTag: cipher.getAuthTag(),
      keyVersion,
      aadVersion: "review-aad-v1"
    };
  } catch {
    throw new ReviewCryptoError("REVIEW_ENCRYPT_FAILED");
  }
}

export function decryptRawReview(
  encrypted: EncryptedRawReview,
  aad: ReviewAadV1,
  encryptionKey: Buffer
): EncryptedReviewPayloadV1 {
  try {
    if (
      encryptionKey.length !== 32 ||
      encrypted.nonce.length !== 12 ||
      encrypted.authTag.length !== 16 ||
      encrypted.ciphertext.length === 0 ||
      encrypted.aadVersion !== "review-aad-v1"
    ) {
      throw new Error();
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      encrypted.nonce,
      { authTagLength: 16 }
    );
    decipher.setAAD(canonicalAad(aad));
    decipher.setAuthTag(encrypted.authTag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final()
    ]);
    return payloadSchema.parse(
      JSON.parse(plaintext.toString("utf8"))
    );
  } catch {
    throw new ReviewCryptoError("REVIEW_DECRYPT_FAILED");
  }
}
