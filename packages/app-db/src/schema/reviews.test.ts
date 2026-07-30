import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../database.js";
import { migrateAppDatabase } from "../migrate.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createMigratedDatabase() {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-schema-")
  );
  cleanupPaths.push(directory);
  const handle = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(handle, resolve("drizzle/app"));
  return handle;
}

function seedStore(
  client: ReturnType<typeof openAppDatabase>["client"],
  {
    storeId = "store_fixture",
    catalogStatus = "published"
  }: {
    storeId?: string;
    catalogStatus?: "candidate" | "published";
  } = {}
): void {
  const bakeryId = `bakery_${storeId}`;
  client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, 'Fixture Bakery', 'fixture bakery', ?, 0, 0)`
    )
    .run(bakeryId, catalogStatus);
  client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, 'Fixture Bakery', 'fixture bakery',
         'fixture bakery', '서울특별시 마포구 월드컵로 1', '마포구',
         NULL, 375634614, 1269014494, 'active', ?, 0, 0, 0)`
    )
    .run(storeId, bakeryId, catalogStatus);
}

function seedPublishVersion(
  client: ReturnType<typeof openAppDatabase>["client"],
  versionId = "review_publish_fixture"
): void {
  client
    .prepare(
      `INSERT INTO review_publish_version (
         version_id, source_run_id, source_run_status,
         source_as_of_date, status, active_slot, document_count,
         fts_document_count, corpus_checksum, published_at_ms
       ) VALUES (?, ?, 'SUCCEEDED', '2026-07-30', 'ACTIVE', 1,
         0, 0, ?, 0)`
    )
    .run(versionId, `run_${versionId}`, "0".repeat(64));
}

function insertReview(
  client: ReturnType<typeof openAppDatabase>["client"],
  overrides: {
    reviewId?: string;
    storeId?: string;
    provider?: string;
    ratingBasisPoints?: number | null;
    publishedDate?: string;
  } = {}
): void {
  client
    .prepare(
      `INSERT INTO review_document (
         review_id, store_id, provider, body, normalized_body,
         rating_basis_points, published_date, collected_at_ms,
         source_run_id, publish_version_id
       ) VALUES (?, ?, ?, '소금빵이 바삭해요', '소금빵 바삭함', ?,
         ?, 1000, 'run_review_publish_fixture',
         'review_publish_fixture')`
    )
    .run(
      overrides.reviewId ?? "review_fixture",
      overrides.storeId ?? "store_fixture",
      overrides.provider ?? "KAKAO_MAP",
      overrides.ratingBasisPoints === undefined
        ? 4500
        : overrides.ratingBasisPoints,
      overrides.publishedDate ?? "2026-07-01"
    );
}

describe("public review and FTS schema", () => {
  it("creates versioned review tables, FTS5, and consistency triggers idempotently", async () => {
    const handle = await createMigratedDatabase();

    try {
      migrateAppDatabase(handle, resolve("drizzle/app"));

      const tableNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "review_publish_version",
          "review_document",
          "fts_index_state",
          "review_fts"
        ])
      );

      const triggerNames = handle.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(triggerNames).toEqual(
        expect.arrayContaining([
          "review_document_fts_insert",
          "review_document_fts_update",
          "review_document_fts_delete",
          "review_document_public_store_insert",
          "review_document_public_store_update",
          "store_unpublish_reviews"
        ])
      );
    } finally {
      handle.close();
    }
  });

  it("keeps FTS content identical across review insert, update, and delete", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedStore(handle.client);
      seedPublishVersion(handle.client);
      insertReview(handle.client);

      expect(
        handle.client
          .prepare(
            `SELECT
               review_id AS reviewId,
               store_id AS storeId,
               normalized_body AS normalizedBody
             FROM review_fts`
          )
          .all()
      ).toEqual([
        {
          reviewId: "review_fixture",
          storeId: "store_fixture",
          normalizedBody: "소금빵 바삭함"
        }
      ]);

      handle.client
        .prepare(
          `UPDATE review_document
              SET body = '크루아상이 고소해요',
                  normalized_body = '크루아상 고소함'
            WHERE review_id = 'review_fixture'`
        )
        .run();
      expect(
        handle.client
          .prepare(
            `SELECT normalized_body AS normalizedBody
               FROM review_fts
              WHERE review_id = 'review_fixture'`
          )
          .get()
      ).toEqual({ normalizedBody: "크루아상 고소함" });

      handle.client
        .prepare(
          "DELETE FROM review_document WHERE review_id = 'review_fixture'"
        )
        .run();
      expect(
        handle.client
          .prepare("SELECT count(*) AS count FROM review_fts")
          .get()
      ).toEqual({ count: 0 });
    } finally {
      handle.close();
    }
  });

  it("rejects invalid public review fields and non-public stores", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedStore(handle.client);
      seedStore(handle.client, {
        storeId: "store_candidate",
        catalogStatus: "candidate"
      });
      seedPublishVersion(handle.client);

      expect(() =>
        insertReview(handle.client, {
          reviewId: "review_bad_provider",
          provider: "OTHER"
        })
      ).toThrow();
      expect(() =>
        insertReview(handle.client, {
          reviewId: "review_bad_rating",
          ratingBasisPoints: 5001
        })
      ).toThrow();
      expect(() =>
        insertReview(handle.client, {
          reviewId: "review_bad_date",
          publishedDate: "2026/07/01"
        })
      ).toThrow();
      expect(() =>
        insertReview(handle.client, {
          reviewId: "review_missing_store",
          storeId: "store_missing"
        })
      ).toThrow();
      expect(() =>
        insertReview(handle.client, {
          reviewId: "review_candidate_store",
          storeId: "store_candidate"
        })
      ).toThrow();
    } finally {
      handle.close();
    }
  });

  it("removes public review and FTS rows when a store is unpublished", async () => {
    const handle = await createMigratedDatabase();

    try {
      seedStore(handle.client);
      seedPublishVersion(handle.client);
      insertReview(handle.client);

      handle.client
        .prepare(
          `UPDATE store
              SET catalog_status = 'excluded',
                  updated_at_ms = 1
            WHERE store_id = 'store_fixture'`
        )
        .run();

      expect(
        handle.client
          .prepare("SELECT count(*) AS count FROM review_document")
          .get()
      ).toEqual({ count: 0 });
      expect(
        handle.client
          .prepare("SELECT count(*) AS count FROM review_fts")
          .get()
      ).toEqual({ count: 0 });
    } finally {
      handle.close();
    }
  });
});
