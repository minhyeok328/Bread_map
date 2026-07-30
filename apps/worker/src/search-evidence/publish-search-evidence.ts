import { createHash } from "node:crypto";
import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  SEARCH_EVIDENCE_VERSION,
  verifiedSearchEvidenceBatchSchema,
  type MenuCategory,
  type VerifiedSearchEvidenceBatch
} from "@bread-map/contracts";
import {
  normalizeSearchText,
  validateBusinessHours
} from "@bread-map/recommendation";

interface NormalizedAlias {
  alias: string;
  normalizedAlias: string;
  source: "MANUAL_VERIFIED";
  evidenceRef: string;
  verifiedAtMs: number;
}

interface NormalizedMenu {
  storeId: string;
  name: string;
  normalizedName: string;
  category: MenuCategory;
  source: "MANUAL_VERIFIED";
  evidenceRef: string;
  verifiedAtMs: number;
  aliases: NormalizedAlias[];
}

interface NormalizedStoreAlias extends NormalizedAlias {
  storeId: string;
  aliasType: "STORE_NAME" | "REGION";
}

interface NormalizedBusinessHour {
  storeId: string;
  weekday: number;
  sequence: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  source: "MANUAL_VERIFIED";
  evidenceRef: string;
  verifiedAtMs: number;
}

interface NormalizedEvidenceBatch {
  catalogPublishId: string;
  contractVersion: typeof SEARCH_EVIDENCE_VERSION;
  menus: NormalizedMenu[];
  storeAliases: NormalizedStoreAlias[];
  businessHours: NormalizedBusinessHour[];
}

interface ActiveCatalogRow {
  publishId: string;
  snapshotId: string;
}

const INTERNAL_STORE_ID_CHUNK_SIZE = 500;

export interface PublishSearchEvidenceOptions {
  appDatabase: AppDatabaseHandle;
  batch: unknown;
  now?: () => number;
}

export interface SearchEvidencePublishSummary {
  publishId: string;
  catalogPublishId: string;
  corpusChecksum: string;
  menuCount: number;
  menuAliasCount: number;
  storeAliasCount: number;
  businessHourCount: number;
  publishedAtMs: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(namespace: string, value: string): string {
  return `${namespace}_${hash(value).slice(0, 24)}`;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function normalizeEvidenceText(
  value: string,
  errorCode: string
): { display: string; compact: string } {
  const display = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const normalized = normalizeSearchText(display);
  if (
    display.length === 0 ||
    display.length > 200 ||
    normalized.normalizedText.length === 0 ||
    normalized.compactKey.length === 0
  ) {
    throw new Error(errorCode);
  }
  return {
    display,
    compact: normalized.compactKey
  };
}

function assertUnique(
  seen: Set<string>,
  key: string
): void {
  if (seen.has(key)) {
    throw new Error("SEARCH_EVIDENCE_DUPLICATE");
  }
  seen.add(key);
}

function assertNoHourOverlap(
  hours: readonly NormalizedBusinessHour[]
): void {
  const byStore = Map.groupBy(hours, (hour) => hour.storeId);
  for (const storeHours of byStore.values()) {
    try {
      validateBusinessHours(
        storeHours.map((hour) => ({
          intervalId: [
            hour.storeId,
            hour.weekday,
            hour.sequence
          ].join(":"),
          weekday: hour.weekday,
          sequence: hour.sequence,
          opensMinute: hour.opensMinute,
          closesMinute: hour.closesMinute,
          closesNextDay: hour.closesNextDay,
          evidenceId: hour.evidenceRef
        }))
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "BUSINESS_HOURS_OVERLAP"
      ) {
        throw new Error("SEARCH_EVIDENCE_HOURS_OVERLAP");
      }
      throw new Error("SEARCH_EVIDENCE_INPUT_INVALID");
    }
  }
}

function normalizeBatch(
  input: VerifiedSearchEvidenceBatch
): NormalizedEvidenceBatch {
  const menuKeys = new Set<string>();
  const storeAliasKeys = new Set<string>();
  const hourKeys = new Set<string>();

  const menus = input.menus.map((menu) => {
    const normalizedName = normalizeEvidenceText(
      menu.name,
      "SEARCH_EVIDENCE_INPUT_INVALID"
    );
    assertUnique(
      menuKeys,
      `${menu.storeId}\u0000${normalizedName.compact}`
    );
    const aliasKeys = new Set<string>([normalizedName.compact]);
    const aliases = menu.aliases
      .map((alias) => {
        const normalizedAlias = normalizeEvidenceText(
          alias.alias,
          "SEARCH_EVIDENCE_INPUT_INVALID"
        );
        assertUnique(aliasKeys, normalizedAlias.compact);
        return {
          alias: normalizedAlias.display,
          normalizedAlias: normalizedAlias.compact,
          source: alias.source,
          evidenceRef: alias.evidenceRef,
          verifiedAtMs: alias.verifiedAtMs
        };
      })
      .sort((left, right) =>
        compareText(left.normalizedAlias, right.normalizedAlias)
      );
    return {
      storeId: menu.storeId,
      name: normalizedName.display,
      normalizedName: normalizedName.compact,
      category: menu.category,
      source: menu.source,
      evidenceRef: menu.evidenceRef,
      verifiedAtMs: menu.verifiedAtMs,
      aliases
    };
  });
  menus.sort(
    (left, right) =>
      compareText(left.storeId, right.storeId) ||
      compareText(left.normalizedName, right.normalizedName)
  );

  const storeAliases = input.storeAliases.map((alias) => {
    const normalizedAlias = normalizeEvidenceText(
      alias.alias,
      "SEARCH_EVIDENCE_INPUT_INVALID"
    );
    assertUnique(
      storeAliasKeys,
      [
        alias.storeId,
        alias.aliasType,
        normalizedAlias.compact
      ].join("\u0000")
    );
    return {
      storeId: alias.storeId,
      aliasType: alias.aliasType,
      alias: normalizedAlias.display,
      normalizedAlias: normalizedAlias.compact,
      source: alias.source,
      evidenceRef: alias.evidenceRef,
      verifiedAtMs: alias.verifiedAtMs
    };
  });
  storeAliases.sort(
    (left, right) =>
      compareText(left.storeId, right.storeId) ||
      compareText(left.aliasType, right.aliasType) ||
      compareText(left.normalizedAlias, right.normalizedAlias)
  );

  const businessHours = input.businessHours.map((hour) => {
    assertUnique(
      hourKeys,
      [hour.storeId, hour.weekday, hour.sequence].join("\u0000")
    );
    return { ...hour };
  });
  businessHours.sort(
    (left, right) =>
      compareText(left.storeId, right.storeId) ||
      left.weekday - right.weekday ||
      left.sequence - right.sequence
  );
  assertNoHourOverlap(businessHours);

  return {
    catalogPublishId: input.catalogPublishId,
    contractVersion: input.contractVersion,
    menus,
    storeAliases,
    businessHours
  };
}

function parseBatch(input: unknown): NormalizedEvidenceBatch {
  const parsed = verifiedSearchEvidenceBatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("SEARCH_EVIDENCE_INPUT_INVALID");
  }
  return normalizeBatch(parsed.data);
}

function loadActiveCatalog(
  database: AppDatabaseHandle
): ActiveCatalogRow | null {
  return (
    (database.client
      .prepare(
        `SELECT
           state.publish_id AS publishId,
           state.snapshot_id AS snapshotId
         FROM catalog_publish_state AS state
         JOIN data_publish AS publish
           ON publish.publish_id = state.publish_id
          AND publish.input_snapshot_id = state.snapshot_id
        WHERE state.state_id = 'active'
          AND publish.status = 'SUCCEEDED'`
      )
      .get() as ActiveCatalogRow | undefined) ?? null
  );
}

function assertCatalogAndStores(
  database: AppDatabaseHandle,
  batch: NormalizedEvidenceBatch
): void {
  const catalog = loadActiveCatalog(database);
  if (
    catalog === null ||
    catalog.publishId !== batch.catalogPublishId
  ) {
    throw new Error("SEARCH_EVIDENCE_CATALOG_MISMATCH");
  }

  const requestedStoreIds = [
    ...new Set([
      ...batch.menus.map((menu) => menu.storeId),
      ...batch.storeAliases.map((alias) => alias.storeId),
      ...batch.businessHours.map((hour) => hour.storeId)
    ])
  ].sort(compareText);
  if (requestedStoreIds.length === 0) {
    return;
  }
  const activeStoreIds = new Set<string>();
  for (
    let offset = 0;
    offset < requestedStoreIds.length;
    offset += INTERNAL_STORE_ID_CHUNK_SIZE
  ) {
    const storeIdChunk = requestedStoreIds.slice(
      offset,
      offset + INTERNAL_STORE_ID_CHUNK_SIZE
    );
    const placeholders = storeIdChunk.map(() => "?").join(",");
    const rows = database.client
      .prepare(
        `SELECT DISTINCT store.store_id AS storeId
         FROM store
         JOIN bakery
           ON bakery.bakery_id = store.bakery_id
         JOIN store_source_link AS link
           ON link.store_id = store.store_id
          AND link.snapshot_id = ?
          WHERE store.store_id IN (${placeholders})
            AND store.catalog_status = 'published'
            AND store.business_status = 'active'
            AND bakery.catalog_status = 'published'
            AND store.normalized_address != ''
            AND store.latitude_e7 IS NOT NULL
            AND store.longitude_e7 IS NOT NULL`
      )
      .all(
        catalog.snapshotId,
        ...storeIdChunk
      ) as Array<{ storeId: string }>;
    rows.forEach((row) => activeStoreIds.add(row.storeId));
  }
  if (activeStoreIds.size !== requestedStoreIds.length) {
    throw new Error("SEARCH_EVIDENCE_STORE_NOT_ACTIVE");
  }
}

function buildSummary(
  batch: NormalizedEvidenceBatch,
  publishedAtMs: number
): SearchEvidencePublishSummary {
  const corpusChecksum = hash(canonicalJson(batch));
  return {
    publishId: `search_evidence_${corpusChecksum.slice(0, 24)}`,
    catalogPublishId: batch.catalogPublishId,
    corpusChecksum,
    menuCount: batch.menus.length,
    menuAliasCount: batch.menus.reduce(
      (total, menu) => total + menu.aliases.length,
      0
    ),
    storeAliasCount: batch.storeAliases.length,
    businessHourCount: batch.businessHours.length,
    publishedAtMs
  };
}

function assertExistingPublish(
  database: AppDatabaseHandle,
  summary: SearchEvidencePublishSummary
): SearchEvidencePublishSummary | null {
  const existing = database.client
    .prepare(
      `SELECT
         input_catalog_publish_id AS catalogPublishId,
         corpus_checksum AS corpusChecksum,
         menu_count AS menuCount,
         menu_alias_count AS menuAliasCount,
         store_alias_count AS storeAliasCount,
         business_hour_count AS businessHourCount,
         published_at_ms AS publishedAtMs
       FROM search_evidence_publish
       WHERE publish_id = ?`
    )
    .get(summary.publishId) as
    | Omit<SearchEvidencePublishSummary, "publishId">
    | undefined;
  if (existing === undefined) {
    return null;
  }
  const existingSummary = {
    publishId: summary.publishId,
    ...existing
  };
  if (
    existingSummary.catalogPublishId !== summary.catalogPublishId ||
    existingSummary.corpusChecksum !== summary.corpusChecksum ||
    existingSummary.menuCount !== summary.menuCount ||
    existingSummary.menuAliasCount !== summary.menuAliasCount ||
    existingSummary.storeAliasCount !== summary.storeAliasCount ||
    existingSummary.businessHourCount !==
      summary.businessHourCount
  ) {
    throw new Error("SEARCH_EVIDENCE_IMMUTABLE_CONFLICT");
  }
  return existingSummary;
}

function insertPublish(
  database: AppDatabaseHandle,
  summary: SearchEvidencePublishSummary
): void {
  database.client
    .prepare(
      `INSERT INTO search_evidence_publish (
         publish_id, input_catalog_publish_id, contract_version,
         status, active_slot, menu_count, store_alias_count,
         menu_alias_count, business_hour_count, corpus_checksum,
         published_at_ms
       ) VALUES (?, ?, ?, 'BUILDING', NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      summary.publishId,
      summary.catalogPublishId,
      SEARCH_EVIDENCE_VERSION,
      summary.menuCount,
      summary.storeAliasCount,
      summary.menuAliasCount,
      summary.businessHourCount,
      summary.corpusChecksum,
      summary.publishedAtMs
    );
}

function insertEvidenceRows(
  database: AppDatabaseHandle,
  batch: NormalizedEvidenceBatch,
  summary: SearchEvidencePublishSummary
): void {
  const insertMenu = database.client.prepare(
    `INSERT INTO menu (
       menu_id, evidence_publish_id, store_id, name, normalized_name,
       category, source, evidence_ref, verified_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMenuAlias = database.client.prepare(
    `INSERT INTO menu_alias (
       alias_id, menu_id, alias, normalized_alias, source,
       evidence_ref, verified_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const menu of batch.menus) {
    const menuId = stableId(
      "menu",
      [
        summary.publishId,
        menu.storeId,
        menu.normalizedName
      ].join("\u0000")
    );
    insertMenu.run(
      menuId,
      summary.publishId,
      menu.storeId,
      menu.name,
      menu.normalizedName,
      menu.category,
      menu.source,
      menu.evidenceRef,
      menu.verifiedAtMs
    );
    for (const alias of menu.aliases) {
      insertMenuAlias.run(
        stableId(
          "menu_alias",
          [menuId, alias.normalizedAlias].join("\u0000")
        ),
        menuId,
        alias.alias,
        alias.normalizedAlias,
        alias.source,
        alias.evidenceRef,
        alias.verifiedAtMs
      );
    }
  }

  const insertStoreAlias = database.client.prepare(
    `INSERT INTO store_alias (
       alias_id, evidence_publish_id, store_id, alias_type, alias,
       normalized_alias, source, evidence_ref, verified_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const alias of batch.storeAliases) {
    insertStoreAlias.run(
      stableId(
        "store_alias",
        [
          summary.publishId,
          alias.storeId,
          alias.aliasType,
          alias.normalizedAlias
        ].join("\u0000")
      ),
      summary.publishId,
      alias.storeId,
      alias.aliasType,
      alias.alias,
      alias.normalizedAlias,
      alias.source,
      alias.evidenceRef,
      alias.verifiedAtMs
    );
  }

  const insertHour = database.client.prepare(
    `INSERT INTO store_business_hour (
       interval_id, evidence_publish_id, store_id, weekday, sequence,
       opens_minute, closes_minute, closes_next_day, source,
       evidence_ref, verified_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const hour of batch.businessHours) {
    insertHour.run(
      stableId(
        "hours",
        [
          summary.publishId,
          hour.storeId,
          hour.weekday,
          hour.sequence
        ].join("\u0000")
      ),
      summary.publishId,
      hour.storeId,
      hour.weekday,
      hour.sequence,
      hour.opensMinute,
      hour.closesMinute,
      hour.closesNextDay ? 1 : 0,
      hour.source,
      hour.evidenceRef,
      hour.verifiedAtMs
    );
  }
}

function activatePublish(
  database: AppDatabaseHandle,
  publishId: string
): void {
  database.client
    .prepare(
      `UPDATE search_evidence_publish
       SET status = 'SUPERSEDED', active_slot = NULL
       WHERE status = 'ACTIVE'
         AND active_slot = 1
         AND publish_id != ?`
    )
    .run(publishId);
  database.client
    .prepare(
      `UPDATE search_evidence_publish
       SET status = 'ACTIVE', active_slot = 1
       WHERE publish_id = ?`
    )
    .run(publishId);
}

export function publishSearchEvidence({
  appDatabase,
  batch: input,
  now = Date.now
}: PublishSearchEvidenceOptions): SearchEvidencePublishSummary {
  const batch = parseBatch(input);
  const nowMs = now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("SEARCH_EVIDENCE_TIME_INVALID");
  }
  assertCatalogAndStores(appDatabase, batch);
  const requestedSummary = buildSummary(batch, nowMs);

  return appDatabase.client.transaction(() => {
    assertCatalogAndStores(appDatabase, batch);
    const existing = assertExistingPublish(
      appDatabase,
      requestedSummary
    );
    const summary = existing ?? requestedSummary;
    if (existing === null) {
      insertPublish(appDatabase, summary);
      insertEvidenceRows(appDatabase, batch, summary);
    }
    activatePublish(appDatabase, summary.publishId);
    return summary;
  })();
}
