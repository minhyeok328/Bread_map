import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  RECOMMENDATION_VERSION,
  SEARCH_HISTORY_FILTER_VERSION,
  type HistoryMutation
} from "@bread-map/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionRegistry } from "./session-registry.js";
import {
  createUserRepository,
  UserNotActiveError
} from "./user-repository.js";

let directory: string;
let database: AppDatabaseHandle;
let nowMs: number;

const searchHistory: HistoryMutation = {
  kind: "search",
  filters: {
    schemaVersion: SEARCH_HISTORY_FILTER_VERSION,
    areaLabel: "마포구",
    categories: [
      {
        category: "FERMENTED_BREAD",
        mode: "INCLUDE"
      }
    ],
    openNow: true,
    maxDistanceBucketM: 1_000,
    reviewEvidenceStatus: "ANY",
    sortMode: "RELEVANCE"
  },
  dataSnapshotVersion:
    `search-data-v1_${"a".repeat(64)}`,
  recommendationVersion: RECOMMENDATION_VERSION,
  resultCount: 3
};

function seedCatalogAndUsers(): void {
  database.client.exec(`
    INSERT INTO bakery (
      bakery_id, display_name, normalized_name, catalog_status,
      created_at_ms, updated_at_ms
    ) VALUES
      ('bakery-a', 'Bakery A', 'bakery a', 'published', 1, 1),
      ('bakery-b', 'Bakery B', 'bakery b', 'published', 1, 1);

    INSERT INTO store (
      store_id, bakery_id, display_name, normalized_name,
      normalized_brand_name, normalized_address, seoul_district,
      normalized_phone, latitude_e7, longitude_e7, business_status,
      catalog_status, latest_verified_at_ms, created_at_ms,
      updated_at_ms
    ) VALUES
      (
        'store-a', 'bakery-a', 'Store A', 'store a', '', 'address a',
        '마포구', NULL, 375000000, 1270000000, 'active',
        'published', 1, 1, 1
      ),
      (
        'store-b', 'bakery-b', 'Store B', 'store b', '', 'address b',
        '종로구', NULL, 375100000, 1270100000, 'active',
        'published', 1, 1, 1
      );

    INSERT INTO user (
      user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
    ) VALUES
      ('user-a', 'ACTIVE', 1, 1, NULL),
      ('user-b', 'ACTIVE', 1, 1, NULL);

    INSERT INTO account (
      account_id, user_id, type, provider, provider_account_id,
      created_at_ms
    ) VALUES
      ('account-a', 'user-a', 'oauth', 'kakao', 'provider-a', 1),
      ('account-b', 'user-b', 'oauth', 'kakao', 'provider-b', 1);
  `);
}

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-user-repository-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedCatalogAndUsers();
  nowMs = 10_000;
});

afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});

describe("ownership-scoped user repository", () => {
  it("isolates favorite lists and makes creation idempotent per user", () => {
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });

    expect(repository.addFavorite("user-a", "store-a")).toMatchObject({
      created: true,
      favorite: {
        storeId: "store-a",
        createdAtMs: 10_000
      }
    });
    expect(repository.addFavorite("user-a", "store-a")).toMatchObject({
      created: false,
      favorite: {
        storeId: "store-a",
        createdAtMs: 10_000
      }
    });
    nowMs = 10_001;
    repository.addFavorite("user-b", "store-b");

    expect(repository.listFavorites("user-a")).toEqual([
      {
        favoriteId: expect.any(String),
        storeId: "store-a",
        createdAtMs: 10_000
      }
    ]);
    expect(repository.listFavorites("user-b")).toEqual([
      {
        favoriteId: expect.any(String),
        storeId: "store-b",
        createdAtMs: 10_001
      }
    ]);
    expect(
      repository.removeFavorite("user-a", "store-b")
    ).toBe(false);
    expect(repository.listFavorites("user-b")).toHaveLength(1);
  });

  it("isolates search and selection history IDs for reads and deletes", () => {
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });
    const userASearch = repository.addHistory(
      "user-a",
      searchHistory
    );
    nowMs = 10_001;
    const userBSearch = repository.addHistory(
      "user-b",
      searchHistory
    );
    nowMs = 10_002;
    const userASelection = repository.addHistory("user-a", {
      kind: "selection",
      storeId: "store-a",
      sourceSurface: "SEARCH"
    });
    nowMs = 10_003;
    const userBSelection = repository.addHistory("user-b", {
      kind: "selection",
      storeId: "store-b",
      sourceSurface: "MAP"
    });

    expect(repository.listHistory("user-a", {
      kind: "search",
      limit: 20
    })).toEqual([userASearch]);
    expect(repository.listHistory("user-b", {
      kind: "selection",
      limit: 20
    })).toEqual([userBSelection]);

    expect(
      repository.deleteHistory("user-a", {
        kind: "search",
        historyId: userBSearch.historyId
      })
    ).toBe(false);
    expect(
      repository.deleteHistory("user-a", {
        kind: "selection",
        historyId: userBSelection.historyId
      })
    ).toBe(false);
    expect(repository.listHistory("user-b", {
      kind: "search",
      limit: 20
    })).toEqual([userBSearch]);
    expect(repository.listHistory("user-a", {
      kind: "selection",
      limit: 20
    })).toEqual([userASelection]);
  });

  it("persists only the normalized search history contract", () => {
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });

    repository.addHistory("user-a", searchHistory);

    const persisted = database.client
      .prepare(
        `SELECT display_filters_json
         FROM search_history
         WHERE user_id = 'user-a'`
      )
      .get() as { display_filters_json: string };
    expect(JSON.parse(persisted.display_filters_json)).toEqual(
      searchHistory.filters
    );
    expect(persisted.display_filters_json).not.toContain(
      "latitude"
    );
    expect(persisted.display_filters_json).not.toContain(
      "rawQuery"
    );
  });

  it("rejects mutations for a deleting user", () => {
    database.client
      .prepare(
        `UPDATE user
         SET status = 'DELETING', deleted_at_ms = 999,
           updated_at_ms = 999
         WHERE user_id = 'user-a'`
      )
      .run();
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });

    expect(() =>
      repository.addFavorite("user-a", "store-a")
    ).toThrow(UserNotActiveError);
    expect(() =>
      repository.addHistory("user-a", searchHistory)
    ).toThrow(UserNotActiveError);
  });

  it("deletes one account and all owned rows in one local transaction", () => {
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });
    repository.addFavorite("user-a", "store-a");
    repository.addHistory("user-a", searchHistory);
    repository.addHistory("user-a", {
      kind: "selection",
      storeId: "store-a",
      sourceSurface: "LIST"
    });
    createSessionRegistry(database.db, {
      now: () => nowMs
    }).register({
      userId: "user-a",
      sessionId: "session-a",
      authenticatedAtMs: nowMs,
      expiresAtMs: nowMs + 1_000
    });

    expect(repository.withdraw("user-a")).toEqual({
      provider: "kakao",
      providerAccountId: "provider-a"
    });

    for (const table of [
      "user",
      "account",
      "session",
      "favorite",
      "search_history",
      "selection_history"
    ]) {
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
             FROM ${table}
             WHERE user_id = 'user-a'`
          )
          .get()
      ).toEqual({ count: 0 });
    }
    expect(
      database.client
        .prepare(
          "SELECT count(*) AS count FROM user WHERE user_id = 'user-b'"
        )
        .get()
    ).toEqual({ count: 1 });
  });
});
