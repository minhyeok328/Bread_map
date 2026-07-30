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
import { AUTH_ORIGIN } from "../../../auth-config.js";
import { createUserRepository } from "../../../server/user-repository.js";
import { createHistoryRouteHandlers } from "../../../server/history-route.js";

let directory: string;
let database: AppDatabaseHandle;

type SearchHistoryMutation = Extract<
  HistoryMutation,
  { kind: "search" }
>;

function seedData(): void {
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
  `);
}

function searchPayload(): SearchHistoryMutation {
  return {
    kind: "search" as const,
    filters: {
      schemaVersion: SEARCH_HISTORY_FILTER_VERSION,
      areaLabel: "마포구",
      categories: [],
      openNow: false,
      maxDistanceBucketM: null,
      reviewEvidenceStatus: "ANY" as const,
      sortMode: "RELEVANCE" as const
    },
    dataSnapshotVersion:
      `search-data-v1_${"b".repeat(64)}`,
    recommendationVersion: RECOMMENDATION_VERSION,
    resultCount: 2
  };
}

function principal(userId: string) {
  return {
    userId,
    sessionId: `session-${userId}`,
    authenticatedAtMs: 1,
    kakaoAccessToken: "never-return-this"
  };
}

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-history-route-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedData();
});

afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});

describe("/api/history", () => {
  it("returns 401 without a protected principal", async () => {
    const handlers = createHistoryRouteHandlers({
      resolvePrincipal: async () => null,
      repository: createUserRepository(database.db)
    });

    expect(
      (
        await handlers.GET(
          new Request(
            `${AUTH_ORIGIN}/api/history?kind=search&limit=20`
          )
        )
      ).status
    ).toBe(401);
  });

  it("creates and lists only the requested user's normalized history", async () => {
    const repository = createUserRepository(database.db, {
      now: () => 8_000
    });
    repository.addHistory("user-b", searchPayload());
    const handlers = createHistoryRouteHandlers({
      resolvePrincipal: async () => principal("user-a"),
      repository
    });
    const created = await handlers.POST(
      new Request(`${AUTH_ORIGIN}/api/history`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: AUTH_ORIGIN
        },
        body: JSON.stringify(searchPayload())
      })
    );

    expect(created.status).toBe(201);
    const listed = await handlers.GET(
      new Request(
        `${AUTH_ORIGIN}/api/history?kind=search&limit=20`
      )
    );
    expect(listed.status).toBe(200);
    const payload = await listed.json();
    expect(payload.histories).toHaveLength(1);
    expect(payload.histories[0]).toMatchObject({
      kind: "search",
      filters: searchPayload().filters,
      createdAtMs: 8_000
    });
    expect(JSON.stringify(payload)).not.toContain(
      "never-return-this"
    );
  });

  it("returns 404 without revealing a foreign history ID", async () => {
    const repository = createUserRepository(database.db);
    const foreign = repository.addHistory("user-b", {
      kind: "selection",
      storeId: "store-b",
      sourceSurface: "MAP"
    });
    const handlers = createHistoryRouteHandlers({
      resolvePrincipal: async () => principal("user-a"),
      repository
    });
    const remove = (historyId: string) =>
      handlers.DELETE(
        new Request(`${AUTH_ORIGIN}/api/history`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN
          },
          body: JSON.stringify({
            kind: "selection",
            historyId
          })
        })
      );

    expect((await remove(foreign.historyId)).status).toBe(404);
    expect((await remove("missing-history")).status).toBe(404);
    expect(
      repository.listHistory("user-b", {
        kind: "selection",
        limit: 20
      })
    ).toHaveLength(1);
  });

  it("rejects missing Origin, raw text, exact coordinates, and unknown queries", async () => {
    const handlers = createHistoryRouteHandlers({
      resolvePrincipal: async () => principal("user-a"),
      repository: createUserRepository(database.db)
    });
    const post = (body: unknown, origin?: string) =>
      handlers.POST(
        new Request(`${AUTH_ORIGIN}/api/history`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(origin === undefined ? {} : { origin })
          },
          body: JSON.stringify(body)
        })
      );

    expect((await post(searchPayload())).status).toBe(403);
    expect(
      (
        await post(
          {
            ...searchPayload(),
            rawQuery: "allergy free"
          },
          AUTH_ORIGIN
        )
      ).status
    ).toBe(400);
    expect(
      (
        await post(
          {
            ...searchPayload(),
            filters: {
              ...searchPayload().filters,
              latitudeE7: 375634614
            }
          },
          AUTH_ORIGIN
        )
      ).status
    ).toBe(400);
    expect(
      (
        await handlers.GET(
          new Request(
            `${AUTH_ORIGIN}/api/history?kind=search&limit=20&userId=user-b`
          )
        )
      ).status
    ).toBe(400);
  });
});
