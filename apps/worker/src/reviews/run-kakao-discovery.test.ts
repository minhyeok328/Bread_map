import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import { afterEach, describe, expect, it } from "vitest";
import type {
  KakaoPlaceClient,
  KakaoPlaceDocument,
  KakaoPlacePage
} from "./kakao-place-client.js";
import { KakaoPlaceClientError } from "./kakao-place-client.js";
import {
  projectKakaoObservation,
  runKakaoDiscovery
} from "./run-kakao-discovery.js";
import {
  MAX_DISCOVERY_TILE_DEPTH,
  SEOUL_DISCOVERY_BOUNDS
} from "./seoul-discovery-tiles.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createDatabases(): Promise<{
  appDatabase: AppDatabaseHandle;
  rawDatabase: RawDatabaseHandle;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-kakao-discovery-")
  );
  cleanupPaths.push(directory);
  const appDatabase = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  const rawDatabase = openRawDatabase({
    path: join(directory, "raw.sqlite")
  });
  migrateAppDatabase(appDatabase, resolve("drizzle/app"));
  migrateRawDatabase(rawDatabase, resolve("drizzle/raw"));
  return { appDatabase, rawDatabase };
}

function seedStores(database: AppDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES
         ('bakery_alpha', 'Alpha Bakery', 'alphabakery',
          'published', 0, 0),
         ('bakery_beta', 'Beta Bakery', 'betabakery',
          'excluded', 0, 0)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES
         (
           'store_alpha', 'bakery_alpha', 'Alpha Bakery',
           'alphabakery', 'alphabakery',
           '서울특별시 마포구 Fixture로 1', '마포구', '0200000001',
           375600000, 1269000000, 'active', 'published', 0, 0, 0
         ),
         (
           'store_beta', 'bakery_beta', 'Beta Bakery',
           'betabakery', 'betabakery',
           '서울특별시 마포구 Fixture로 2', '마포구', '0200000002',
           375610000, 1269010000, 'active', 'excluded', 0, 0, 0
         )`
    )
    .run();
}

function place(
  input: Partial<KakaoPlaceDocument> &
    Pick<KakaoPlaceDocument, "id" | "place_name">
): KakaoPlaceDocument {
  return {
    category_name: "음식점 > 간식 > 제과,베이커리",
    phone: "",
    address_name: "",
    road_address_name: "",
    x: "126.95",
    y: "37.57",
    place_url: `https://place.map.kakao.com/${input.id}`,
    ...input
  };
}

const alpha = place({
  id: "place-alpha",
  place_name: "Alpha Bakery",
  phone: "02-0000-0001",
  address_name: "서울특별시 마포구 Fixture로 1",
  road_address_name: "서울특별시 마포구 Fixture로 1",
  x: "126.9",
  y: "37.56"
});
const beta = place({
  id: "place-beta",
  place_name: "Beta Bakery",
  phone: "02-0000-0002",
  address_name: "서울특별시 마포구 Fixture로 2",
  road_address_name: "서울특별시 마포구 Fixture로 2",
  x: "126.901",
  y: "37.561"
});
const unmatched = place({
  id: "place-unmatched",
  place_name: "Gamma Bakery",
  address_name: "서울특별시 마포구 Fixture로 3",
  road_address_name: "서울특별시 마포구 Fixture로 3"
});
const ambiguous = place({
  id: "place-ambiguous",
  place_name: "Alpha Bakery",
  phone: "02-9999-9999",
  address_name: "서울특별시 마포구 Fixture로 1",
  road_address_name: "서울특별시 마포구 Fixture로 1",
  x: "126.9",
  y: "37.56"
});

function page(documents: KakaoPlaceDocument[]): KakaoPlacePage {
  return {
    meta: {
      total_count: documents.length,
      pageable_count: documents.length,
      is_end: true
    },
    documents
  };
}

function createOverlappingTileClient(): KakaoPlaceClient {
  let childIndex = 0;
  const childPages = [
    page([alpha, unmatched]),
    page([
      {
        ...alpha,
        extra_provider_field: "full-response-secret"
      } as KakaoPlaceDocument,
      beta
    ]),
    page([ambiguous]),
    page([])
  ];

  return {
    async searchPage({ rect }): Promise<KakaoPlacePage> {
      if (
        rect.minLongitude === SEOUL_DISCOVERY_BOUNDS.minLongitude &&
        rect.minLatitude === SEOUL_DISCOVERY_BOUNDS.minLatitude &&
        rect.maxLongitude === SEOUL_DISCOVERY_BOUNDS.maxLongitude &&
        rect.maxLatitude === SEOUL_DISCOVERY_BOUNDS.maxLatitude
      ) {
        return {
          meta: {
            total_count: 700,
            pageable_count: 675,
            is_end: false
          },
          documents: []
        };
      }
      const result = childPages[childIndex];
      childIndex += 1;
      if (result === undefined) {
        throw new Error("unexpected fixture request");
      }
      return result;
    }
  };
}

describe("Kakao discovery runner", () => {
  it("uses the catalog canonicalization rules for match fields", () => {
    const observation = projectKakaoObservation({
      ...alpha,
      place_name: "(주) Alpha Bakery",
      phone: "+82 2-1234-5678",
      address_name: "서울시 마포구 Fixture로 1",
      road_address_name: "서울시 마포구 Fixture로 1"
    });

    expect(observation).toMatchObject({
      normalizedName: "alphabakery",
      normalizedAddress: "서울특별시 마포구 Fixture로 1",
      normalizedPhone: "0212345678"
    });
  });

  it("persists complete deduplicated coverage and conservative matches", async () => {
    const { appDatabase, rawDatabase } = await createDatabases();
    const events: unknown[] = [];

    try {
      seedStores(appDatabase);
      const summary = await runKakaoDiscovery({
        appDatabase,
        rawDatabase,
        client: createOverlappingTileClient(),
        runId: "discovery_fixture",
        policySnapshotId: "policy_fixture",
        now: () => 1_000,
        onEvent: (event) => events.push(event)
      });

      expect(summary).toMatchObject({
        status: "COMPLETE",
        observedCount: 4,
        matchedEligibleCount: 1,
        matchedExcludedCount: 1,
        unmatchedCount: 1,
        ambiguousCount: 1
      });

      const observations = rawDatabase.client
        .prepare(
          `SELECT observation_key, display_name, match_status
             FROM kakao_place_observation
            WHERE run_id = ?
            ORDER BY display_name, match_status`
        )
        .all("discovery_fixture") as Array<{
        observation_key: Buffer;
        display_name: string;
        match_status: string;
      }>;
      expect(observations).toHaveLength(4);
      expect(
        rawDatabase.client
          .prepare(
            `SELECT count(*) AS count
               FROM kakao_place_locator
              WHERE observation_id IN (
                SELECT observation_id
                  FROM kakao_place_observation
                 WHERE run_id = ?
              )`
          )
          .get("discovery_fixture")
      ).toEqual({ count: 4 });

      const expectedAlpha = projectKakaoObservation(alpha);
      const storedAlpha = observations.find(
        (item) =>
          item.display_name === "Alpha Bakery" &&
          item.match_status === "MATCHED_ELIGIBLE"
      );
      expect(storedAlpha?.observation_key.equals(
        expectedAlpha.observationKey
      )).toBe(true);

      const storedText = JSON.stringify(
        rawDatabase.client
          .prepare(
            `SELECT display_name, normalized_name, category_name,
                    category_tag, road_address, lot_address, phone,
                    tile_key, match_status, match_signals_json
               FROM kakao_place_observation`
          )
          .all()
      );
      expect(storedText).not.toContain("full-response-secret");
      expect(JSON.stringify(events)).not.toContain(
        "full-response-secret"
      );

      const rerun = await runKakaoDiscovery({
        appDatabase,
        rawDatabase,
        client: createOverlappingTileClient(),
        runId: "discovery_fixture",
        policySnapshotId: "policy_fixture",
        now: () => 2_000
      });
      expect(rerun).toEqual(summary);
      expect(
        rawDatabase.client
          .prepare(
            `SELECT count(*) AS count
               FROM kakao_place_observation
              WHERE run_id = ?`
          )
          .get("discovery_fixture")
      ).toEqual({ count: 4 });

      await runKakaoDiscovery({
        appDatabase,
        rawDatabase,
        client: createOverlappingTileClient(),
        runId: "discovery_fixture_next",
        policySnapshotId: "policy_fixture",
        now: () => 3_000
      });
      expect(
        rawDatabase.client
          .prepare(
            `SELECT run_id, count(*) AS count
               FROM kakao_place_locator locator
               JOIN kakao_place_observation observation
                 ON observation.observation_id =
                   locator.observation_id
              GROUP BY run_id
              ORDER BY run_id`
          )
          .all()
      ).toEqual([
        { run_id: "discovery_fixture", count: 4 },
        { run_id: "discovery_fixture_next", count: 4 }
      ]);
    } finally {
      appDatabase.close();
      rawDatabase.close();
    }
  });

  it("marks a saturated depth-eight tile partial and clears the active slot", async () => {
    const { appDatabase, rawDatabase } = await createDatabases();

    try {
      const summary = await runKakaoDiscovery({
        appDatabase,
        rawDatabase,
        client: {
          async searchPage(): Promise<KakaoPlacePage> {
            return {
              meta: {
                total_count: 700,
                pageable_count: 675,
                is_end: false
              },
              documents: []
            };
          }
        },
        runId: "discovery_saturated",
        policySnapshotId: "policy_fixture",
        rootTile: {
          key: "depth-eight",
          depth: MAX_DISCOVERY_TILE_DEPTH,
          bounds: SEOUL_DISCOVERY_BOUNDS
        },
        now: () => 1_000
      });

      expect(summary).toMatchObject({
        status: "PARTIAL",
        observedCount: 0
      });
      expect(
        rawDatabase.client
          .prepare(
            `SELECT status, active_slot
               FROM kakao_discovery_run
              WHERE run_id = ?`
          )
          .get("discovery_saturated")
      ).toEqual({ status: "PARTIAL", active_slot: null });
    } finally {
      appDatabase.close();
      rawDatabase.close();
    }
  });

  it("stops the run on an access-denied provider response", async () => {
    const { appDatabase, rawDatabase } = await createDatabases();

    try {
      const summary = await runKakaoDiscovery({
        appDatabase,
        rawDatabase,
        client: {
          async searchPage(): Promise<KakaoPlacePage> {
            throw new KakaoPlaceClientError(
              "KAKAO_PLACE_ACCESS_DENIED"
            );
          }
        },
        runId: "discovery_access_denied",
        policySnapshotId: "policy_fixture",
        now: () => 1_000
      });

      expect(summary).toMatchObject({
        status: "STOPPED_ACCESS",
        observedCount: 0
      });
      expect(
        rawDatabase.client
          .prepare(
            `SELECT active_slot
               FROM kakao_discovery_run
              WHERE run_id = ?`
          )
          .get("discovery_access_denied")
      ).toEqual({ active_slot: null });
    } finally {
      appDatabase.close();
      rawDatabase.close();
    }
  });
});
