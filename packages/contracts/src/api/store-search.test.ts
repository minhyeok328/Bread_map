import { describe, expect, it } from "vitest";
import { RECOMMENDATION_VERSION } from "../search.js";
import {
  parseStoreSearchRequest,
  storeMapStateSchema,
  storeSearchRequestSchema,
  type StoreMapState,
  type StoreSearchRequest
} from "./store-search.js";

const validQuery = {
  region: "  마포구  ",
  storeName: null,
  menuName: " 소금빵 ",
  categories: [
    {
      category: "SALT_BREAD",
      mode: "INCLUDE"
    }
  ],
  openNow: false,
  origin: {
    latitudeE7: 375634614,
    longitudeE7: 1269014494
  },
  maxDistanceM: 2500,
  reviewEvidenceStatus: "ANY",
  sortMode: "RELEVANCE",
  recommendationVersion: RECOMMENDATION_VERSION
} satisfies StoreSearchRequest["query"];

describe("storeSearchRequestSchema", () => {
  it("accepts null bootstrap version and normalizes the reused search query", () => {
    const request = {
      query: validQuery,
      dataSnapshotVersion: null
    } satisfies StoreSearchRequest;

    expect(parseStoreSearchRequest(request)).toEqual({
      query: {
        ...validQuery,
        region: "마포구",
        menuName: "소금빵"
      },
      dataSnapshotVersion: null
    });
  });

  it("accepts only the opaque search data version format", () => {
    const dataSnapshotVersion = `search-data-v1_${"a".repeat(64)}`;

    expect(
      storeSearchRequestSchema.parse({
        query: validQuery,
        dataSnapshotVersion
      }).dataSnapshotVersion
    ).toBe(dataSnapshotVersion);
    expect(
      storeSearchRequestSchema.safeParse({
        query: validQuery,
        dataSnapshotVersion: "../app.sqlite"
      }).success
    ).toBe(false);
  });

  it.each([
    {
      name: "unknown request field",
      request: {
        query: validQuery,
        dataSnapshotVersion: null,
        debug: true
      }
    },
    {
      name: "unknown nested query field",
      request: {
        query: { ...validQuery, exactDistanceM: 42 },
        dataSnapshotVersion: null
      }
    },
    {
      name: "distance without origin",
      request: {
        query: {
          ...validQuery,
          origin: null,
          maxDistanceM: 2500
        },
        dataSnapshotVersion: null
      }
    },
    {
      name: "distance sort without origin",
      request: {
        query: {
          ...validQuery,
          origin: null,
          maxDistanceM: null,
          sortMode: "DISTANCE"
        },
        dataSnapshotVersion: null
      }
    }
  ])("rejects $name", ({ request }) => {
    expect(storeSearchRequestSchema.safeParse(request).success).toBe(
      false
    );
  });
});

describe("storeMapStateSchema", () => {
  it.each(["READY", "MAP_UNAVAILABLE"] as const)(
    "accepts %s without route-time fields",
    (status) => {
      const state = { status } satisfies StoreMapState;

      expect(storeMapStateSchema.parse(state)).toEqual(state);
    }
  );

  it("rejects unknown status and fields", () => {
    expect(
      storeMapStateSchema.safeParse({ status: "ROUTE_READY" }).success
    ).toBe(false);
    expect(
      storeMapStateSchema.safeParse({
        status: "READY",
        travelTimeSeconds: 60
      }).success
    ).toBe(false);
  });
});
