import type {
  AppDatabaseHandle
} from "@bread-map/app-db";
import {
  parseStoreDetailPath,
  parseStoreDetailQuery,
  storeDetailResponseSchema,
  type StoreDetailResponse
} from "@bread-map/contracts";
import {
  executeSqliteStoreSearch,
  StoreSearchError
} from "@bread-map/retrieval";
import { jsonError } from "./api-response.js";
import type {
  PrincipalResolver
} from "./authenticated-request.js";
import {
  storeSearchErrorResponse
} from "./search-service.js";

export interface StoreDetailReadInput {
  storeId: string;
  dataSnapshotVersion: string;
  reviewPage: number;
  reviewLimit: number;
  requestTimeMs: number;
}

export interface StoreDetailService {
  get(
    pathInput: unknown,
    queryInput: unknown
  ): StoreDetailResponse | null;
}

export interface StoreDetailServiceDependencies {
  now: () => number;
  loadDetail: (
    input: StoreDetailReadInput
  ) => StoreDetailResponse | null;
}

export interface StoreDetailRouteDependencies {
  resolvePrincipal: PrincipalResolver;
  service: StoreDetailService;
}

interface StoreRow {
  storeId: string;
  bakeryId: string;
  displayName: string;
  normalizedAddress: string;
  seoulDistrict: string;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
  latestVerifiedAtMs: number;
}

interface MenuRow {
  menuId: string;
  name: string;
  category: string;
  source: string;
  verifiedAtMs: number;
}

interface BusinessHourRow {
  intervalId: string;
  weekday: number;
  sequence: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: number;
  source: string;
  verifiedAtMs: number;
}

interface ReviewAggregateRow {
  totalCount: number;
  ratedReviewCount: number;
  ratingSumBasisPoints: number;
}

interface ReviewRow {
  reviewId: string;
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  provider: string;
}

function isSqliteExecutionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("SQLITE_")) ||
      error.message.includes("database connection is not open"))
  );
}

function parseIsoDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    return null;
  }
  return timestamp / 86_400_000;
}

function kstDate(requestTimeMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(requestTimeMs));
  const values = new Map(
    parts.map((part) => [part.type, part.value])
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined
  ) {
    throw new StoreSearchError("SEARCH_INPUT_INVALID");
  }
  return `${year}-${month}-${day}`;
}

function freshnessStatus(
  sourceBasisDate: string,
  requestTimeMs: number
): "CURRENT" | "WARNING" {
  const sourceDay = parseIsoDay(sourceBasisDate);
  const requestDay = parseIsoDay(kstDate(requestTimeMs));
  if (sourceDay === null || requestDay === null) {
    throw new StoreSearchError("SEARCH_DATA_UNAVAILABLE");
  }
  const ageDays = requestDay - sourceDay;
  if (ageDays < 0 || ageDays > 30) {
    throw new StoreSearchError("SEARCH_DATA_STALE");
  }
  return ageDays > 7 ? "WARNING" : "CURRENT";
}

function readSqliteStoreDetail(
  appDatabase: AppDatabaseHandle,
  input: StoreDetailReadInput
): StoreDetailResponse | null {
  try {
    return appDatabase.client.transaction(() => {
      const search = executeSqliteStoreSearch({
        appDatabase,
        requestTimeMs: input.requestTimeMs,
        input: {
          region: null,
          storeName: null,
          menuName: null,
          categories: [],
          openNow: false,
          origin: null,
          maxDistanceM: null,
          reviewEvidenceStatus: "ANY",
          sortMode: "RELEVANCE",
          dataSnapshotVersion: input.dataSnapshotVersion,
          recommendationVersion: "recommendation-v1"
        }
      });
      const selected = search.items.find(
        (item) => item.storeId === input.storeId
      );
      if (selected === undefined) {
        return null;
      }

      const store = appDatabase.client
        .prepare(
          `SELECT
             store_id AS storeId,
             bakery_id AS bakeryId,
             display_name AS displayName,
             normalized_address AS normalizedAddress,
             seoul_district AS seoulDistrict,
             normalized_phone AS normalizedPhone,
             latitude_e7 AS latitudeE7,
             longitude_e7 AS longitudeE7,
             latest_verified_at_ms AS latestVerifiedAtMs
           FROM store
          WHERE store_id = ?
            AND catalog_status = 'published'
            AND business_status = 'active'`
        )
        .get(input.storeId) as StoreRow | undefined;
      if (store === undefined) {
        throw new StoreSearchError("SEARCH_DATA_UNAVAILABLE");
      }

      const evidencePublishId =
        search.metadata.searchEvidencePublishId;
      const menuRows =
        evidencePublishId === null
          ? []
          : (appDatabase.client
              .prepare(
                `SELECT
                   menu_id AS menuId,
                   name,
                   category,
                   source,
                   verified_at_ms AS verifiedAtMs
                 FROM menu
                WHERE evidence_publish_id = ?
                  AND store_id = ?
                ORDER BY normalized_name, menu_id`
              )
              .all(
                evidencePublishId,
                input.storeId
              ) as MenuRow[]);
      const businessHourRows =
        evidencePublishId === null
          ? []
          : (appDatabase.client
              .prepare(
                `SELECT
                   interval_id AS intervalId,
                   weekday,
                   sequence,
                   opens_minute AS opensMinute,
                   closes_minute AS closesMinute,
                   closes_next_day AS closesNextDay,
                   source,
                   verified_at_ms AS verifiedAtMs
                 FROM store_business_hour
                WHERE evidence_publish_id = ?
                  AND store_id = ?
                ORDER BY weekday, sequence, interval_id`
              )
              .all(
                evidencePublishId,
                input.storeId
              ) as BusinessHourRow[]);

      const reviewPublishVersionId =
        search.metadata.reviewPublishVersionId;
      const reviewAggregate =
        reviewPublishVersionId === null
          ? {
              totalCount: 0,
              ratedReviewCount: 0,
              ratingSumBasisPoints: 0
            }
          : (appDatabase.client
              .prepare(
                `SELECT
                   count(*) AS totalCount,
                   count(rating_basis_points) AS ratedReviewCount,
                   coalesce(sum(rating_basis_points), 0)
                     AS ratingSumBasisPoints
                 FROM review_document
                WHERE publish_version_id = ?
                  AND store_id = ?`
              )
              .get(
                reviewPublishVersionId,
                input.storeId
              ) as ReviewAggregateRow);
      const reviewRows =
        reviewPublishVersionId === null
          ? []
          : (appDatabase.client
              .prepare(
                `SELECT
                   review_id AS reviewId,
                   body,
                   rating_basis_points AS ratingBasisPoints,
                   published_date AS publishedDate,
                   provider
                 FROM review_document
                WHERE publish_version_id = ?
                  AND store_id = ?
                ORDER BY published_date DESC, review_id ASC
                LIMIT ? OFFSET ?`
              )
              .all(
                reviewPublishVersionId,
                input.storeId,
                input.reviewLimit,
                (input.reviewPage - 1) * input.reviewLimit
              ) as ReviewRow[]);
      const reviewStatus =
        reviewPublishVersionId === null
          ? "UNAVAILABLE"
          : reviewAggregate.totalCount >= 3
            ? "AVAILABLE"
            : "INSUFFICIENT";
      const averageBasisPoints =
        reviewAggregate.ratedReviewCount === 0
          ? null
          : Math.round(
              reviewAggregate.ratingSumBasisPoints /
                reviewAggregate.ratedReviewCount
            );
      const result = {
        store: {
          ...store,
          openingState: selected.openingState
        },
        menus: {
          status:
            evidencePublishId === null
              ? "UNAVAILABLE"
              : "AVAILABLE",
          items: menuRows.map((row) => ({
            menuId: row.menuId,
            name: row.name,
            category: row.category,
            evidenceId: row.menuId,
            source: row.source,
            verifiedAtMs: row.verifiedAtMs
          }))
        },
        businessHours: {
          status:
            evidencePublishId === null
              ? "UNAVAILABLE"
              : "AVAILABLE",
          items: businessHourRows.map((row) => ({
            intervalId: row.intervalId,
            weekday: row.weekday,
            sequence: row.sequence,
            opensMinute: row.opensMinute,
            closesMinute: row.closesMinute,
            closesNextDay: row.closesNextDay === 1,
            evidenceId: row.intervalId,
            source: row.source,
            verifiedAtMs: row.verifiedAtMs
          }))
        },
        rating: {
          averageBasisPoints,
          ratedReviewCount:
            reviewAggregate.ratedReviewCount,
          totalReviewCount: reviewAggregate.totalCount
        },
        reviews: {
          status: reviewStatus,
          page: input.reviewPage,
          limit: input.reviewLimit,
          totalCount: reviewAggregate.totalCount,
          totalPages: Math.ceil(
            reviewAggregate.totalCount / input.reviewLimit
          ),
          items: reviewRows
        },
        freshness: {
          status: freshnessStatus(
            search.metadata.sourceBasisDate,
            input.requestTimeMs
          ),
          sourceBasisDate: search.metadata.sourceBasisDate
        },
        metadata: {
          dataSnapshotVersion:
            search.metadata.dataSnapshotVersion,
          catalogPublishId: search.metadata.catalogPublishId,
          searchEvidencePublishId: evidencePublishId,
          reviewPublishVersionId,
          recommendationVersion:
            search.metadata.recommendationVersion
        }
      };
      const parsed = storeDetailResponseSchema.safeParse(result);
      if (!parsed.success) {
        throw new StoreSearchError("SEARCH_DATA_UNAVAILABLE");
      }
      return parsed.data;
    })();
  } catch (error) {
    if (error instanceof StoreSearchError) {
      throw error;
    }
    if (isSqliteExecutionError(error)) {
      throw new StoreSearchError(
        "SEARCH_DATABASE_UNAVAILABLE"
      );
    }
    throw error;
  }
}

export function createStoreDetailService(
  dependencies: StoreDetailServiceDependencies
): StoreDetailService {
  return {
    get(pathInput, queryInput) {
      const path = parseStoreDetailPath(pathInput);
      const query = parseStoreDetailQuery(queryInput);

      return dependencies.loadDetail({
        storeId: path.storeId,
        dataSnapshotVersion: query.dataSnapshotVersion,
        reviewPage: query.reviewPage,
        reviewLimit: query.reviewLimit,
        requestTimeMs: dependencies.now()
      });
    }
  };
}

export function createSqliteStoreDetailService(
  appDatabase: AppDatabaseHandle,
  now: () => number = Date.now
): StoreDetailService {
  return createStoreDetailService({
    now,
    loadDetail(input) {
      return readSqliteStoreDetail(appDatabase, input);
    }
  });
}

function strictQueryObject(searchParams: URLSearchParams) {
  const query: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (Object.hasOwn(query, key)) {
      throw new StoreSearchError("SEARCH_INPUT_INVALID");
    }
    query[key] = value;
  }
  return query;
}

export function createStoreDetailRouteHandlers(
  dependencies: StoreDetailRouteDependencies
) {
  return {
    async GET(
      request: Request,
      storeId: string
    ): Promise<Response> {
      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        const detail = dependencies.service.get(
          { storeId },
          strictQueryObject(new URL(request.url).searchParams)
        );

        return detail === null
          ? jsonError(404, "RESOURCE_NOT_FOUND")
          : Response.json(detail);
      } catch (error) {
        return storeSearchErrorResponse(error);
      }
    }
  };
}
