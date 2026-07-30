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
  SEARCH_HISTORY_FILTER_VERSION
} from "@bread-map/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ORIGIN } from "../../../auth-config.js";
import { createSessionRegistry } from "../../../server/session-registry.js";
import { createUserRepository } from "../../../server/user-repository.js";
import { createAccountRouteHandlers } from "../../../server/account-route.js";

let directory: string;
let database: AppDatabaseHandle;
let nowMs: number;

function seedOwnedData(): void {
  database.client.exec(`
    INSERT INTO bakery (
      bakery_id, display_name, normalized_name, catalog_status,
      created_at_ms, updated_at_ms
    ) VALUES ('bakery-a', 'Bakery A', 'bakery a', 'published', 1, 1);
    INSERT INTO store (
      store_id, bakery_id, display_name, normalized_name,
      normalized_brand_name, normalized_address, seoul_district,
      normalized_phone, latitude_e7, longitude_e7, business_status,
      catalog_status, latest_verified_at_ms, created_at_ms,
      updated_at_ms
    ) VALUES (
      'store-a', 'bakery-a', 'Store A', 'store a', '', 'address a',
      '마포구', NULL, 375000000, 1270000000, 'active',
      'published', 1, 1, 1
    );
    INSERT INTO user (
      user_id, status, created_at_ms, updated_at_ms, deleted_at_ms
    ) VALUES ('user-a', 'ACTIVE', 1, 1, NULL);
    INSERT INTO account (
      account_id, user_id, type, provider, provider_account_id,
      created_at_ms
    ) VALUES (
      'account-a', 'user-a', 'oauth', 'kakao', 'provider-private-a', 1
    );
  `);
  const repository = createUserRepository(database.db, {
    now: () => nowMs
  });
  repository.addFavorite("user-a", "store-a");
  repository.addHistory("user-a", {
    kind: "search",
    filters: {
      schemaVersion: SEARCH_HISTORY_FILTER_VERSION,
      areaLabel: "마포구",
      categories: [],
      openNow: false,
      maxDistanceBucketM: null,
      reviewEvidenceStatus: "ANY",
      sortMode: "RELEVANCE"
    },
    dataSnapshotVersion:
      `search-data-v1_${"c".repeat(64)}`,
    recommendationVersion: RECOMMENDATION_VERSION,
    resultCount: 1
  });
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
    expiresAtMs: nowMs + 60_000
  });
}

function principal(authenticatedAtMs = nowMs) {
  return {
    userId: "user-a",
    sessionId: "session-a",
    authenticatedAtMs,
    kakaoAccessToken: "sensitive-access-token"
  };
}

function withdrawalRequest(cookie?: string): Request {
  return new Request(`${AUTH_ORIGIN}/api/account`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: AUTH_ORIGIN,
      ...(cookie === undefined ? {} : { cookie })
    },
    body: JSON.stringify({
      confirmation: "DELETE_MY_ACCOUNT"
    })
  });
}

function ownedRowCounts(): Record<string, number> {
  return Object.fromEntries(
    [
      "user",
      "account",
      "session",
      "favorite",
      "search_history",
      "selection_history"
    ].map((table) => [
      table,
      (
        database.client
          .prepare(
            `SELECT count(*) AS count
             FROM ${table}
             WHERE user_id = 'user-a'`
          )
          .get() as { count: number }
      ).count
    ])
  );
}

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-account-route-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  nowMs = 20_000;
  seedOwnedData();
});

afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});

describe("/api/account withdrawal", () => {
  it("commits local deletion before a successful provider unlink", async () => {
    const unlink = vi.fn(async () => {
      expect(ownedRowCounts()).toEqual({
        user: 0,
        account: 0,
        session: 0,
        favorite: 0,
        search_history: 0,
        selection_history: 0
      });
      return "UNLINKED" as const;
    });
    const handlers = createAccountRouteHandlers({
      resolvePrincipal: async () => principal(),
      repository: createUserRepository(database.db, {
        now: () => nowMs
      }),
      unlink,
      now: () => nowMs
    });

    const response = await handlers.DELETE(
      withdrawalRequest(
        "authjs.session-token.0=part-a; authjs.session-token.1=part-b"
      )
    );

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      providerUnlink: "UNLINKED"
    });
    expect(unlink).toHaveBeenCalledExactlyOnceWith(
      "sensitive-access-token"
    );
    const cookies = response.headers.getSetCookie();
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("authjs.session-token=;"),
        expect.stringContaining("__Secure-authjs.session-token=;"),
        expect.stringContaining("authjs.session-token.0=;"),
        expect.stringContaining("authjs.session-token.1=;")
      ])
    );
    expect(JSON.stringify(responseBody)).not.toContain(
      "provider-private-a"
    );
  });

  it("keeps local deletion committed when Kakao unlink fails", async () => {
    const handlers = createAccountRouteHandlers({
      resolvePrincipal: async () => principal(),
      repository: createUserRepository(database.db, {
        now: () => nowMs
      }),
      unlink: async () => "PENDING_MANUAL",
      now: () => nowMs
    });

    const response = await handlers.DELETE(withdrawalRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      providerUnlink: "PENDING_MANUAL"
    });
    expect(ownedRowCounts()).toEqual({
      user: 0,
      account: 0,
      session: 0,
      favorite: 0,
      search_history: 0,
      selection_history: 0
    });
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("requires exact Origin, confirmation, authentication, and recent login", async () => {
    const unlink = vi.fn(async () => "UNLINKED" as const);
    const repository = createUserRepository(database.db, {
      now: () => nowMs
    });
    const oldAuthHandlers = createAccountRouteHandlers({
      resolvePrincipal: async () =>
        principal(nowMs - 10 * 60 * 1_000 - 1),
      repository,
      unlink,
      now: () => nowMs
    });
    const unauthenticated = createAccountRouteHandlers({
      resolvePrincipal: async () => null,
      repository,
      unlink,
      now: () => nowMs
    });

    const noOrigin = new Request(`${AUTH_ORIGIN}/api/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    const badConfirmation = new Request(
      `${AUTH_ORIGIN}/api/account`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: AUTH_ORIGIN
        },
        body: JSON.stringify({ confirmation: "yes" })
      }
    );

    expect((await oldAuthHandlers.DELETE(noOrigin)).status).toBe(403);
    expect(
      (await unauthenticated.DELETE(withdrawalRequest())).status
    ).toBe(401);
    expect(
      (await oldAuthHandlers.DELETE(badConfirmation)).status
    ).toBe(400);
    expect(
      (await oldAuthHandlers.DELETE(withdrawalRequest())).status
    ).toBe(403);
    expect(unlink).not.toHaveBeenCalled();
    expect(ownedRowCounts().user).toBe(1);
  });
});
