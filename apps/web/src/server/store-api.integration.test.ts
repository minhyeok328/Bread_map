import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  storeDetailResponseSchema,
  storeMapStateSchema
} from "@bread-map/contracts";
import {
  seedSqliteSearchFixture,
  SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
} from "@bread-map/testkit";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  createSqliteStoreSearchService
} from "./search-service.js";
import {
  createSqliteStoreDetailService
} from "./store-detail-service.js";

let directory: string;
let database: AppDatabaseHandle | undefined;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-store-api-")
  );
  database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedSqliteSearchFixture(database);
});

afterEach(async () => {
  database?.close();
  database = undefined;
  await rm(directory, { recursive: true, force: true });
});

function appDatabase(): AppDatabaseHandle {
  if (database === undefined) {
    throw new Error("fixture database unavailable");
  }
  return database;
}

function searchRequest() {
  return {
    query: {
      region: "마포구",
      storeName: null,
      menuName: null,
      categories: [],
      openNow: false,
      origin: {
        latitudeE7: 375600001,
        longitudeE7: 1269000001
      },
      maxDistanceM: 20_000,
      reviewEvidenceStatus: "ANY",
      sortMode: "DISTANCE",
      recommendationVersion: "recommendation-v1"
    },
    dataSnapshotVersion: null
  };
}

function detailQuery(
  dataSnapshotVersion: string,
  reviewPage = "1",
  reviewLimit = "10"
) {
  return {
    dataSnapshotVersion,
    reviewPage,
    reviewLimit
  };
}

describe("store and map server APIs against migrated SQLite", () => {
  it("keeps search, map, list, and detail on one complete ID set and snapshot", () => {
    const search = createSqliteStoreSearchService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).search(searchRequest());
    const listStoreIds = search.items.map(
      (item) => item.storeId
    );
    const mapStoreIds = search.items.map(
      (item) => item.storeId
    );
    const mapState = storeMapStateSchema.parse({
      status: "READY"
    });
    const mapUnavailableState = storeMapStateSchema.parse({
      status: "MAP_UNAVAILABLE"
    });
    const mapPresentation = {
      state: mapState,
      items: search.items
    };
    const fallbackPresentation = {
      ...mapPresentation,
      state: mapUnavailableState
    };

    expect(listStoreIds).toEqual(["store_a", "store_b"]);
    expect(mapStoreIds).toEqual(listStoreIds);
    expect(fallbackPresentation.items).toBe(
      mapPresentation.items
    );
    expect(
      fallbackPresentation.items.every(
        (item) =>
          item.normalizedAddress.length > 0 &&
          item.distanceUpperBoundM !== null
      )
    ).toBe(true);

    const detail = createSqliteStoreDetailService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).get(
      { storeId: search.items[0]?.storeId },
      detailQuery(search.metadata.dataSnapshotVersion, "1", "2")
    );

    expect(storeDetailResponseSchema.safeParse(detail).success).toBe(
      true
    );
    expect(detail).toMatchObject({
      store: {
        storeId: "store_a",
        bakeryId: "bakery_a",
        openingState: "OPEN"
      },
      menus: {
        status: "AVAILABLE",
        items: [
          {
            menuId: "menu_a_baguette",
            evidenceId: "menu_a_baguette",
            source: "MANUAL_VERIFIED",
            verifiedAtMs: 201
          },
          {
            menuId: "menu_a_salt",
            evidenceId: "menu_a_salt",
            source: "MANUAL_VERIFIED",
            verifiedAtMs: 200
          }
        ]
      },
      businessHours: {
        status: "AVAILABLE",
        items: [
          { intervalId: "hours_a_thursday" },
          { intervalId: "hours_a_friday" }
        ]
      },
      rating: {
        averageBasisPoints: 4250,
        ratedReviewCount: 2,
        totalReviewCount: 3
      },
      reviews: {
        status: "AVAILABLE",
        page: 1,
        limit: 2,
        totalCount: 3,
        totalPages: 2,
        items: [
          { reviewId: "review_a_1" },
          { reviewId: "review_a_2" }
        ]
      },
      metadata: {
        dataSnapshotVersion:
          search.metadata.dataSnapshotVersion,
        catalogPublishId: search.metadata.catalogPublishId,
        searchEvidencePublishId: "evidence_active",
        reviewPublishVersionId: "review_active"
      }
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /fixture:\/\/|evidenceRef|nickname|fingerprint|raw\.sqlite/u
    );
  });

  it("paginates reviews deterministically and keeps insufficient stores visible", () => {
    const search = createSqliteStoreSearchService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).search(searchRequest());
    const detailService = createSqliteStoreDetailService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    );
    const secondReviewPage = detailService.get(
      { storeId: "store_a" },
      detailQuery(search.metadata.dataSnapshotVersion, "2", "2")
    );
    const insufficient = detailService.get(
      { storeId: "store_b" },
      detailQuery(search.metadata.dataSnapshotVersion)
    );

    expect(secondReviewPage?.reviews).toMatchObject({
      status: "AVAILABLE",
      page: 2,
      totalCount: 3,
      totalPages: 2,
      items: [{ reviewId: "review_a_3" }]
    });
    expect(insufficient).toMatchObject({
      store: { storeId: "store_b" },
      reviews: {
        status: "INSUFFICIENT",
        totalCount: 2
      },
      rating: {
        averageBasisPoints: 4750,
        ratedReviewCount: 2,
        totalReviewCount: 2
      }
    });
  });

  it("does not disclose a published row outside the active source snapshot", () => {
    const search = createSqliteStoreSearchService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).search(searchRequest());
    const hidden = createSqliteStoreDetailService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).get(
      { storeId: "store_hidden" },
      detailQuery(search.metadata.dataSnapshotVersion)
    );

    expect(search.items.map((item) => item.storeId)).not.toContain(
      "store_hidden"
    );
    expect(hidden).toBeNull();
  });

  it("keeps verified facts when the review corpus is unavailable", () => {
    appDatabase().client
      .prepare(
        `UPDATE review_publish_version
         SET document_count = 6, fts_document_count = 6
         WHERE version_id = 'review_active'`
      )
      .run();
    const search = createSqliteStoreSearchService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).search(searchRequest());
    const detail = createSqliteStoreDetailService(
      appDatabase(),
      () => SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS
    ).get(
      { storeId: "store_a" },
      detailQuery(search.metadata.dataSnapshotVersion)
    );

    expect(detail).toMatchObject({
      store: { storeId: "store_a" },
      menus: {
        status: "AVAILABLE"
      },
      businessHours: {
        status: "AVAILABLE"
      },
      rating: {
        averageBasisPoints: null,
        ratedReviewCount: 0,
        totalReviewCount: 0
      },
      reviews: {
        status: "UNAVAILABLE",
        totalCount: 0,
        totalPages: 0,
        items: []
      },
      metadata: {
        searchEvidencePublishId: "evidence_active",
        reviewPublishVersionId: null
      }
    });
    expect(
      detail?.menus.items.map((menu) => menu.menuId)
    ).toContain("menu_a_salt");
  });

  it("marks eight-day source data as a warning and writes no user location history", () => {
    const warningTimeMs = Date.parse(
      "2026-08-07T12:00:00+09:00"
    );
    const search = createSqliteStoreSearchService(
      appDatabase(),
      () => warningTimeMs
    ).search(searchRequest());
    const detail = createSqliteStoreDetailService(
      appDatabase(),
      () => warningTimeMs
    ).get(
      { storeId: "store_a" },
      detailQuery(search.metadata.dataSnapshotVersion)
    );
    const historyCounts = appDatabase().client
      .prepare(
        `SELECT
           (SELECT count(*) FROM search_history)
             AS searchHistoryCount,
           (SELECT count(*) FROM selection_history)
             AS selectionHistoryCount`
      )
      .get() as {
      searchHistoryCount: number;
      selectionHistoryCount: number;
    };

    expect(detail?.freshness).toEqual({
      status: "WARNING",
      sourceBasisDate: "2026-07-30"
    });
    expect(historyCounts).toEqual({
      searchHistoryCount: 0,
      selectionHistoryCount: 0
    });
    expect(JSON.stringify(search)).not.toMatch(
      /375600001|1269000001/u
    );
  });
});
