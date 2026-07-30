import type {
  FilterReasonCode,
  MenuCategory
} from "@bread-map/contracts";
import type {
  DerivedCandidateFacts,
  NormalizedStructuredSearchQuery,
  RankableCandidate,
  ReviewEvidenceFact
} from "./search-types.js";
import type { NormalizedSearchText } from "./normalize-query.js";

export interface FilterCandidatesOptions {
  candidates: readonly DerivedCandidateFacts[];
  query: NormalizedStructuredSearchQuery;
  reviewEvidenceByStore: ReadonlyMap<
    string,
    ReviewEvidenceFact
  >;
  ftsAvailable: boolean;
}

export interface FilterCandidatesResult {
  candidates: readonly RankableCandidate[];
  reasonCounts: Record<FilterReasonCode, number>;
}

function emptyReasonCounts(): Record<FilterReasonCode, number> {
  return {
    REGION_MISMATCH: 0,
    STORE_NAME_MISMATCH: 0,
    EXCLUDED_CATEGORY: 0,
    INCLUDED_CATEGORY_MISSING: 0,
    NOT_OPEN: 0,
    DISTANCE_EXCEEDED: 0,
    REVIEW_STATUS_MISMATCH: 0,
    MENU_MISMATCH: 0
  };
}

function matches(
  candidateKey: string,
  query: NormalizedSearchText
): boolean {
  return (
    candidateKey.includes(query.compactKey) ||
    query.compactKey.includes(candidateKey)
  );
}

function candidateCategories(
  candidate: DerivedCandidateFacts
): Set<MenuCategory> {
  return new Set(candidate.menus.map((menu) => menu.category));
}

function matchesRegion(
  candidate: DerivedCandidateFacts,
  query: NormalizedStructuredSearchQuery
): boolean {
  if (query.region === null) {
    return false;
  }
  const district = candidate.seoulDistrict.replace(
    /[^\p{L}\p{N}]+/gu,
    ""
  );
  return (
    matches(district, query.region) ||
    candidate.storeAliases.some(
      (alias) =>
        alias.aliasType === "REGION" &&
        matches(alias.normalizedAlias, query.region!)
    )
  );
}

function matchesStoreName(
  candidate: DerivedCandidateFacts,
  query: NormalizedStructuredSearchQuery
): boolean {
  if (query.storeName === null) {
    return false;
  }
  return (
    matches(candidate.normalizedName, query.storeName) ||
    candidate.storeAliases.some(
      (alias) =>
        alias.aliasType === "STORE_NAME" &&
        matches(alias.normalizedAlias, query.storeName!)
    )
  );
}

function matchesVerifiedMenu(
  candidate: DerivedCandidateFacts,
  query: NormalizedStructuredSearchQuery
): boolean {
  if (query.menuTerms.length === 0) {
    return false;
  }
  return candidate.menus.some((menu) =>
    query.menuTerms.some(
      (term) =>
        matches(menu.normalizedName, term) ||
        menu.aliases.some((alias) =>
          matches(alias.normalizedAlias, term)
        )
    )
  );
}

export function filterCandidates({
  candidates,
  query,
  reviewEvidenceByStore,
  ftsAvailable
}: FilterCandidatesOptions): FilterCandidatesResult {
  const reasonCounts = emptyReasonCounts();
  const eligible: RankableCandidate[] = [];

  for (const candidate of candidates) {
    const categories = candidateCategories(candidate);
    const regionMatch = matchesRegion(candidate, query);
    const storeNameMatch = matchesStoreName(candidate, query);
    const verifiedMenuMatch = matchesVerifiedMenu(
      candidate,
      query
    );
    const includedCategoryMatchCount =
      query.includedCategories.filter((category) =>
        categories.has(category)
      ).length;
    const reviewEvidence = ftsAvailable
      ? (reviewEvidenceByStore.get(candidate.storeId) ?? null)
      : null;

    let removalReason: FilterReasonCode | null = null;
    if (query.region !== null && !regionMatch) {
      removalReason = "REGION_MISMATCH";
    } else if (query.storeName !== null && !storeNameMatch) {
      removalReason = "STORE_NAME_MISMATCH";
    } else if (
      query.excludedCategories.some((category) =>
        categories.has(category)
      )
    ) {
      removalReason = "EXCLUDED_CATEGORY";
    } else if (
      query.includedCategories.length > 0 &&
      includedCategoryMatchCount === 0
    ) {
      removalReason = "INCLUDED_CATEGORY_MISSING";
    } else if (
      query.openNow &&
      candidate.openingState !== "OPEN"
    ) {
      removalReason = "NOT_OPEN";
    } else if (
      query.maxDistanceM !== null &&
      (candidate.distanceM === null ||
        candidate.distanceM > query.maxDistanceM)
    ) {
      removalReason = "DISTANCE_EXCEEDED";
    } else if (
      query.reviewEvidenceStatus !== "ANY" &&
      candidate.reviewStatus !== query.reviewEvidenceStatus
    ) {
      removalReason = "REVIEW_STATUS_MISMATCH";
    } else if (
      query.menuTerms.length > 0 &&
      !verifiedMenuMatch &&
      reviewEvidence === null
    ) {
      removalReason = "MENU_MISMATCH";
    }

    if (removalReason !== null) {
      reasonCounts[removalReason] += 1;
      continue;
    }

    eligible.push({
      ...candidate,
      verifiedMenuMatch,
      includedCategoryMatchCount,
      regionMatch,
      storeNameMatch,
      reviewEvidence,
      usableFtsEvidence:
        reviewEvidence !== null &&
        candidate.reviewStatus === "AVAILABLE"
    });
  }
  return { candidates: eligible, reasonCounts };
}
