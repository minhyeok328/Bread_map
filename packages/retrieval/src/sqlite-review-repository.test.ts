import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewQueryValidationError,
  createSqliteReviewRepository
} from "./index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createFixtureDatabase(): Promise<AppDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-retrieval-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(handle, resolve("drizzle/app"));

  for (const [storeId, name] of [
    ["store_a", "A Bakery"],
    ["store_b", "B Bakery"]
  ] as const) {
    const bakeryId = `bakery_${storeId}`;
    handle.client
      .prepare(
        `INSERT INTO bakery (
           bakery_id, display_name, normalized_name, catalog_status,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 'published', 0, 0)`
      )
      .run(bakeryId, name, name.toLocaleLowerCase("en-US"));
    handle.client
      .prepare(
        `INSERT INTO store (
           store_id, bakery_id, display_name, normalized_name,
           normalized_brand_name, normalized_address, seoul_district,
           normalized_phone, latitude_e7, longitude_e7,
           business_status, catalog_status, latest_verified_at_ms,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, '서울특별시 마포구 월드컵로 1',
           '마포구', NULL, 375634614, 1269014494, 'active',
           'published', 0, 0, 0)`
      )
      .run(
        storeId,
        bakeryId,
        name,
        name.toLocaleLowerCase("en-US"),
        name.toLocaleLowerCase("en-US")
      );
  }

  handle.client
    .prepare(
      `INSERT INTO review_publish_version (
         version_id, source_run_id, source_run_status,
         source_as_of_date, status, active_slot, document_count,
         fts_document_count, corpus_checksum, published_at_ms
       ) VALUES ('review_publish_fixture', 'run_fixture', 'SUCCEEDED',
         '2026-07-30', 'ACTIVE', 1, 3, 3, ?, 1000)`
    )
    .run("a".repeat(64));

  const insertReview = handle.client.prepare(
    `INSERT INTO review_document (
       review_id, store_id, provider, body, normalized_body,
       rating_basis_points, published_date, collected_at_ms,
       source_run_id, publish_version_id
     ) VALUES (?, ?, 'KAKAO_MAP', ?, ?, ?, ?, 1000,
       'run_fixture', 'review_publish_fixture')`
  );
  insertReview.run(
    "review_a",
    "store_a",
    "소금빵이 인기예요",
    "소금빵 인기",
    4500,
    "2026-07-20"
  );
  insertReview.run(
    "review_b",
    "store_b",
    "소금빵을 또 샀어요",
    "소금빵 인기",
    4300,
    "2026-07-20"
  );
  insertReview.run(
    "review_c",
    "store_a",
    "Croissant 향이 고소해요",
    "croissant 고소함",
    null,
    "2026-07-22"
  );

  handle.client
    .prepare(
      `INSERT INTO fts_index_state (
         state_id, index_version, publish_version_id, status,
         active_slot, document_count, corpus_checksum, built_at_ms
       ) VALUES ('fts_state_fixture', 'review-fts-unicode61-v1',
         'review_publish_fixture', 'ACTIVE', 1, 3, ?, 1000)`
    )
    .run("a".repeat(64));
  return handle;
}

describe("SQLite review repository", () => {
  it("normalizes compatibility text and returns only matching reviews", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      const result = repository.searchReviews({
        text: "  ＣＲＯＩＳＳＡＮＴ  "
      });

      expect(result).toEqual({
        status: "AVAILABLE",
        hits: [
          {
            reviewId: "review_c",
            storeId: "store_a",
            body: "Croissant 향이 고소해요",
            ratingBasisPoints: null,
            publishedDate: "2026-07-22",
            snippet: "[croissant] 고소함"
          }
        ]
      });
    } finally {
      handle.close();
    }
  });

  it("treats FTS operators as text instead of widening the query", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      const result = repository.searchReviews({
        text: '소금빵" OR croissant*'
      });

      expect(result).toEqual({
        status: "AVAILABLE",
        hits: []
      });
    } finally {
      handle.close();
    }
  });

  it("keeps store filtering narrow and resolves exact ties by review ID", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      const allStores = repository.searchReviews({
        text: "소금빵"
      });
      const storeA = repository.searchReviews({
        text: "소금빵",
        storeIds: ["store_a"]
      });

      expect(allStores.status).toBe("AVAILABLE");
      expect(
        allStores.status === "AVAILABLE"
          ? allStores.hits.map((hit) => hit.reviewId)
          : []
      ).toEqual(["review_a", "review_b"]);
      expect(storeA).toMatchObject({
        status: "AVAILABLE",
        hits: [{ reviewId: "review_a", storeId: "store_a" }]
      });
    } finally {
      handle.close();
    }
  });

  it("lists one store's public reviews in stable newest-first order", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      expect(
        repository
          .listStoreReviews({ storeId: "store_a" })
          .map((review) => review.reviewId)
      ).toEqual(["review_c", "review_a"]);
    } finally {
      handle.close();
    }
  });

  it("returns the active index state without exposing database internals", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      expect(repository.getActiveIndexState()).toEqual({
        indexVersion: "review-fts-unicode61-v1",
        publishVersionId: "review_publish_fixture",
        documentCount: 3,
        corpusChecksum: "a".repeat(64),
        builtAtMs: 1000
      });
    } finally {
      handle.close();
    }
  });

  it("returns an unavailable result when the FTS index cannot execute", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);
      handle.client.exec("DROP TABLE review_fts");

      expect(repository.searchReviews({ text: "소금빵" })).toEqual({
        status: "UNAVAILABLE",
        code: "FTS_UNAVAILABLE",
        hits: []
      });
    } finally {
      handle.close();
    }
  });

  it("returns unavailable when FTS identity no longer matches its content row", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);
      handle.client
        .prepare(
          `UPDATE review_fts
              SET store_id = 'store_b'
            WHERE review_id = 'review_a'`
        )
        .run();

      expect(repository.searchReviews({ text: "소금빵" })).toEqual({
        status: "UNAVAILABLE",
        code: "FTS_UNAVAILABLE",
        hits: []
      });
    } finally {
      handle.close();
    }
  });

  it("never returns a non-public store when the cleanup trigger is unavailable", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);
      handle.client.exec("DROP TRIGGER store_unpublish_reviews");
      handle.client
        .prepare(
          `UPDATE store
              SET catalog_status = 'excluded'
            WHERE store_id = 'store_a'`
        )
        .run();

      const search = repository.searchReviews({ text: "소금빵" });
      expect(search).toEqual({
        status: "UNAVAILABLE",
        code: "FTS_UNAVAILABLE",
        hits: []
      });
      expect(
        repository.listStoreReviews({ storeId: "store_a" })
      ).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it("rejects empty, oversized, and unbounded search inputs", async () => {
    const handle = await createFixtureDatabase();

    try {
      const repository = createSqliteReviewRepository(handle);

      expect(() => repository.searchReviews({ text: "   " })).toThrow(
        ReviewQueryValidationError
      );
      expect(() =>
        repository.searchReviews({ text: "가".repeat(201) })
      ).toThrow(ReviewQueryValidationError);
      expect(() =>
        repository.searchReviews({ text: "소금빵", limit: 0 })
      ).toThrow(ReviewQueryValidationError);
      expect(() =>
        repository.searchReviews({
          text: "소금빵",
          storeIds: []
        })
      ).toThrow(ReviewQueryValidationError);
      expect(() =>
        repository.searchReviews({
          text: "소금빵",
          storeIds: Array.from(
            { length: 101 },
            (_, index) => `store_${index}`
          )
        })
      ).toThrow(ReviewQueryValidationError);
    } finally {
      handle.close();
    }
  });
});
