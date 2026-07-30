import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  RATING_PRIOR_VERSION,
  RECOMMENDATION_VERSION,
  SEARCH_ALIAS_VERSION,
  SEARCH_CONTRACT_VERSION,
  SEARCH_REVIEW_FTS_INDEX_VERSION,
  type StructuredSearchInput,
  type StructuredSearchResult
} from "@bread-map/contracts";
import {
  searchEvaluationFixture,
  type SearchEvaluationScenario
} from "@bread-map/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { executeStoreSearch } from "./execute-store-search.js";
import {
  createSqliteReviewRepository
} from "./sqlite-review-repository.js";
import {
  createSqliteStoreSearchRepository,
  runSqliteSearchReadTransaction
} from "./sqlite-store-search-repository.js";
import {
  runSearchEvaluation
} from "./search-evaluation.js";
import { StoreSearchError } from "./store-search-repository.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createEvaluationDatabase(): Promise<AppDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-search-evaluation-")
  );
  cleanupPaths.push(directory);
  const database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedEvaluationDatabase(database);
  return database;
}

function seedEvaluationDatabase(
  database: AppDatabaseHandle
): void {
  const fixture = searchEvaluationFixture;
  database.client
    .prepare(
      `INSERT INTO source_catalog (
         source_id, source_key, official_url, required_fields_json,
         terms_checked_at_ms, created_at_ms
       ) VALUES ('source_evaluation', 'evaluation',
         'https://example.test/evaluation', '[]', 1, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO source_snapshot (
         snapshot_id, source_id, sha256, byte_size, basis_date,
         downloaded_at_ms, adapter_version, local_path_hint
       ) VALUES ('snapshot_evaluation', 'source_evaluation', ?, 1, ?,
         100, 'evaluation-v1', NULL)`
    )
    .run(Buffer.alloc(32, 1), fixture.sourceBasisDate);

  const insertSourceRow = database.client.prepare(
    `INSERT INTO source_snapshot_row (
       source_row_id, snapshot_id, page_no, row_index,
       source_row_key, payload_json, payload_sha256, created_at_ms
     ) VALUES (?, 'snapshot_evaluation', 1, ?, ?, '{}', ?, 1)`
  );
  const insertRecord = database.client.prepare(
    `INSERT INTO localdata_bakery_record (
       record_id, snapshot_id, source_row_id, mng_no,
       open_authority_group_code, permit_date,
       business_status_code, business_status_name,
       detailed_business_status_code, detailed_business_status_name,
       closed_date, business_name, road_name_address,
       lot_number_address, source_coordinate_x, source_coordinate_y,
       data_updated_at_ms, last_modified_at_ms, staged_at_ms
     ) VALUES (?, 'snapshot_evaluation', ?, ?, '6110000', NULL, '01',
       '영업/정상', '01', '영업', NULL, ?, ?, NULL, '191234.125',
       '451234.5', NULL, NULL, 1)`
  );
  const insertBakery = database.client.prepare(
    `INSERT INTO bakery (
       bakery_id, display_name, normalized_name, catalog_status,
       created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, 'published', 1, 1)`
  );
  const insertStore = database.client.prepare(
    `INSERT INTO store (
       store_id, bakery_id, display_name, normalized_name,
       normalized_brand_name, normalized_address, seoul_district,
       normalized_phone, latitude_e7, longitude_e7,
       business_status, catalog_status, latest_verified_at_ms,
       created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'published',
       100, 1, 1)`
  );
  const insertLink = database.client.prepare(
    `INSERT INTO store_source_link (
       link_id, store_id, source_record_id, source_row_id,
       snapshot_id, source_type, linked_at_ms
     ) VALUES (?, ?, ?, ?, 'snapshot_evaluation', 'LOCALDATA', 1)`
  );
  fixture.stores.forEach((store, index) => {
    const sourceRowId = `source_row_${store.storeId}`;
    const recordId = `record_${store.storeId}`;
    insertSourceRow.run(
      sourceRowId,
      index,
      `SEOUL-EVAL-${index}`,
      Buffer.alloc(32, (index % 250) + 2)
    );
    insertRecord.run(
      recordId,
      sourceRowId,
      `SEOUL-EVAL-${index}`,
      store.displayName,
      store.normalizedAddress
    );
    insertBakery.run(
      store.bakeryId,
      store.displayName,
      store.normalizedName
    );
    insertStore.run(
      store.storeId,
      store.bakeryId,
      store.displayName,
      store.normalizedName,
      store.normalizedName,
      store.normalizedAddress,
      store.seoulDistrict,
      store.normalizedPhone,
      store.latitudeE7,
      store.longitudeE7
    );
    insertLink.run(
      `link_${store.storeId}`,
      store.storeId,
      recordId,
      sourceRowId
    );
  });

  database.client
    .prepare(
      `INSERT INTO data_publish (
         publish_id, input_snapshot_id, normalization_version,
         matcher_version, eligibility_version, status,
         candidate_count, published_count, excluded_count,
         admin_review_count, published_at_ms
       ) VALUES ('publish_evaluation', 'snapshot_evaluation',
         'store-normalization-v1', 'store-matcher-v1',
         'store-eligibility-v1', 'SUCCEEDED', 30, 30, 0, 0, 100)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO catalog_publish_state (
         state_id, publish_id, snapshot_id, source_basis_date,
         source_downloaded_at_ms, updated_at_ms
       ) VALUES ('active', 'publish_evaluation',
         'snapshot_evaluation', ?, 100, 100)`
    )
    .run(fixture.sourceBasisDate);

  const menuCount = fixture.stores.reduce(
    (total, store) => total + store.menus.length,
    0
  );
  const storeAliasCount = fixture.stores.reduce(
    (total, store) => total + store.aliases.length,
    0
  );
  const menuAliasCount = fixture.stores.reduce(
    (total, store) =>
      total +
      store.menus.reduce(
        (menuTotal, menu) => menuTotal + menu.aliases.length,
        0
      ),
    0
  );
  const businessHourCount = fixture.stores.reduce(
    (total, store) => total + store.hours.length,
    0
  );
  database.client
    .prepare(
      `INSERT INTO search_evidence_publish (
         publish_id, input_catalog_publish_id, contract_version,
         status, active_slot, menu_count, store_alias_count,
         menu_alias_count, business_hour_count, corpus_checksum,
         published_at_ms
       ) VALUES ('evidence_evaluation', 'publish_evaluation',
         'search-evidence-v1', 'BUILDING', NULL, ?, ?, ?, ?, ?, 200)`
    )
    .run(
      menuCount,
      storeAliasCount,
      menuAliasCount,
      businessHourCount,
      "b".repeat(64)
    );
  const insertMenu = database.client.prepare(
    `INSERT INTO menu (
       menu_id, evidence_publish_id, store_id, name, normalized_name,
       category, source, evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_evaluation', ?, ?, ?, ?,
       'MANUAL_VERIFIED', ?, 200)`
  );
  const insertMenuAlias = database.client.prepare(
    `INSERT INTO menu_alias (
       alias_id, menu_id, alias, normalized_alias, source,
       evidence_ref, verified_at_ms
     ) VALUES (?, ?, ?, ?, 'MANUAL_VERIFIED', ?, 200)`
  );
  const insertStoreAlias = database.client.prepare(
    `INSERT INTO store_alias (
       alias_id, evidence_publish_id, store_id, alias_type, alias,
       normalized_alias, source, evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_evaluation', ?, ?, ?, ?,
       'MANUAL_VERIFIED', ?, 200)`
  );
  const insertHour = database.client.prepare(
    `INSERT INTO store_business_hour (
       interval_id, evidence_publish_id, store_id, weekday, sequence,
       opens_minute, closes_minute, closes_next_day, source,
       evidence_ref, verified_at_ms
     ) VALUES (?, 'evidence_evaluation', ?, ?, ?, ?, ?, ?,
       'MANUAL_VERIFIED', ?, 200)`
  );
  for (const store of fixture.stores) {
    for (const menu of store.menus) {
      insertMenu.run(
        menu.menuId,
        store.storeId,
        menu.name,
        menu.normalizedName,
        menu.category,
        `fixture://menu/${menu.menuId}`
      );
      for (const alias of menu.aliases) {
        insertMenuAlias.run(
          alias.aliasId,
          menu.menuId,
          alias.alias,
          alias.normalizedAlias,
          `fixture://menu-alias/${alias.aliasId}`
        );
      }
    }
    for (const alias of store.aliases) {
      insertStoreAlias.run(
        alias.aliasId,
        store.storeId,
        alias.aliasType,
        alias.alias,
        alias.normalizedAlias,
        `fixture://store-alias/${alias.aliasId}`
      );
    }
    for (const hour of store.hours) {
      insertHour.run(
        hour.intervalId,
        store.storeId,
        hour.weekday,
        hour.sequence,
        hour.opensMinute,
        hour.closesMinute,
        hour.closesNextDay ? 1 : 0,
        `fixture://hours/${hour.intervalId}`
      );
    }
  }
  database.client
    .prepare(
      `UPDATE search_evidence_publish
       SET status = 'ACTIVE', active_slot = 1
       WHERE publish_id = 'evidence_evaluation'`
    )
    .run();

  const reviewCount = fixture.stores.reduce(
    (total, store) => total + store.reviews.length,
    0
  );
  database.client
    .prepare(
      `INSERT INTO review_publish_version (
         version_id, source_run_id, source_run_status,
         source_as_of_date, status, active_slot, document_count,
         fts_document_count, corpus_checksum, published_at_ms
       ) VALUES ('review_evaluation', 'run_evaluation', 'SUCCEEDED',
         '2026-07-30', 'ACTIVE', 1, ?, ?, ?, 300)`
    )
    .run(reviewCount, reviewCount, "c".repeat(64));
  const insertReview = database.client.prepare(
    `INSERT INTO review_document (
       review_id, store_id, provider, body, normalized_body,
       rating_basis_points, published_date, collected_at_ms,
       source_run_id, publish_version_id
     ) VALUES (?, ?, 'KAKAO_MAP', ?, ?, ?, ?, 300,
       'run_evaluation', 'review_evaluation')`
  );
  for (const store of fixture.stores) {
    for (const review of store.reviews) {
      insertReview.run(
        review.reviewId,
        store.storeId,
        review.body,
        review.normalizedBody,
        review.ratingBasisPoints,
        review.publishedDate
      );
    }
  }
  database.client
    .prepare(
      `INSERT INTO fts_index_state (
         state_id, index_version, publish_version_id, status,
         active_slot, document_count, corpus_checksum, built_at_ms
       ) VALUES ('fts_evaluation', 'review-fts-unicode61-v1',
         'review_evaluation', 'ACTIVE', 1, ?, ?, 300)`
    )
    .run(reviewCount, "c".repeat(64));
}

function executeScenario(
  database: AppDatabaseHandle,
  scenario: SearchEvaluationScenario,
  input: StructuredSearchInput
) {
  if (scenario.degradation !== "FTS_UNAVAILABLE") {
    return runSqliteSearchReadTransaction(database, () =>
      executeStoreSearch({
        input,
        requestTimeMs: scenario.requestTimeMs,
        storeRepository:
          createSqliteStoreSearchRepository(database),
        reviewRepository:
          createSqliteReviewRepository(database)
      })
    );
  }
  const realReviewRepository =
    createSqliteReviewRepository(database);
  return runSqliteSearchReadTransaction(database, () =>
    executeStoreSearch({
      input,
      requestTimeMs: scenario.requestTimeMs,
      storeRepository:
        createSqliteStoreSearchRepository(database),
      reviewRepository: {
        searchReviews: (reviewInput) =>
          realReviewRepository.searchReviews(reviewInput),
        listStoreReviews: (reviewInput) =>
          realReviewRepository.listStoreReviews(reviewInput),
        getActiveIndexState: () =>
          realReviewRepository.getActiveIndexState(),
        searchStoreEvidence: () => ({
          status: "UNAVAILABLE",
          code: "FTS_UNAVAILABLE",
          hits: []
        })
      }
    })
  );
}

const syntheticDataVersion = `search-data-v1_${"d".repeat(64)}`;

function syntheticResult(
  scenario: SearchEvaluationScenario,
  storeIds: readonly string[],
  status:
    | StructuredSearchResult["status"]
    | undefined = undefined
): StructuredSearchResult {
  const resultStatus =
    status ??
    (scenario.degradation === "FTS_UNAVAILABLE"
      ? "PARTIAL"
      : "COMPLETE");
  const isPartial = resultStatus === "PARTIAL";
  return {
    status: resultStatus,
    partialReason: isPartial ? "FTS_UNAVAILABLE" : null,
    items: storeIds.map((storeId) => ({
      storeId,
      bakeryId: `bakery_${storeId}`,
      displayName: storeId,
      normalizedAddress: "서울특별시 마포구 검증로 1",
      seoulDistrict: "마포구",
      latitudeE7: 375634614,
      longitudeE7: 1269014494,
      distanceUpperBoundM: null,
      openingState: "UNKNOWN",
      representativeMenus: [],
      categories: [],
      review: {
        status: "INSUFFICIENT",
        count: 0,
        latestPublishedDate: null,
        snippet: null
      },
      reasonCodes: ["VERIFIED_DATA"],
      warningCodes: isPartial
        ? ["OPENING_HOURS_UNKNOWN", "FTS_UNAVAILABLE"]
        : ["OPENING_HOURS_UNKNOWN"]
    })),
    metadata: {
      searchContractVersion: SEARCH_CONTRACT_VERSION,
      recommendationVersion: RECOMMENDATION_VERSION,
      dataSnapshotVersion: syntheticDataVersion,
      catalogPublishId: "publish_synthetic",
      searchEvidencePublishId: "evidence_synthetic",
      reviewPublishVersionId: "review_synthetic",
      sourceBasisDate: "2026-07-30",
      ftsIndexVersion: isPartial
        ? null
        : SEARCH_REVIEW_FTS_INDEX_VERSION,
      aliasVersion: SEARCH_ALIAS_VERSION,
      ratingPriorVersion: RATING_PRIOR_VERSION
    },
    filterSummary: {
      initialCount: storeIds.length,
      resultCount: storeIds.length,
      reasonCounts: {
        REGION_MISMATCH: 0,
        STORE_NAME_MISMATCH: 0,
        EXCLUDED_CATEGORY: 0,
        INCLUDED_CATEGORY_MISSING: 0,
        NOT_OPEN: 0,
        DISTANCE_EXCEEDED: 0,
        REVIEW_STATUS_MISMATCH: 0,
        MENU_MISMATCH: 0
      }
    },
    relaxationOptions: []
  };
}

describe("Feature 6 search evaluation", () => {
  it("owns exactly 30 stores, 50 menus and 20 search-only scenarios", () => {
    const fixture = searchEvaluationFixture;
    expect(fixture.stores).toHaveLength(30);
    expect(
      new Set(fixture.stores.map((store) => store.storeId)).size
    ).toBe(30);
    expect(
      fixture.stores.reduce(
        (total, store) => total + store.menus.length,
        0
      )
    ).toBe(50);
    expect(fixture.scenarios).toHaveLength(20);
    expect(
      fixture.scenarios.map((scenario) => scenario.id)
    ).toEqual([
      "region-district",
      "region-neighborhood-alias",
      "region-station-alias",
      "store-exact",
      "store-approved-alias",
      "menu-exact",
      "menu-synonym",
      "menu-review-fallback",
      "category-include",
      "category-exclude",
      "open-now",
      "overnight-open",
      "distance-boundary",
      "distance-sort",
      "reviews-available",
      "reviews-insufficient",
      "combined-hard-filters",
      "fts-unavailable-fallback",
      "version-mismatch",
      "stale-source"
    ]);
    expect(
      fixture.scenarios.filter(
        (scenario) => scenario.countsTowardHitRate
      )
    ).toHaveLength(18);
    expect(
      fixture.scenarios.filter(
        (scenario) => scenario.expectedErrorCode !== undefined
      )
    ).toHaveLength(2);
    expect(
      fixture.scenarios.filter((scenario) => scenario.requiredHit)
    ).toHaveLength(2);
    expect(
      fixture.scenarios
        .filter((scenario) => scenario.countsTowardHitRate)
        .every(
          (scenario) =>
            scenario.expectedTopFiveStoreIds.length > 0
        )
    ).toBe(true);
    expect(
      fixture.scenarios.find(
        (scenario) =>
          scenario.id === "fts-unavailable-fallback"
      )
    ).toMatchObject({
      degradation: "FTS_UNAVAILABLE",
      expectedStatus: "PARTIAL"
    });
    expect(
      fixture.scenarios.find(
        (scenario) => scenario.id === "menu-exact"
      )?.ratingGuards
    ).toHaveLength(1);
  });

  it("fails unexpected partial results and missing required capability hits", () => {
    const report = runSearchEvaluation({
      fixtureId: searchEvaluationFixture.fixtureId,
      scenarios: searchEvaluationFixture.scenarios,
      dataSnapshotVersion: syntheticDataVersion,
      recommendationVersion: RECOMMENDATION_VERSION,
      execute: (scenario) => {
        if (scenario.expectedErrorCode !== undefined) {
          throw new StoreSearchError(scenario.expectedErrorCode);
        }
        const storeIds = [
          ...scenario.expectedTopFiveStoreIds,
          ...(scenario.ratingGuards ?? []).map(
            (guard) => guard.weakerHighRatingStoreId
          )
        ].filter(
          (storeId, index, values) =>
            values.indexOf(storeId) === index
        );
        if (scenario.id === "menu-review-fallback") {
          return syntheticResult(scenario, []);
        }
        return syntheticResult(
          scenario,
          storeIds,
          scenario.id === "region-district"
            ? "PARTIAL"
            : undefined
        );
      }
    });

    expect(report.hitRateBasisPoints).toBeGreaterThanOrEqual(8500);
    expect(report.statusViolationCount).toBe(1);
    expect(report.requiredHitViolationCount).toBe(1);
    expect(report.passed).toBe(false);
  });

  it("passes quality, exclusion, fallback, determinism and p95 gates", async () => {
    const database = await createEvaluationDatabase();
    try {
      const version =
        createSqliteStoreSearchRepository(
          database
        ).inspectCurrentSnapshot(
          Date.parse("2026-07-30T12:00:00+09:00")
        ).dataSnapshotVersion;
      const report = runSearchEvaluation({
        fixtureId: searchEvaluationFixture.fixtureId,
        scenarios: searchEvaluationFixture.scenarios,
        dataSnapshotVersion: version,
        recommendationVersion: RECOMMENDATION_VERSION,
        execute: (scenario, input) =>
          executeScenario(database, scenario, input)
      });
      expect(report).toMatchObject({
        fixtureId: "search-evaluation-v1",
        totalScenarioCount: 20,
        hitRateScenarioCount: 18,
        expectedErrorPassCount: 2,
        requiredHitViolationCount: 0,
        hardExclusionViolationCount: 0,
        deterministic: true,
        determinismRuns: 100,
        ratingOnlyInversionCount: 0,
        fallbackPassed: true,
        performanceRuns: 100,
        passed: true
      });
      expect(report.hitRateBasisPoints).toBeGreaterThanOrEqual(8500);
      expect(report.p95Ms).toBeLessThan(1500);
      expect(JSON.stringify(report)).not.toMatch(
        /origin|latitude|longitude|reviewBody|snippet|internalRank|adjustedRating/
      );
    } finally {
      database.close();
    }
  }, 30000);
});
