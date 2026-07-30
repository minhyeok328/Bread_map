import { describe, expect, it } from "vitest";
import {
  accountWithdrawalSchema,
  favoriteMutationSchema,
  historyDeleteSchema,
  historyMutationSchema,
  historyQuerySchema
} from "./user-data.js";

const validFilters = {
  schemaVersion: "search-history-filters-v1",
  areaLabel: "마포구",
  categories: [
    {
      category: "SALT_BREAD",
      mode: "INCLUDE"
    }
  ],
  openNow: false,
  maxDistanceBucketM: 2500,
  reviewEvidenceStatus: "ANY",
  sortMode: "RELEVANCE"
} as const;

const validSearchHistory = {
  kind: "search",
  filters: validFilters,
  dataSnapshotVersion: `search-data-v1_${"a".repeat(64)}`,
  recommendationVersion: "recommendation-v1",
  resultCount: 3
} as const;

describe("user data contracts", () => {
  it("accepts only opaque favorite and history identifiers", () => {
    expect(
      favoriteMutationSchema.parse({ storeId: "store_fixture-01" })
    ).toEqual({ storeId: "store_fixture-01" });
    expect(
      historyDeleteSchema.parse({
        kind: "selection",
        historyId: "selection_fixture-01"
      })
    ).toEqual({
      kind: "selection",
      historyId: "selection_fixture-01"
    });

    expect(() =>
      favoriteMutationSchema.parse({
        storeId: "../other-user",
        userId: "user-b"
      })
    ).toThrow();
    expect(() =>
      historyDeleteSchema.parse({
        kind: "search",
        historyId: ""
      })
    ).toThrow();
  });

  it("accepts a strict normalized search history payload", () => {
    expect(historyMutationSchema.parse(validSearchHistory)).toEqual(
      validSearchHistory
    );
  });

  it.each([
    {
      name: "exact origin",
      value: {
        ...validSearchHistory,
        filters: {
          ...validFilters,
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        }
      }
    },
    {
      name: "raw search text",
      value: {
        ...validSearchHistory,
        rawQuery: "알레르기 없는 빵"
      }
    },
    {
      name: "free-form area",
      value: {
        ...validSearchHistory,
        filters: {
          ...validFilters,
          areaLabel: "내 집 앞 정확한 위치"
        }
      }
    },
    {
      name: "non-bucketed distance",
      value: {
        ...validSearchHistory,
        filters: {
          ...validFilters,
          maxDistanceBucketM: 2551
        }
      }
    },
    {
      name: "conflicting category",
      value: {
        ...validSearchHistory,
        filters: {
          ...validFilters,
          categories: [
            {
              category: "SALT_BREAD",
              mode: "INCLUDE"
            },
            {
              category: "SALT_BREAD",
              mode: "EXCLUDE"
            }
          ]
        }
      }
    }
  ])("rejects $name from persisted search history", ({ value }) => {
    expect(() => historyMutationSchema.parse(value)).toThrow();
  });

  it("allows only the approved selection surfaces", () => {
    expect(
      historyMutationSchema.parse({
        kind: "selection",
        storeId: "store_fixture-01",
        sourceSurface: "MAP"
      })
    ).toEqual({
      kind: "selection",
      storeId: "store_fixture-01",
      sourceSurface: "MAP"
    });
    expect(() =>
      historyMutationSchema.parse({
        kind: "selection",
        storeId: "store_fixture-01",
        sourceSurface: "CHAT"
      })
    ).toThrow();
  });

  it("bounds history list queries", () => {
    expect(
      historyQuerySchema.parse({
        kind: "search",
        limit: "20"
      })
    ).toEqual({
      kind: "search",
      limit: 20
    });
    expect(() =>
      historyQuerySchema.parse({
        kind: "selection",
        limit: "101"
      })
    ).toThrow();
  });

  it("requires the exact irreversible withdrawal confirmation", () => {
    expect(
      accountWithdrawalSchema.parse({
        confirmation: "DELETE_MY_ACCOUNT"
      })
    ).toEqual({
      confirmation: "DELETE_MY_ACCOUNT"
    });
    expect(() =>
      accountWithdrawalSchema.parse({
        confirmation: "DELETE"
      })
    ).toThrow();
  });
});
