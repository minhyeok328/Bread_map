import { createHash } from "node:crypto";
import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  kakaoDiscoverySummarySchema,
  type KakaoDiscoverySummary
} from "@bread-map/contracts";
import type { RawDatabaseHandle } from "@bread-map/raw-db";
import {
  normalizeAddress as normalizeCatalogAddress,
  normalizePhone as normalizeCatalogPhone,
  normalizeStoreName
} from "../catalog/normalize-store.js";
import {
  KakaoPlaceClientError,
  type KakaoPlaceClient,
  type KakaoPlaceDocument
} from "./kakao-place-client.js";
import {
  matchKakaoObservation,
  type KakaoMatchStore,
  type KakaoPlaceMatch
} from "./match-kakao-place.js";
import {
  APPROVED_KAKAO_BAKERY_TAG,
  isApprovedBakeryTag,
  normalizeKakaoCategoryTag
} from "./normalize-kakao-category.js";
import {
  DiscoveryTileError,
  createSeoulRootTile,
  splitDiscoveryTile,
  type DiscoveryTile
} from "./seoul-discovery-tiles.js";

const DISCOVERY_PAGE_SIZE = 15 as const;
const DISCOVERY_PAGE_LIMIT = 45;
const DISCOVERY_SATURATION_COUNT =
  DISCOVERY_PAGE_SIZE * DISCOVERY_PAGE_LIMIT;
const OBSERVATION_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const LOCATOR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ProjectedKakaoObservation {
  observationKey: Buffer;
  displayName: string;
  normalizedName: string;
  categoryName: string;
  categoryTag: "제과,베이커리";
  roadAddress: string | null;
  lotAddress: string | null;
  normalizedAddress: string;
  phone: string | null;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
  locator: string;
}

export interface KakaoDiscoveryEvent {
  event: "KAKAO_DISCOVERY_FINISHED";
  runId: string;
  status: KakaoDiscoverySummary["status"];
  observedCount: number;
}

export interface RunKakaoDiscoveryOptions {
  appDatabase: AppDatabaseHandle;
  rawDatabase: RawDatabaseHandle;
  client: KakaoPlaceClient;
  runId: string;
  policySnapshotId: string;
  rootTile?: DiscoveryTile;
  now?: () => number;
  onEvent?: (event: KakaoDiscoveryEvent) => void;
}

interface ExistingDiscoveryRun {
  query: string;
  region_code: string;
  category_tag: string;
  policy_snapshot_id: string;
  status: string;
}

function stableId(namespace: string, input: string): string {
  return `${namespace}_${createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 24)}`;
}

function normalizeDisplayAddress(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function coordinateE7(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("KAKAO_OBSERVATION_INVALID");
  }
  return Math.round(number * 10_000_000);
}

export function projectKakaoObservation(
  document: KakaoPlaceDocument
): ProjectedKakaoObservation {
  const categoryTag = normalizeKakaoCategoryTag(
    document.category_name
  );
  if (categoryTag !== APPROVED_KAKAO_BAKERY_TAG) {
    throw new Error("KAKAO_CATEGORY_NOT_APPROVED");
  }
  const roadAddress =
    document.road_address_name.trim() === ""
      ? null
      : normalizeDisplayAddress(document.road_address_name);
  const lotAddress =
    document.address_name.trim() === ""
      ? null
      : normalizeDisplayAddress(document.address_name);
  const normalizedAddress =
    normalizeCatalogAddress(roadAddress)?.normalizedAddress ??
    normalizeCatalogAddress(lotAddress)?.normalizedAddress ??
    "";

  const normalizedName = normalizeStoreName(
    document.place_name
  ).normalizedName;
  const normalizedPhone = normalizeCatalogPhone(document.phone);
  const latitudeE7 = coordinateE7(document.y);
  const longitudeE7 = coordinateE7(document.x);
  if (
    normalizedName === "" ||
    latitudeE7 < 374000000 ||
    latitudeE7 > 377500000 ||
    longitudeE7 < 1267000000 ||
    longitudeE7 > 1273000000
  ) {
    throw new Error("KAKAO_OBSERVATION_INVALID");
  }
  const canonicalKey = [
    normalizedName,
    normalizedAddress,
    normalizedPhone ?? "",
    String(latitudeE7),
    String(longitudeE7)
  ].join("\u0000");

  return {
    observationKey: createHash("sha256")
      .update(canonicalKey)
      .digest(),
    displayName: document.place_name.normalize("NFKC").trim(),
    normalizedName,
    categoryName: document.category_name.normalize("NFKC").trim(),
    categoryTag: APPROVED_KAKAO_BAKERY_TAG,
    roadAddress,
    lotAddress,
    normalizedAddress,
    phone:
      document.phone.trim() === ""
        ? null
        : document.phone.normalize("NFKC").trim(),
    normalizedPhone,
    latitudeE7,
    longitudeE7,
    locator: document.place_url
  };
}

function loadStores(
  appDatabase: AppDatabaseHandle
): KakaoMatchStore[] {
  return appDatabase.client
    .prepare(
      `SELECT
         store_id AS storeId,
         normalized_name AS normalizedName,
         normalized_address AS normalizedAddress,
         normalized_phone AS normalizedPhone,
         latitude_e7 AS latitudeE7,
         longitude_e7 AS longitudeE7,
         catalog_status AS catalogStatus
       FROM store
       ORDER BY store_id`
    )
    .all() as KakaoMatchStore[];
}

function readSummary(
  rawDatabase: RawDatabaseHandle,
  runId: string,
  status: string
): KakaoDiscoverySummary {
  const counts = rawDatabase.client
    .prepare(
      `SELECT
         count(*) AS observedCount,
         sum(match_status = 'MATCHED_ELIGIBLE') AS matchedEligibleCount,
         sum(match_status = 'MATCHED_EXCLUDED') AS matchedExcludedCount,
         sum(match_status = 'UNMATCHED') AS unmatchedCount,
         sum(match_status = 'AMBIGUOUS') AS ambiguousCount
       FROM kakao_place_observation
       WHERE run_id = ?`
    )
    .get(runId) as {
    observedCount: number;
    matchedEligibleCount: number | null;
    matchedExcludedCount: number | null;
    unmatchedCount: number | null;
    ambiguousCount: number | null;
  };

  return kakaoDiscoverySummarySchema.parse({
    runId,
    status,
    observedCount: counts.observedCount,
    matchedEligibleCount: counts.matchedEligibleCount ?? 0,
    matchedExcludedCount: counts.matchedExcludedCount ?? 0,
    unmatchedCount: counts.unmatchedCount ?? 0,
    ambiguousCount: counts.ambiguousCount ?? 0
  });
}

function persistObservation(
  rawDatabase: RawDatabaseHandle,
  input: {
    runId: string;
    tile: DiscoveryTile;
    pageNumber: number;
    document: KakaoPlaceDocument;
    observation: ProjectedKakaoObservation;
    match: KakaoPlaceMatch;
    nowMs: number;
  }
): void {
  const observationId = stableId(
    "observation",
    `${input.runId}:${input.observation.observationKey.toString("hex")}`
  );
  const locatorId = stableId("locator", observationId);
  const persist = rawDatabase.client.transaction(() => {
    const result = rawDatabase.client
      .prepare(
        `INSERT INTO kakao_place_observation (
           observation_id, run_id, observation_key, display_name,
           normalized_name, category_name, category_tag, road_address,
           lot_address, phone, latitude_e7, longitude_e7, tile_key,
           page_number, match_status, matched_store_id,
           match_signals_json, observed_at_ms, expires_at_ms
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         ON CONFLICT(run_id, observation_key) DO NOTHING`
      )
      .run(
        observationId,
        input.runId,
        input.observation.observationKey,
        input.observation.displayName,
        input.observation.normalizedName,
        input.observation.categoryName,
        input.observation.categoryTag,
        input.observation.roadAddress,
        input.observation.lotAddress,
        input.observation.phone,
        input.observation.latitudeE7,
        input.observation.longitudeE7,
        input.tile.key,
        input.pageNumber,
        input.match.status,
        input.match.storeId,
        JSON.stringify(input.match.signals),
        input.nowMs,
        input.nowMs + OBSERVATION_RETENTION_MS
      );
    if (result.changes === 0) {
      return;
    }
    rawDatabase.client
      .prepare(
        `INSERT INTO kakao_place_locator (
           locator_id, observation_id, provider, place_id, place_url,
           created_at_ms, delete_by_ms
         ) VALUES (?, ?, 'KAKAO', ?, ?, ?, ?)
         ON CONFLICT(observation_id) DO NOTHING`
      )
      .run(
        locatorId,
        observationId,
        input.document.id,
        input.observation.locator,
        input.nowMs,
        input.nowMs + LOCATOR_RETENTION_MS
      );
  });
  persist();
}

function finalStatusForError(error: unknown):
  | "PARTIAL"
  | "STOPPED_ACCESS"
  | "FAILED_FINAL" {
  if (error instanceof KakaoPlaceClientError) {
    if (error.code === "KAKAO_PLACE_ACCESS_DENIED") {
      return "STOPPED_ACCESS";
    }
    if (error.code === "KAKAO_PLACE_NETWORK_ERROR") {
      return "PARTIAL";
    }
  }
  return "FAILED_FINAL";
}

export async function runKakaoDiscovery(
  options: RunKakaoDiscoveryOptions
): Promise<KakaoDiscoverySummary> {
  const now = options.now ?? Date.now;
  const existing = options.rawDatabase.client
    .prepare(
      `SELECT query, region_code, category_tag, policy_snapshot_id,
              status
         FROM kakao_discovery_run
        WHERE run_id = ?`
    )
    .get(options.runId) as ExistingDiscoveryRun | undefined;
  if (existing !== undefined) {
    if (
      existing.query !== "빵집" ||
      existing.region_code !== "SEOUL" ||
      existing.category_tag !== APPROVED_KAKAO_BAKERY_TAG ||
      existing.policy_snapshot_id !== options.policySnapshotId
    ) {
      throw new Error("KAKAO_DISCOVERY_RUN_CONFLICT");
    }
    if (existing.status === "RUNNING") {
      throw new Error("KAKAO_DISCOVERY_ALREADY_RUNNING");
    }
    return readSummary(
      options.rawDatabase,
      options.runId,
      existing.status
    );
  }

  const startedAtMs = now();
  try {
    options.rawDatabase.client
      .prepare(
        `INSERT INTO kakao_discovery_run (
           run_id, query, region_code, category_tag, status, active_slot,
           policy_snapshot_id, started_at_ms, finished_at_ms,
           expires_at_ms
         ) VALUES (
           ?, '빵집', 'SEOUL', ?, 'RUNNING', 1, ?, ?, NULL, ?
         )`
      )
      .run(
        options.runId,
        APPROVED_KAKAO_BAKERY_TAG,
        options.policySnapshotId,
        startedAtMs,
        startedAtMs + OBSERVATION_RETENTION_MS
      );
  } catch {
    throw new Error("KAKAO_DISCOVERY_ACTIVE_RUN_EXISTS");
  }

  const stores = loadStores(options.appDatabase);
  const seenPlaceIds = new Set<string>();
  const queue: DiscoveryTile[] = [
    options.rootTile ?? createSeoulRootTile()
  ];
  let finalStatus: KakaoDiscoverySummary["status"] = "COMPLETE";

  try {
    while (queue.length > 0) {
      const tile = queue.shift();
      if (tile === undefined) {
        break;
      }
      const firstPage = await options.client.searchPage({
        query: "빵집",
        rect: tile.bounds,
        page: 1,
        size: DISCOVERY_PAGE_SIZE
      });
      if (
        firstPage.meta.pageable_count >=
          DISCOVERY_SATURATION_COUNT &&
        !firstPage.meta.is_end
      ) {
        try {
          queue.push(...splitDiscoveryTile(tile));
        } catch (error) {
          if (error instanceof DiscoveryTileError) {
            finalStatus = "PARTIAL";
            continue;
          }
          throw error;
        }
        continue;
      }

      let pageNumber = 1;
      let currentPage = firstPage;
      while (true) {
        for (const document of currentPage.documents) {
          if (seenPlaceIds.has(document.id)) {
            continue;
          }
          seenPlaceIds.add(document.id);
          if (!isApprovedBakeryTag(document.category_name)) {
            continue;
          }
          const observation = projectKakaoObservation(document);
          const match = matchKakaoObservation(observation, stores);
          persistObservation(options.rawDatabase, {
            runId: options.runId,
            tile,
            pageNumber,
            document,
            observation,
            match,
            nowMs: now()
          });
        }
        if (currentPage.meta.is_end) {
          break;
        }
        pageNumber += 1;
        if (pageNumber > DISCOVERY_PAGE_LIMIT) {
          finalStatus = "PARTIAL";
          break;
        }
        currentPage = await options.client.searchPage({
          query: "빵집",
          rect: tile.bounds,
          page: pageNumber,
          size: DISCOVERY_PAGE_SIZE
        });
      }
    }
  } catch (error) {
    finalStatus = finalStatusForError(error);
  }

  const finishedAtMs = now();
  options.rawDatabase.client
    .prepare(
      `UPDATE kakao_discovery_run
          SET status = ?, active_slot = NULL, finished_at_ms = ?
        WHERE run_id = ?`
    )
    .run(finalStatus, finishedAtMs, options.runId);
  const summary = readSummary(
    options.rawDatabase,
    options.runId,
    finalStatus
  );
  options.onEvent?.({
    event: "KAKAO_DISCOVERY_FINISHED",
    runId: options.runId,
    status: summary.status,
    observedCount: summary.observedCount
  });
  return summary;
}
