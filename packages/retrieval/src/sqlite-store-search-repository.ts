import { createHash } from "node:crypto";
import {
  REVIEW_FTS_INDEX_VERSION,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  SEARCH_DATA_VERSION_PREFIX,
  menuCategories,
  type MenuCategory,
  type SearchErrorCode
} from "@bread-map/contracts";
import {
  validateBusinessHours,
  type BusinessHourFact,
  type MenuFact,
  type RecommendationCandidateFacts,
  type StoreAliasFact
} from "@bread-map/recommendation";
import {
  StoreSearchError,
  type LoadSearchSnapshotInput,
  type SearchSnapshotDescriptor,
  type StoreSearchRepository,
  type StoreSearchSnapshot
} from "./store-search-repository.js";

interface ComponentRow {
  catalogPublishId: string;
  catalogSnapshotId: string;
  sourceBasisDate: string;
  sourceDownloadedAtMs: number;
  evidencePublishId: string | null;
  evidenceChecksum: string | null;
  declaredMenuCount: number | null;
  declaredStoreAliasCount: number | null;
  declaredMenuAliasCount: number | null;
  declaredBusinessHourCount: number | null;
  reviewPublishVersionId: string | null;
  reviewChecksum: string | null;
  declaredReviewCount: number | null;
  actualReviewCount: number;
  ftsStateId: string | null;
  ftsIndexVersion: string | null;
  ftsChecksum: string | null;
  declaredFtsCount: number | null;
}

interface SnapshotComponents {
  descriptor: SearchSnapshotDescriptor;
  evidencePublishId: string | null;
  reviewPublishVersionId: string | null;
}

interface BaseStoreRow {
  storeId: string;
  bakeryId: string;
  displayName: string;
  normalizedName: string;
  normalizedAddress: string;
  seoulDistrict: string;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
}

interface CatalogVersionRow extends BaseStoreRow {
  bakeryCatalogStatus: string;
  storeBusinessStatus: string;
  storeCatalogStatus: string;
}

interface MenuRow {
  menuId: string;
  storeId: string;
  name: string;
  normalizedName: string;
  category: string;
}

interface MenuAliasRow {
  aliasId: string;
  menuId: string;
  alias: string;
  normalizedAlias: string;
}

interface StoreAliasRow {
  aliasId: string;
  storeId: string;
  aliasType: string;
  alias: string;
  normalizedAlias: string;
}

interface HourRow {
  intervalId: string;
  storeId: string;
  weekday: number;
  sequence: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: number;
}

interface ReviewAggregateRow {
  storeId: string;
  count: number;
  latestPublishedDate: string | null;
  ratedCount: number;
  ratingSumBasisPoints: number;
}

interface EvidenceCounts {
  menuCount: number;
  storeAliasCount: number;
  menuAliasCount: number;
  businessHourCount: number;
}

interface FtsConsistency {
  documentCount: number;
  ftsDocumentCount: number;
  identityMismatchCount: number;
  nonPublicDocumentCount: number;
}

function isSqliteError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("SQLITE_")) ||
      error.message.includes("database connection is not open"))
  );
}

function safeError(code: SearchErrorCode): StoreSearchError {
  return new StoreSearchError(code);
}

function kstDate(requestTimeMs: number): string {
  if (
    !Number.isSafeInteger(requestTimeMs) ||
    requestTimeMs < 0
  ) {
    throw safeError("SEARCH_INPUT_INVALID");
  }
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
  if (year === undefined || month === undefined || day === undefined) {
    throw safeError("SEARCH_INPUT_INVALID");
  }
  return `${year}-${month}-${day}`;
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
  return timestamp / 86400000;
}

function assertFresh(
  sourceBasisDate: string,
  requestTimeMs: number
): void {
  const sourceDay = parseIsoDay(sourceBasisDate);
  const requestDay = parseIsoDay(kstDate(requestTimeMs));
  if (sourceDay === null || requestDay === null) {
    throw safeError("SEARCH_DATA_UNAVAILABLE");
  }
  const ageDays = requestDay - sourceDay;
  if (ageDays < 0 || ageDays > 30) {
    throw safeError("SEARCH_DATA_STALE");
  }
}

function dataVersion(
  row: ComponentRow,
  catalogChecksum: string
): string {
  const reviewIsConsistent =
    row.reviewPublishVersionId !== null &&
    row.reviewChecksum !== null &&
    row.declaredReviewCount === row.actualReviewCount;
  const ftsComponent =
    reviewIsConsistent &&
    row.ftsStateId !== null &&
    row.ftsIndexVersion === REVIEW_FTS_INDEX_VERSION &&
    row.ftsChecksum === row.reviewChecksum &&
    row.declaredFtsCount === row.actualReviewCount
      ? [
          row.ftsStateId,
          row.ftsIndexVersion,
          row.ftsChecksum
        ]
      : ["NONE", "NONE", "NONE"];
  const tuple = [
    row.catalogPublishId,
    row.catalogSnapshotId,
    row.sourceBasisDate,
    String(row.sourceDownloadedAtMs),
    catalogChecksum,
    row.evidencePublishId ?? "NONE",
    row.evidenceChecksum ?? "NONE",
    reviewIsConsistent
      ? row.reviewPublishVersionId!
      : "NONE",
    reviewIsConsistent ? row.reviewChecksum! : "NONE",
    ...ftsComponent
  ].join("\u0000");
  return `${SEARCH_DATA_VERSION_PREFIX}${createHash("sha256")
    .update(tuple)
    .digest("hex")}`;
}

function isMenuCategory(value: string): value is MenuCategory {
  return (menuCategories as readonly string[]).includes(value);
}

export class SqliteStoreSearchRepository
  implements StoreSearchRepository
{
  readonly #appDatabase: AppDatabaseHandle;

  constructor(appDatabase: AppDatabaseHandle) {
    this.#appDatabase = appDatabase;
  }

  #execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof StoreSearchError) {
        throw error;
      }
      if (isSqliteError(error)) {
        throw safeError("SEARCH_DATABASE_UNAVAILABLE");
      }
      throw error;
    }
  }

  #loadComponentRow(): ComponentRow {
    const row = this.#appDatabase.client
      .prepare(
        `SELECT
           catalog.publish_id AS catalogPublishId,
           catalog.snapshot_id AS catalogSnapshotId,
           catalog.source_basis_date AS sourceBasisDate,
           catalog.source_downloaded_at_ms AS sourceDownloadedAtMs,
           evidence.publish_id AS evidencePublishId,
           evidence.corpus_checksum AS evidenceChecksum,
           evidence.menu_count AS declaredMenuCount,
           evidence.store_alias_count AS declaredStoreAliasCount,
           evidence.menu_alias_count AS declaredMenuAliasCount,
           evidence.business_hour_count
             AS declaredBusinessHourCount,
           review.version_id AS reviewPublishVersionId,
           review.corpus_checksum AS reviewChecksum,
           review.document_count AS declaredReviewCount,
           (
             SELECT count(*)
             FROM review_document AS document
             WHERE document.publish_version_id = review.version_id
           ) AS actualReviewCount,
           fts.state_id AS ftsStateId,
           fts.index_version AS ftsIndexVersion,
           fts.corpus_checksum AS ftsChecksum,
           fts.document_count AS declaredFtsCount
         FROM catalog_publish_state AS catalog
         JOIN data_publish AS publish
           ON publish.publish_id = catalog.publish_id
          AND publish.input_snapshot_id = catalog.snapshot_id
          AND publish.status = 'SUCCEEDED'
         JOIN source_snapshot AS source
           ON source.snapshot_id = catalog.snapshot_id
          AND source.basis_date = catalog.source_basis_date
          AND source.downloaded_at_ms =
            catalog.source_downloaded_at_ms
         LEFT JOIN search_evidence_publish AS evidence
           ON evidence.input_catalog_publish_id = catalog.publish_id
          AND evidence.status = 'ACTIVE'
          AND evidence.active_slot = 1
         LEFT JOIN review_publish_version AS review
           ON review.status = 'ACTIVE'
          AND review.active_slot = 1
         LEFT JOIN fts_index_state AS fts
           ON fts.publish_version_id = review.version_id
          AND fts.status = 'ACTIVE'
          AND fts.active_slot = 1
        WHERE catalog.state_id = 'active'`
      )
      .get() as ComponentRow | undefined;
    if (row === undefined) {
      throw safeError("SEARCH_DATA_UNAVAILABLE");
    }
    return row;
  }

  #catalogChecksum(snapshotId: string): string {
    const rows = this.#appDatabase.client
      .prepare(
        `SELECT DISTINCT
           store.store_id AS storeId,
           store.bakery_id AS bakeryId,
           store.display_name AS displayName,
           store.normalized_name AS normalizedName,
           store.normalized_address AS normalizedAddress,
           store.seoul_district AS seoulDistrict,
           store.normalized_phone AS normalizedPhone,
           store.latitude_e7 AS latitudeE7,
           store.longitude_e7 AS longitudeE7,
           bakery.catalog_status AS bakeryCatalogStatus,
           store.business_status AS storeBusinessStatus,
           store.catalog_status AS storeCatalogStatus
         FROM store
         JOIN bakery
           ON bakery.bakery_id = store.bakery_id
         JOIN store_source_link AS link
           ON link.store_id = store.store_id
          AND link.snapshot_id = ?
        WHERE store.catalog_status = 'published'
          AND store.business_status = 'active'
          AND bakery.catalog_status = 'published'
          AND store.normalized_address != ''
          AND store.latitude_e7 IS NOT NULL
          AND store.longitude_e7 IS NOT NULL
        ORDER BY store.store_id`
      )
      .all(snapshotId) as CatalogVersionRow[];
    const canonicalRows = rows.map((row) => [
      row.storeId,
      row.bakeryId,
      row.displayName,
      row.normalizedName,
      row.normalizedAddress,
      row.seoulDistrict,
      row.normalizedPhone,
      row.latitudeE7,
      row.longitudeE7,
      row.bakeryCatalogStatus,
      row.storeBusinessStatus,
      row.storeCatalogStatus
    ]);
    return createHash("sha256")
      .update(JSON.stringify(canonicalRows))
      .digest("hex");
  }

  #assertEvidenceConsistency(row: ComponentRow): void {
    if (row.evidencePublishId === null) {
      return;
    }
    const counts = this.#appDatabase.client
      .prepare(
        `SELECT
           (
             SELECT count(*) FROM menu
             WHERE evidence_publish_id = ?
           ) AS menuCount,
           (
             SELECT count(*) FROM store_alias
             WHERE evidence_publish_id = ?
           ) AS storeAliasCount,
           (
             SELECT count(*)
             FROM menu_alias AS alias
             JOIN menu
               ON menu.menu_id = alias.menu_id
             WHERE menu.evidence_publish_id = ?
           ) AS menuAliasCount,
           (
             SELECT count(*) FROM store_business_hour
             WHERE evidence_publish_id = ?
           ) AS businessHourCount`
      )
      .get(
        row.evidencePublishId,
        row.evidencePublishId,
        row.evidencePublishId,
        row.evidencePublishId
      ) as EvidenceCounts;
    if (
      counts.menuCount !== row.declaredMenuCount ||
      counts.storeAliasCount !== row.declaredStoreAliasCount ||
      counts.menuAliasCount !== row.declaredMenuAliasCount ||
      counts.businessHourCount !== row.declaredBusinessHourCount
    ) {
      throw safeError("SEARCH_DATA_UNAVAILABLE");
    }
  }

  #hasConsistentFts(row: ComponentRow): boolean {
    if (
      row.reviewPublishVersionId === null ||
      row.reviewChecksum === null ||
      row.declaredReviewCount !== row.actualReviewCount ||
      row.ftsStateId === null ||
      row.ftsIndexVersion !== REVIEW_FTS_INDEX_VERSION ||
      row.ftsChecksum !== row.reviewChecksum ||
      row.declaredFtsCount !== row.actualReviewCount
    ) {
      return false;
    }
    const counts = this.#appDatabase.client
      .prepare(
        `SELECT
           (SELECT count(*) FROM review_document)
             AS documentCount,
           (SELECT count(*) FROM review_fts)
             AS ftsDocumentCount,
           (
             SELECT count(*)
             FROM review_fts AS fts_row
             LEFT JOIN review_document AS document
               ON document.rowid = fts_row.rowid
             WHERE document.rowid IS NULL
                OR fts_row.review_id != document.review_id
                OR fts_row.store_id != document.store_id
                OR fts_row.normalized_body !=
                  document.normalized_body
           ) AS identityMismatchCount,
           (
             SELECT count(*)
             FROM review_document AS document
             LEFT JOIN store
               ON store.store_id = document.store_id
             WHERE store.store_id IS NULL
                OR store.catalog_status != 'published'
                OR store.business_status != 'active'
           ) AS nonPublicDocumentCount`
      )
      .get() as FtsConsistency;
    return (
      counts.documentCount === row.actualReviewCount &&
      counts.ftsDocumentCount === row.actualReviewCount &&
      counts.identityMismatchCount === 0 &&
      counts.nonPublicDocumentCount === 0
    );
  }

  #loadComponents(
    requestTimeMs: number
  ): SnapshotComponents {
    const row = this.#loadComponentRow();
    assertFresh(row.sourceBasisDate, requestTimeMs);
    this.#assertEvidenceConsistency(row);
    const catalogChecksum = this.#catalogChecksum(
      row.catalogSnapshotId
    );
    const reviewIsConsistent =
      row.reviewPublishVersionId !== null &&
      row.reviewChecksum !== null &&
      row.declaredReviewCount === row.actualReviewCount;
    const ftsIsConsistent = this.#hasConsistentFts(row);
    const descriptor: SearchSnapshotDescriptor = {
      dataSnapshotVersion: dataVersion(
        {
          ...row,
          ...(ftsIsConsistent
            ? {}
            : {
                ftsStateId: null,
                ftsIndexVersion: null,
                ftsChecksum: null,
                declaredFtsCount: null
              })
        },
        catalogChecksum
      ),
      catalogPublishId: row.catalogPublishId,
      catalogSnapshotId: row.catalogSnapshotId,
      sourceBasisDate: row.sourceBasisDate,
      searchEvidencePublishId: row.evidencePublishId,
      reviewPublishVersionId: reviewIsConsistent
        ? row.reviewPublishVersionId
        : null,
      ftsIndexVersion: ftsIsConsistent
        ? row.ftsIndexVersion
        : null
    };
    return {
      descriptor,
      evidencePublishId: row.evidencePublishId,
      reviewPublishVersionId: reviewIsConsistent
        ? row.reviewPublishVersionId
        : null
    };
  }

  inspectCurrentSnapshot(
    requestTimeMs: number
  ): SearchSnapshotDescriptor {
    return this.#execute(() =>
      this.#appDatabase.client.transaction(() => {
        return this.#loadComponents(requestTimeMs).descriptor;
      })()
    );
  }

  #loadCandidates(
    components: SnapshotComponents
  ): RecommendationCandidateFacts[] {
    const stores = this.#appDatabase.client
      .prepare(
        `SELECT DISTINCT
           store.store_id AS storeId,
           store.bakery_id AS bakeryId,
           store.display_name AS displayName,
           store.normalized_name AS normalizedName,
           store.normalized_address AS normalizedAddress,
           store.seoul_district AS seoulDistrict,
           store.normalized_phone AS normalizedPhone,
           store.latitude_e7 AS latitudeE7,
           store.longitude_e7 AS longitudeE7
         FROM store
         JOIN bakery
           ON bakery.bakery_id = store.bakery_id
         JOIN store_source_link AS link
           ON link.store_id = store.store_id
          AND link.snapshot_id = ?
        WHERE store.catalog_status = 'published'
          AND store.business_status = 'active'
          AND bakery.catalog_status = 'published'
          AND store.normalized_address != ''
          AND store.latitude_e7 IS NOT NULL
          AND store.longitude_e7 IS NOT NULL
        ORDER BY store.store_id`
      )
      .all(
        components.descriptor.catalogSnapshotId
      ) as BaseStoreRow[];
    const candidateById = new Map<
      string,
      RecommendationCandidateFacts
    >(
      stores.map((store) => [
        store.storeId,
        {
          ...store,
          menus: [],
          storeAliases: [],
          businessHours: [],
          reviewAggregate: {
            count: 0,
            latestPublishedDate: null,
            ratedCount: 0,
            ratingSumBasisPoints: 0
          }
        }
      ])
    );

    if (components.evidencePublishId !== null) {
      const menuRows = this.#appDatabase.client
        .prepare(
          `SELECT
             menu_id AS menuId,
             store_id AS storeId,
             name,
             normalized_name AS normalizedName,
             category
           FROM menu
           WHERE evidence_publish_id = ?
           ORDER BY store_id, normalized_name, menu_id`
        )
        .all(components.evidencePublishId) as MenuRow[];
      const menusById = new Map<string, MenuFact>();
      for (const row of menuRows) {
        const candidate = candidateById.get(row.storeId);
        if (
          candidate === undefined ||
          !isMenuCategory(row.category)
        ) {
          throw safeError("SEARCH_DATA_UNAVAILABLE");
        }
        const menu: MenuFact = {
          menuId: row.menuId,
          name: row.name,
          normalizedName: row.normalizedName,
          category: row.category,
          evidenceId: row.menuId,
          aliases: []
        };
        (candidate.menus as MenuFact[]).push(menu);
        menusById.set(row.menuId, menu);
      }
      const menuAliases = this.#appDatabase.client
        .prepare(
          `SELECT
             alias.alias_id AS aliasId,
             alias.menu_id AS menuId,
             alias.alias,
             alias.normalized_alias AS normalizedAlias
           FROM menu_alias AS alias
           JOIN menu
             ON menu.menu_id = alias.menu_id
           WHERE menu.evidence_publish_id = ?
           ORDER BY alias.menu_id, alias.normalized_alias,
                    alias.alias_id`
        )
        .all(components.evidencePublishId) as MenuAliasRow[];
      for (const alias of menuAliases) {
        const menu = menusById.get(alias.menuId);
        if (menu === undefined) {
          throw safeError("SEARCH_DATA_UNAVAILABLE");
        }
        (menu.aliases as MenuFact["aliases"][number][]).push({
          aliasId: alias.aliasId,
          alias: alias.alias,
          normalizedAlias: alias.normalizedAlias,
          evidenceId: alias.aliasId
        });
      }

      const storeAliases = this.#appDatabase.client
        .prepare(
          `SELECT
             alias_id AS aliasId,
             store_id AS storeId,
             alias_type AS aliasType,
             alias,
             normalized_alias AS normalizedAlias
           FROM store_alias
           WHERE evidence_publish_id = ?
           ORDER BY store_id, alias_type, normalized_alias, alias_id`
        )
        .all(components.evidencePublishId) as StoreAliasRow[];
      for (const alias of storeAliases) {
        const candidate = candidateById.get(alias.storeId);
        if (
          candidate === undefined ||
          (alias.aliasType !== "STORE_NAME" &&
            alias.aliasType !== "REGION")
        ) {
          throw safeError("SEARCH_DATA_UNAVAILABLE");
        }
        (candidate.storeAliases as StoreAliasFact[]).push({
          aliasId: alias.aliasId,
          aliasType: alias.aliasType,
          alias: alias.alias,
          normalizedAlias: alias.normalizedAlias,
          evidenceId: alias.aliasId
        });
      }

      const hourRows = this.#appDatabase.client
        .prepare(
          `SELECT
             interval_id AS intervalId,
             store_id AS storeId,
             weekday,
             sequence,
             opens_minute AS opensMinute,
             closes_minute AS closesMinute,
             closes_next_day AS closesNextDay
           FROM store_business_hour
           WHERE evidence_publish_id = ?
           ORDER BY store_id, weekday, sequence, interval_id`
        )
        .all(components.evidencePublishId) as HourRow[];
      for (const row of hourRows) {
        const candidate = candidateById.get(row.storeId);
        if (
          candidate === undefined ||
          (row.closesNextDay !== 0 && row.closesNextDay !== 1)
        ) {
          throw safeError("SEARCH_DATA_UNAVAILABLE");
        }
        (candidate.businessHours as BusinessHourFact[]).push({
          intervalId: row.intervalId,
          weekday: row.weekday,
          sequence: row.sequence,
          opensMinute: row.opensMinute,
          closesMinute: row.closesMinute,
          closesNextDay: row.closesNextDay === 1,
          evidenceId: row.intervalId
        });
      }
    }

    if (components.reviewPublishVersionId !== null) {
      const aggregates = this.#appDatabase.client
        .prepare(
          `SELECT
             document.store_id AS storeId,
             count(*) AS count,
             max(document.published_date)
               AS latestPublishedDate,
             count(document.rating_basis_points) AS ratedCount,
             coalesce(sum(document.rating_basis_points), 0)
               AS ratingSumBasisPoints
           FROM review_document AS document
           WHERE document.publish_version_id = ?
           GROUP BY document.store_id
           ORDER BY document.store_id`
        )
        .all(
          components.reviewPublishVersionId
        ) as ReviewAggregateRow[];
      for (const aggregate of aggregates) {
        const candidate = candidateById.get(aggregate.storeId);
        if (candidate !== undefined) {
          candidate.reviewAggregate = {
            count: aggregate.count,
            latestPublishedDate:
              aggregate.latestPublishedDate,
            ratedCount: aggregate.ratedCount,
            ratingSumBasisPoints:
              aggregate.ratingSumBasisPoints
          };
        }
      }
    }

    const candidates = [...candidateById.values()];
    for (const candidate of candidates) {
      try {
        validateBusinessHours(candidate.businessHours);
      } catch {
        throw safeError("SEARCH_DATA_UNAVAILABLE");
      }
    }
    return candidates;
  }

  loadSnapshot(
    input: LoadSearchSnapshotInput
  ): StoreSearchSnapshot {
    return this.#execute(() =>
      this.#appDatabase.client.transaction(() => {
        const components = this.#loadComponents(
          input.requestTimeMs
        );
        if (
          input.expectedDataSnapshotVersion !==
          components.descriptor.dataSnapshotVersion
        ) {
          throw safeError("SEARCH_DATA_VERSION_MISMATCH");
        }
        return {
          descriptor: components.descriptor,
          candidates: this.#loadCandidates(components)
        };
      })()
    );
  }
}

export function createSqliteStoreSearchRepository(
  appDatabase: AppDatabaseHandle
): StoreSearchRepository {
  return new SqliteStoreSearchRepository(appDatabase);
}

export function runSqliteSearchReadTransaction<T>(
  appDatabase: AppDatabaseHandle,
  operation: () => T
): T {
  return appDatabase.client.transaction(operation)();
}
