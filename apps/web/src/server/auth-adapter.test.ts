import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AdapterAccount, AdapterUser } from "@auth/core/adapters";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMinimalAuthAdapter } from "./auth-adapter.js";

let directory: string;
let database: AppDatabaseHandle;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-auth-adapter-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
});

afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});

describe("minimal Auth.js Drizzle adapter", () => {
  it("creates an internal user without persisting provider profile fields", async () => {
    const adapter = createMinimalAuthAdapter(database.db);
    const created = await adapter.createUser!({
      id: "ignored-provider-user-id",
      name: "Sensitive Nickname",
      email: "secret@example.test",
      emailVerified: new Date("2026-07-30T00:00:00.000Z"),
      image: "https://example.test/private-profile.png"
    } satisfies AdapterUser);

    expect(created).toEqual({
      id: expect.any(String),
      name: null,
      email: null,
      emailVerified: null,
      image: null
    });
    expect(
      database.client.prepare("SELECT * FROM user").all()
    ).toEqual([
      {
        user_id: created.id,
        status: "ACTIVE",
        created_at_ms: expect.any(Number),
        updated_at_ms: expect.any(Number),
        deleted_at_ms: null
      }
    ]);
    expect(
      database.client.serialize().includes("secret@example.test")
    ).toBe(false);
  });

  it("persists only Kakao provider identity from a complete OAuth account", async () => {
    const adapter = createMinimalAuthAdapter(database.db);
    const user = await adapter.createUser!({
      id: "ignored",
      name: null,
      email: null as unknown as string,
      emailVerified: null,
      image: null
    });
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "kakao",
      providerAccountId: "provider-a",
      access_token: "access-token-must-not-persist",
      refresh_token: "refresh-token-must-not-persist",
      id_token: "id-token-must-not-persist",
      token_type: "bearer",
      scope: "account_email profile_nickname",
      expires_at: 1_785_430_000
    } satisfies AdapterAccount);

    expect(
      database.client.prepare("SELECT * FROM account").all()
    ).toEqual([
      {
        account_id: expect.any(String),
        user_id: user.id,
        type: "oauth",
        provider: "kakao",
        provider_account_id: "provider-a",
        created_at_ms: expect.any(Number)
      }
    ]);
    expect(
      await adapter.getUserByAccount!({
        provider: "kakao",
        providerAccountId: "provider-a"
      })
    ).toEqual(user);
    expect(
      await adapter.getAccount!("provider-a", "kakao")
    ).toEqual({
      userId: user.id,
      type: "oauth",
      provider: "kakao",
      providerAccountId: "provider-a"
    });
  });

  it("rejects non-Kakao account linkage", async () => {
    const adapter = createMinimalAuthAdapter(database.db);
    await expect(
      adapter.linkAccount!({
        userId: "user-a",
        type: "oauth",
        provider: "google",
        providerAccountId: "provider-a"
      })
    ).rejects.toThrow("unsupported auth provider");
  });
});
