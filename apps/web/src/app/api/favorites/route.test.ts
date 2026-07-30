import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_ORIGIN } from "../../../auth-config.js";
import { createUserRepository } from "../../../server/user-repository.js";
import { createFavoriteRouteHandlers } from "../../../server/favorite-route.js";

let directory: string;
let database: AppDatabaseHandle;

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

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-favorites-route-")
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

describe("/api/favorites", () => {
  it("returns 401 without a protected principal", async () => {
    const handlers = createFavoriteRouteHandlers({
      resolvePrincipal: async () => null,
      repository: createUserRepository(database.db)
    });

    const response = await handlers.GET(
      new Request(`${AUTH_ORIGIN}/api/favorites`)
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" }
    });
  });

  it("creates idempotently and lists only the authenticated user's rows", async () => {
    const repository = createUserRepository(database.db, {
      now: () => 5_000
    });
    repository.addFavorite("user-b", "store-b");
    const handlers = createFavoriteRouteHandlers({
      resolvePrincipal: async () => ({
        userId: "user-a",
        sessionId: "session-a",
        authenticatedAtMs: 1,
        kakaoAccessToken: "never-return-this"
      }),
      repository
    });
    const request = () =>
      new Request(`${AUTH_ORIGIN}/api/favorites`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: AUTH_ORIGIN
        },
        body: JSON.stringify({ storeId: "store-a" })
      });

    expect((await handlers.POST(request())).status).toBe(201);
    expect((await handlers.POST(request())).status).toBe(200);

    const response = await handlers.GET(
      new Request(`${AUTH_ORIGIN}/api/favorites`)
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      favorites: [
        {
          favoriteId: expect.any(String),
          storeId: "store-a",
          createdAtMs: 5_000
        }
      ]
    });
  });

  it("returns the same 404 for missing and foreign favorites", async () => {
    const repository = createUserRepository(database.db);
    repository.addFavorite("user-b", "store-b");
    const handlers = createFavoriteRouteHandlers({
      resolvePrincipal: async () => ({
        userId: "user-a",
        sessionId: "session-a",
        authenticatedAtMs: 1,
        kakaoAccessToken: "token"
      }),
      repository
    });
    const remove = (storeId: string) =>
      handlers.DELETE(
        new Request(`${AUTH_ORIGIN}/api/favorites`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN
          },
          body: JSON.stringify({ storeId })
        })
      );

    expect((await remove("store-b")).status).toBe(404);
    expect((await remove("missing-store")).status).toBe(404);
    expect(repository.listFavorites("user-b")).toHaveLength(1);
  });

  it("checks exact Origin before parsing a mutation body", async () => {
    const handlers = createFavoriteRouteHandlers({
      resolvePrincipal: async () => ({
        userId: "user-a",
        sessionId: "session-a",
        authenticatedAtMs: 1,
        kakaoAccessToken: "token"
      }),
      repository: createUserRepository(database.db)
    });
    const missingOrigin = await handlers.POST(
      new Request(`${AUTH_ORIGIN}/api/favorites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json"
      })
    );
    const invalidBody = await handlers.POST(
      new Request(`${AUTH_ORIGIN}/api/favorites`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: AUTH_ORIGIN
        },
        body: JSON.stringify({
          storeId: "store-a",
          userId: "user-b"
        })
      })
    );

    expect(missingOrigin.status).toBe(403);
    expect(invalidBody.status).toBe(400);
  });
});
