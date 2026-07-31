import { expect, request, test } from "@playwright/test";
import {
  createLocalMvpSession
} from "./fixtures/local-mvp-session";

test("two encrypted sessions isolate favorites and selection history", async () => {
  const first = await createLocalMvpSession("owner-a");
  const second = await createLocalMvpSession("owner-b");
  const createClient = (cookieHeader: string) =>
    request.newContext({
      baseURL: "http://127.0.0.1:3000",
      extraHTTPHeaders: {
        cookie: cookieHeader,
        origin: "http://127.0.0.1:3000"
      }
    });
  const firstClient = await createClient(first.cookieHeader);
  const secondClient = await createClient(second.cookieHeader);

  try {
    expect(
      (
        await firstClient.post("/api/favorites", {
          data: { storeId: "store_a" }
        })
      ).status()
    ).toBe(201);
    expect(
      (
        await secondClient.post("/api/favorites", {
          data: { storeId: "store_b" }
        })
      ).status()
    ).toBe(201);

    const firstFavorites = await (
      await firstClient.get("/api/favorites")
    ).json();
    const secondFavorites = await (
      await secondClient.get("/api/favorites")
    ).json();
    expect(firstFavorites.favorites).toHaveLength(1);
    expect(firstFavorites.favorites[0].storeId).toBe("store_a");
    expect(secondFavorites.favorites).toHaveLength(1);
    expect(secondFavorites.favorites[0].storeId).toBe("store_b");

    expect(
      (
        await firstClient.post("/api/history", {
          data: {
            kind: "selection",
            storeId: "store_a",
            sourceSurface: "MAP"
          }
        })
      ).status()
    ).toBe(201);
    const firstHistory = await (
      await firstClient.get("/api/history?kind=selection&limit=20")
    ).json();
    const secondHistory = await (
      await secondClient.get("/api/history?kind=selection&limit=20")
    ).json();
    expect(firstHistory.histories).toHaveLength(1);
    expect(firstHistory.histories[0].storeId).toBe("store_a");
    expect(secondHistory.histories).toEqual([]);

    expect(JSON.stringify(firstFavorites)).not.toContain(first.userId);
    expect(JSON.stringify(secondFavorites)).not.toContain(second.userId);
  } finally {
    await firstClient.dispose();
    await secondClient.dispose();
  }
});
