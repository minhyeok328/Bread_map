import { createHash } from "node:crypto";
import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  brandEligibilityEvidenceSchema,
  catalogPublishSummarySchema,
  STORE_ELIGIBILITY_VERSION,
  STORE_MATCHER_VERSION,
  STORE_NORMALIZATION_VERSION,
  type BrandEligibilityEvidence,
  type CanonicalStoreCandidate,
  type CatalogPublishSummary,
  type EligibilityDecision,
  type NormalizedStoreCandidate
} from "@bread-map/contracts";
import { classifyEligibility } from "./classify-eligibility.js";
import { deduplicateStores } from "./deduplicate-stores.js";
import {
  normalizeStore,
  type StoreNormalizationInput
} from "./normalize-store.js";

interface StagingStoreRow {
  record_id: string;
  snapshot_id: string;
  source_row_id: string;
  mng_no: string;
  business_name: string;
  road_name_address: string | null;
  lot_number_address: string | null;
  source_coordinate_x: string | null;
  source_coordinate_y: string | null;
  business_status_code: string;
  business_status_name: string;
  detailed_business_status_code: string | null;
  detailed_business_status_name: string | null;
  closed_date: string | null;
}

interface ClassifiedBrand {
  bakeryId: string;
  displayName: string;
  normalizedName: string;
  stores: CanonicalStoreCandidate[];
  decision: EligibilityDecision;
}

interface ReconciledStores {
  stores: CanonicalStoreCandidate[];
  conflictingExistingStoreIds: string[];
}

export interface PublishCatalogOptions {
  appDatabase: AppDatabaseHandle;
  snapshotId: string;
  brandEvidence: readonly BrandEligibilityEvidence[];
  now?: () => number;
}

function stableId(namespace: string, input: string): string {
  return `${namespace}_${createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 24)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertPublishableSnapshot(
  database: AppDatabaseHandle,
  snapshotId: string
): void {
  const run = database.client
    .prepare(
      `SELECT status
       FROM ingestion_run
       WHERE snapshot_id = ?
       ORDER BY finished_at_ms DESC
       LIMIT 1`
    )
    .get(snapshotId) as { status: string } | undefined;
  if (run?.status !== "SUCCEEDED") {
    throw new Error("CATALOG_SNAPSHOT_NOT_SUCCEEDED");
  }
}

function toNormalizationInput(
  row: StagingStoreRow
): StoreNormalizationInput {
  return {
    snapshotId: row.snapshot_id,
    sourceRecordId: row.record_id,
    sourceRowId: row.source_row_id,
    managementNumber: row.mng_no,
    businessName: row.business_name,
    roadNameAddress: row.road_name_address,
    lotNumberAddress: row.lot_number_address,
    phone: null,
    sourceCoordinateX: row.source_coordinate_x,
    sourceCoordinateY: row.source_coordinate_y,
    businessStatusCode: row.business_status_code,
    businessStatusName: row.business_status_name,
    detailedBusinessStatusCode:
      row.detailed_business_status_code,
    detailedBusinessStatusName:
      row.detailed_business_status_name,
    closedDate: row.closed_date
  };
}

function loadNormalizedCandidates(
  database: AppDatabaseHandle,
  snapshotId: string
): NormalizedStoreCandidate[] {
  const rows = database.client
    .prepare(
      `SELECT
         record_id, snapshot_id, source_row_id, mng_no,
         business_name, road_name_address, lot_number_address,
         source_coordinate_x, source_coordinate_y,
         business_status_code, business_status_name,
         detailed_business_status_code,
         detailed_business_status_name, closed_date
       FROM localdata_bakery_record
       WHERE snapshot_id = ?
       ORDER BY record_id`
    )
    .all(snapshotId) as StagingStoreRow[];
  if (rows.length === 0) {
    throw new Error("CATALOG_STAGING_EMPTY");
  }

  return rows.map((row) => {
    const result = normalizeStore(toNormalizationInput(row));
    if (!result.accepted) {
      throw new Error(
        `CATALOG_NORMALIZATION_BLOCKED:${result.reasonCodes.join(",")}`
      );
    }
    return result.value;
  });
}

function evidenceForUnassignedStore(
  store: CanonicalStoreCandidate
): BrandEligibilityEvidence {
  return brandEligibilityEvidenceSchema.parse({
    brandKey: `unreviewed-${store.storeId}`,
    displayName: store.displayName,
    sourceManagementNumbers: store.sourceManagementNumbers,
    ftcStatus: "unavailable",
    ftcEvidenceRefs: [],
    operatorEvidenceRefs: [],
    independenceEvidenceRefs: [],
    adminReviewStatus: "pending",
    adminEvidenceRefs: []
  });
}

function normalizedBakeryName(
  stores: readonly CanonicalStoreCandidate[]
): string {
  return (
    stores[0]?.normalizedBrandName ??
    stores[0]?.normalizedName ??
    "unknown"
  );
}

function reconcileExistingStoreIds(
  database: AppDatabaseHandle,
  stores: readonly CanonicalStoreCandidate[]
): ReconciledStores {
  const existingIdsByStore = stores.map((store) => {
    const placeholders = store.sourceManagementNumbers
      .map(() => "?")
      .join(", ");
    const rows = database.client
      .prepare(
        `SELECT DISTINCT link.store_id
         FROM store_source_link link
         JOIN localdata_bakery_record source
           ON source.record_id = link.source_record_id
         WHERE source.mng_no IN (${placeholders})
         ORDER BY link.store_id`
      )
      .all(...store.sourceManagementNumbers) as Array<{
      store_id: string;
    }>;
    return rows.map((row) => row.store_id);
  });
  const existingIdUseCounts = new Map<string, number>();
  for (const existingIds of existingIdsByStore) {
    for (const existingId of existingIds) {
      existingIdUseCounts.set(
        existingId,
        (existingIdUseCounts.get(existingId) ?? 0) + 1
      );
    }
  }
  const conflictingExistingStoreIds = new Set<string>();
  const reconciled = stores.map((store, index) => {
    const existingIds = existingIdsByStore[index] ?? [];
    if (
      existingIds.length === 1 &&
      existingIdUseCounts.get(existingIds[0]!) === 1
    ) {
      return { ...store, storeId: existingIds[0]! };
    }
    if (existingIds.length === 0) {
      return store;
    }
    existingIds.forEach((storeId) =>
      conflictingExistingStoreIds.add(storeId)
    );
    return {
      ...store,
      mergeStatus: "admin_review" as const,
      reviewReasonCodes: [
        ...new Set([
          ...store.reviewReasonCodes,
          "EXISTING_STORE_ID_CONFLICT"
        ])
      ].sort()
    };
  });

  return {
    stores: reconciled,
    conflictingExistingStoreIds: [
      ...conflictingExistingStoreIds
    ].sort()
  };
}

function classifyBrands(
  stores: readonly CanonicalStoreCandidate[],
  inputEvidence: readonly BrandEligibilityEvidence[]
): ClassifiedBrand[] {
  const evidence = inputEvidence
    .map((item) => brandEligibilityEvidenceSchema.parse(item))
    .sort((left, right) =>
      left.brandKey.localeCompare(right.brandKey)
    );
  const assignedStoreIds = new Set<string>();
  const assignedManagementNumbers = new Set<string>();
  const classified: ClassifiedBrand[] = [];

  for (const item of evidence) {
    for (const managementNumber of item.sourceManagementNumbers) {
      if (assignedManagementNumbers.has(managementNumber)) {
        throw new Error("CATALOG_BRAND_EVIDENCE_OVERLAP");
      }
      assignedManagementNumbers.add(managementNumber);
    }
    const managementNumbers = new Set(
      item.sourceManagementNumbers
    );
    const selectedStores = stores.filter((store) =>
      store.sourceManagementNumbers.some((number) =>
        managementNumbers.has(number)
      )
    );
    if (selectedStores.length === 0) {
      throw new Error("CATALOG_BRAND_EVIDENCE_TARGET_NOT_FOUND");
    }
    const apparentBrandNames = new Set(
      selectedStores.map((store) => store.normalizedBrandName)
    );
    const brandStores = stores.filter((store) =>
      apparentBrandNames.has(store.normalizedBrandName)
    );
    if (
      brandStores.some((store) =>
        assignedStoreIds.has(store.storeId)
      )
    ) {
      throw new Error("CATALOG_STORE_ASSIGNED_TO_MULTIPLE_BRANDS");
    }
    brandStores.forEach((store) =>
      assignedStoreIds.add(store.storeId)
    );

    const bakeryId = stableId(
      "bakery",
      `${STORE_ELIGIBILITY_VERSION}:${item.brandKey}`
    );
    classified.push({
      bakeryId,
      displayName: item.displayName,
      normalizedName: normalizedBakeryName(brandStores),
      stores: [...brandStores].sort((left, right) =>
        left.storeId.localeCompare(right.storeId)
      ),
      decision: classifyEligibility({
        bakeryId,
        stores: brandStores,
        evidence: item
      })
    });
  }

  for (const store of stores) {
    if (assignedStoreIds.has(store.storeId)) {
      continue;
    }
    const item = evidenceForUnassignedStore(store);
    const bakeryId = stableId(
      "bakery",
      `${STORE_ELIGIBILITY_VERSION}:${item.brandKey}`
    );
    classified.push({
      bakeryId,
      displayName: item.displayName,
      normalizedName: store.normalizedBrandName,
      stores: [store],
      decision: classifyEligibility({
        bakeryId,
        stores: [store],
        evidence: item
      })
    });
  }

  return classified.sort((left, right) =>
    left.bakeryId.localeCompare(right.bakeryId)
  );
}

function catalogStatusForDecision(
  status: EligibilityDecision["status"]
): "published" | "excluded" | "admin_review" {
  if (status === "eligible") {
    return "published";
  }
  return status;
}

function persistBakery(
  database: AppDatabaseHandle,
  brand: ClassifiedBrand,
  nowMs: number
): void {
  database.client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(bakery_id) DO UPDATE SET
         display_name = excluded.display_name,
         normalized_name = excluded.normalized_name,
         catalog_status = excluded.catalog_status,
         updated_at_ms = excluded.updated_at_ms`
    )
    .run(
      brand.bakeryId,
      brand.displayName,
      brand.normalizedName,
      catalogStatusForDecision(brand.decision.status),
      nowMs,
      nowMs
    );
}

function persistStore(
  database: AppDatabaseHandle,
  brand: ClassifiedBrand,
  store: CanonicalStoreCandidate,
  candidatesById: ReadonlyMap<string, NormalizedStoreCandidate>,
  snapshotId: string,
  nowMs: number
): void {
  const catalogStatus = catalogStatusForDecision(
    brand.decision.status
  );
  database.client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(store_id) DO UPDATE SET
         bakery_id = excluded.bakery_id,
         display_name = excluded.display_name,
         normalized_name = excluded.normalized_name,
         normalized_brand_name = excluded.normalized_brand_name,
         normalized_address = excluded.normalized_address,
         seoul_district = excluded.seoul_district,
         normalized_phone = excluded.normalized_phone,
         latitude_e7 = excluded.latitude_e7,
         longitude_e7 = excluded.longitude_e7,
         business_status = excluded.business_status,
         catalog_status = excluded.catalog_status,
         latest_verified_at_ms = excluded.latest_verified_at_ms,
         updated_at_ms = excluded.updated_at_ms`
    )
    .run(
      store.storeId,
      brand.bakeryId,
      store.displayName,
      store.normalizedName,
      store.normalizedBrandName,
      store.normalizedAddress,
      store.seoulDistrict,
      store.normalizedPhone,
      store.coordinates?.latitudeE7 ?? null,
      store.coordinates?.longitudeE7 ?? null,
      store.businessStatus,
      catalogStatus,
      nowMs,
      nowMs,
      nowMs
    );

  for (const candidateId of store.sourceCandidateIds) {
    const candidate = candidatesById.get(candidateId);
    if (candidate === undefined) {
      throw new Error("CATALOG_SOURCE_CANDIDATE_NOT_FOUND");
    }
    database.client
      .prepare(
        `INSERT INTO store_source_link (
           link_id, store_id, source_record_id, source_row_id,
           snapshot_id, source_type, linked_at_ms
         ) VALUES (?, ?, ?, ?, ?, 'LOCALDATA', ?)
         ON CONFLICT(source_record_id) DO UPDATE SET
           store_id = excluded.store_id,
           source_row_id = excluded.source_row_id,
           snapshot_id = excluded.snapshot_id,
           linked_at_ms = excluded.linked_at_ms`
      )
      .run(
        stableId("link", candidate.sourceRecordId),
        store.storeId,
        candidate.sourceRecordId,
        candidate.sourceRowId,
        snapshotId,
        nowMs
      );
  }
}

function persistDecision(
  database: AppDatabaseHandle,
  brand: ClassifiedBrand,
  store: CanonicalStoreCandidate,
  snapshotId: string,
  nowMs: number
): void {
  const decisionRowId = stableId(
    "store_decision",
    `${snapshotId}:${brand.decision.decisionId}:${store.storeId}`
  );
  database.client
    .prepare(
      `INSERT INTO eligibility_decision (
         decision_id, decision_group_id, snapshot_id, bakery_id,
         store_id, classification, status, reasons_json,
         rule_version, decided_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(snapshot_id, store_id, rule_version) DO UPDATE SET
         decision_group_id = excluded.decision_group_id,
         bakery_id = excluded.bakery_id,
         classification = excluded.classification,
         status = excluded.status,
         reasons_json = excluded.reasons_json,
         decided_at_ms = excluded.decided_at_ms`
    )
    .run(
      decisionRowId,
      brand.decision.decisionId,
      snapshotId,
      brand.bakeryId,
      store.storeId,
      brand.decision.classification,
      brand.decision.status,
      canonicalJson(brand.decision.reasons),
      brand.decision.ruleVersion,
      nowMs
    );
}

function persistManualReview(
  database: AppDatabaseHandle,
  brand: ClassifiedBrand,
  store: CanonicalStoreCandidate,
  snapshotId: string,
  nowMs: number
): void {
  if (brand.decision.status !== "admin_review") {
    const resolvedStatus =
      brand.decision.status === "eligible" ? "approved" : "rejected";
    database.client
      .prepare(
        `UPDATE manual_review
         SET status = ?, decision = ?, decided_at_ms = ?
         WHERE snapshot_id = ?
           AND target_type = 'store'
           AND target_id = ?
           AND review_type = 'eligibility'
           AND review_version = ?`
      )
      .run(
        resolvedStatus,
        brand.decision.status,
        nowMs,
        snapshotId,
        store.storeId,
        brand.decision.ruleVersion
      );
    return;
  }

  const evidenceRefs = [
    ...new Set(
      brand.decision.reasons.flatMap(
        (item) => item.evidenceRefs
      )
    )
  ].sort();
  database.client
    .prepare(
      `INSERT INTO manual_review (
         manual_review_id, snapshot_id, target_type, target_id,
         review_type, status, decision, evidence_refs_json,
         review_version, created_at_ms, decided_at_ms
       ) VALUES (?, ?, 'store', ?, 'eligibility', 'open', NULL,
         ?, ?, ?, NULL)
       ON CONFLICT(
         snapshot_id, target_type, target_id, review_type, review_version
       ) DO UPDATE SET
         status = 'open',
         decision = NULL,
         evidence_refs_json = excluded.evidence_refs_json,
         decided_at_ms = NULL`
    )
    .run(
      stableId(
        "manual_review",
        [
          snapshotId,
          store.storeId,
          brand.decision.ruleVersion
        ].join(":")
      ),
      snapshotId,
      store.storeId,
      canonicalJson(evidenceRefs),
      brand.decision.ruleVersion,
      nowMs
    );
}

function persistMatches(
  database: AppDatabaseHandle,
  snapshotId: string,
  candidates: readonly NormalizedStoreCandidate[],
  matches: ReturnType<typeof deduplicateStores>["matches"],
  nowMs: number
): void {
  const candidatesById = new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ])
  );
  for (const match of matches) {
    const left = candidatesById.get(match.leftCandidateId);
    const right = candidatesById.get(match.rightCandidateId);
    if (left === undefined || right === undefined) {
      throw new Error("CATALOG_MATCH_SOURCE_NOT_FOUND");
    }
    database.client
      .prepare(
        `INSERT INTO match_candidate (
           match_id, snapshot_id, left_candidate_id,
           right_candidate_id, left_source_record_id,
           right_source_record_id, score_basis_points, signals_json,
           matcher_version, status, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(
           snapshot_id, left_candidate_id, right_candidate_id,
           matcher_version
         ) DO UPDATE SET
           score_basis_points = excluded.score_basis_points,
           signals_json = excluded.signals_json,
           status = excluded.status,
           created_at_ms = excluded.created_at_ms`
      )
      .run(
        match.matchId,
        snapshotId,
        match.leftCandidateId,
        match.rightCandidateId,
        left.sourceRecordId,
        right.sourceRecordId,
        match.scoreBasisPoints,
        canonicalJson(match.evidence),
        match.matcherVersion,
        match.status,
        nowMs
      );
  }
}

function holdConflictingExistingStores(
  database: AppDatabaseHandle,
  storeIds: readonly string[],
  nowMs: number
): void {
  for (const storeId of storeIds) {
    database.client
      .prepare(
        `UPDATE store
         SET catalog_status = 'admin_review', updated_at_ms = ?
         WHERE store_id = ?`
      )
      .run(nowMs, storeId);
  }
}

function persistPublish(
  database: AppDatabaseHandle,
  summary: CatalogPublishSummary,
  nowMs: number
): void {
  database.client
    .prepare(
      `INSERT INTO data_publish (
         publish_id, input_snapshot_id, normalization_version,
         matcher_version, eligibility_version, status,
         candidate_count, published_count, excluded_count,
         admin_review_count, published_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(
         input_snapshot_id, normalization_version, matcher_version,
         eligibility_version
       ) DO UPDATE SET
         status = excluded.status,
         candidate_count = excluded.candidate_count,
         published_count = excluded.published_count,
         excluded_count = excluded.excluded_count,
         admin_review_count = excluded.admin_review_count,
         published_at_ms = excluded.published_at_ms`
    )
    .run(
      summary.publishId,
      summary.snapshotId,
      summary.normalizationVersion,
      summary.matcherVersion,
      summary.eligibilityVersion,
      summary.status,
      summary.candidateCount,
      summary.publishedCount,
      summary.excludedCount,
      summary.adminReviewCount,
      nowMs
    );
}

export function publishCatalog({
  appDatabase,
  snapshotId,
  brandEvidence,
  now = Date.now
}: PublishCatalogOptions): CatalogPublishSummary {
  assertPublishableSnapshot(appDatabase, snapshotId);
  const candidates = loadNormalizedCandidates(
    appDatabase,
    snapshotId
  );
  const deduplicated = deduplicateStores(candidates);
  const reconciled = reconcileExistingStoreIds(
    appDatabase,
    deduplicated.stores
  );
  const classifiedBrands = classifyBrands(
    reconciled.stores,
    brandEvidence
  );
  const counts = classifiedBrands.reduce(
    (total, brand) => {
      total[
        brand.decision.status === "eligible"
          ? "publishedCount"
          : brand.decision.status === "excluded"
            ? "excludedCount"
            : "adminReviewCount"
      ] += brand.stores.length;
      return total;
    },
    {
      publishedCount: 0,
      excludedCount: 0,
      adminReviewCount: 0
    }
  );
  const publishId = stableId(
    "publish",
    [
      snapshotId,
      STORE_NORMALIZATION_VERSION,
      STORE_MATCHER_VERSION,
      STORE_ELIGIBILITY_VERSION
    ].join(":")
  );
  const summary = catalogPublishSummarySchema.parse({
    publishId,
    snapshotId,
    status: "SUCCEEDED",
    candidateCount: reconciled.stores.length,
    ...counts,
    normalizationVersion: STORE_NORMALIZATION_VERSION,
    matcherVersion: STORE_MATCHER_VERSION,
    eligibilityVersion: STORE_ELIGIBILITY_VERSION
  });
  const candidatesById = new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ])
  );
  const nowMs = now();

  appDatabase.client.transaction(() => {
    holdConflictingExistingStores(
      appDatabase,
      reconciled.conflictingExistingStoreIds,
      nowMs
    );
    persistMatches(
      appDatabase,
      snapshotId,
      candidates,
      deduplicated.matches,
      nowMs
    );
    for (const brand of classifiedBrands) {
      persistBakery(appDatabase, brand, nowMs);
      for (const store of brand.stores) {
        persistStore(
          appDatabase,
          brand,
          store,
          candidatesById,
          snapshotId,
          nowMs
        );
        persistDecision(
          appDatabase,
          brand,
          store,
          snapshotId,
          nowMs
        );
        persistManualReview(
          appDatabase,
          brand,
          store,
          snapshotId,
          nowMs
        );
      }
    }
    persistPublish(appDatabase, summary, nowMs);
  })();

  return summary;
}
