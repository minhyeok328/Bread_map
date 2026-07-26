import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { kakaoPlaceObservations } from "./kakao-discovery.js";
import { reviewCollectionRuns } from "./review-runs.js";

export const rawReviewCiphertexts = sqliteTable(
  "raw_review_ciphertext",
  {
    reviewId: text("review_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reviewCollectionRuns.runId, {
        onDelete: "cascade"
      }),
    observationId: text("observation_id")
      .notNull()
      .references(() => kakaoPlaceObservations.observationId, {
        onDelete: "restrict"
      }),
    storeId: text("store_id").notNull(),
    provider: text("provider").notNull(),
    ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
    nonce: blob("nonce", { mode: "buffer" }).notNull(),
    authTag: blob("auth_tag", { mode: "buffer" }).notNull(),
    keyVersion: text("key_version").notNull(),
    aadVersion: text("aad_version").notNull(),
    fingerprint: blob("fingerprint", { mode: "buffer" }).notNull(),
    collectedAtMs: integer("collected_at_ms").notNull(),
    retentionUntilMs: integer("retention_until_ms").notNull()
  },
  (table) => [
    uniqueIndex("raw_review_store_provider_fingerprint_unique").on(
      table.storeId,
      table.provider,
      table.fingerprint
    ),
    uniqueIndex("raw_review_key_nonce_unique").on(
      table.keyVersion,
      table.nonce
    ),
    index("raw_review_run_store_idx").on(table.runId, table.storeId),
    index("raw_review_retention_idx").on(table.retentionUntilMs),
    check(
      "raw_review_provider_allowed",
      sql`${table.provider} = 'KAKAO_MAP'`
    ),
    check(
      "raw_review_ciphertext_nonempty",
      sql`length(${table.ciphertext}) > 0`
    ),
    check(
      "raw_review_nonce_length",
      sql`length(${table.nonce}) = 12`
    ),
    check(
      "raw_review_auth_tag_length",
      sql`length(${table.authTag}) = 16`
    ),
    check(
      "raw_review_fingerprint_length",
      sql`length(${table.fingerprint}) = 32`
    ),
    check(
      "raw_review_retention_positive",
      sql`${table.retentionUntilMs} > ${table.collectedAtMs}`
    ),
    check(
      "raw_review_retention_max",
      sql`${table.retentionUntilMs}
        <= ${table.collectedAtMs} + 2592000000`
    )
  ]
);
