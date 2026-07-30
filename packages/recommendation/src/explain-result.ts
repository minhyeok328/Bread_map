import {
  menuCategories,
  type RelaxationCode,
  type SearchReasonCode,
  type SearchWarningCode,
  type StructuredSearchItem
} from "@bread-map/contracts";
import { distanceUpperBoundM } from "./derive-candidate.js";
import type {
  MenuFact,
  NormalizedStructuredSearchQuery,
  RankableCandidate
} from "./search-types.js";

function truncatePublicText(
  value: string,
  maximumLength: number
): string {
  if (value.length <= maximumLength) {
    return value;
  }
  const truncated = value.slice(0, maximumLength);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? truncated.slice(0, -1)
    : truncated;
}

function matchesMenu(
  menu: MenuFact,
  query: NormalizedStructuredSearchQuery
): boolean {
  return query.menuTerms.some(
    (term) =>
      menu.normalizedName.includes(term.compactKey) ||
      term.compactKey.includes(menu.normalizedName) ||
      menu.aliases.some(
        (alias) =>
          alias.normalizedAlias.includes(term.compactKey) ||
          term.compactKey.includes(alias.normalizedAlias)
      )
  );
}

function representativeMenus(
  candidate: RankableCandidate,
  query: NormalizedStructuredSearchQuery
): StructuredSearchItem["representativeMenus"] {
  return [...candidate.menus]
    .sort((left, right) => {
      const explicit =
        Number(matchesMenu(right, query)) -
        Number(matchesMenu(left, query));
      const included =
        Number(
          query.includedCategories.includes(right.category)
        ) -
        Number(
          query.includedCategories.includes(left.category)
        );
      return (
        explicit ||
        included ||
        (left.normalizedName < right.normalizedName
          ? -1
          : left.normalizedName > right.normalizedName
            ? 1
            : left.menuId < right.menuId
              ? -1
              : left.menuId > right.menuId
                ? 1
                : 0)
      );
    })
    .slice(0, 3)
    .map((menu) => ({
      menuId: menu.menuId,
      name: truncatePublicText(menu.name, 200),
      category: menu.category,
      evidenceId: menu.evidenceId
    }));
}

function reasonCodes(
  candidate: RankableCandidate,
  query: NormalizedStructuredSearchQuery
): SearchReasonCode[] {
  const reasons: SearchReasonCode[] = [];
  if (candidate.verifiedMenuMatch) {
    reasons.push("MENU_MATCH");
  }
  if (candidate.includedCategoryMatchCount > 0) {
    reasons.push("CATEGORY_MATCH");
  }
  if (candidate.regionMatch) {
    reasons.push("REGION_MATCH");
  }
  if (candidate.storeNameMatch) {
    reasons.push("STORE_NAME_MATCH");
  }
  if (query.openNow && candidate.openingState === "OPEN") {
    reasons.push("OPEN_NOW");
  }
  if (candidate.distanceM !== null) {
    reasons.push("NEARBY");
  }
  if (candidate.usableFtsEvidence) {
    reasons.push("REVIEW_EVIDENCE");
  }
  if (candidate.reviewAggregate.latestPublishedDate !== null) {
    reasons.push("RECENT_REVIEW");
  }
  reasons.push("VERIFIED_DATA");
  return reasons;
}

function warningCodes(
  candidate: RankableCandidate,
  query: NormalizedStructuredSearchQuery,
  ftsAvailable: boolean
): SearchWarningCode[] {
  const warnings: SearchWarningCode[] = [];
  if (candidate.reviewStatus === "INSUFFICIENT") {
    warnings.push("INSUFFICIENT_REVIEWS");
  }
  if (candidate.openingState === "UNKNOWN") {
    warnings.push("OPENING_HOURS_UNKNOWN");
  }
  if (!ftsAvailable && query.menuTerms.length > 0) {
    warnings.push("FTS_UNAVAILABLE");
  }
  return warnings;
}

export function buildPublicSearchItem(
  candidate: RankableCandidate,
  query: NormalizedStructuredSearchQuery,
  ftsAvailable: boolean
): StructuredSearchItem {
  const categories = menuCategories.filter((category) =>
    candidate.menus.some((menu) => menu.category === category)
  );
  return {
    storeId: candidate.storeId,
    bakeryId: candidate.bakeryId,
    displayName: truncatePublicText(candidate.displayName, 200),
    normalizedAddress: truncatePublicText(
      candidate.normalizedAddress,
      500
    ),
    seoulDistrict: candidate.seoulDistrict,
    latitudeE7: candidate.latitudeE7,
    longitudeE7: candidate.longitudeE7,
    distanceUpperBoundM: distanceUpperBoundM(
      candidate.distanceM
    ),
    openingState: candidate.openingState,
    representativeMenus: representativeMenus(candidate, query),
    categories,
    review: {
      status: candidate.reviewStatus,
      count: candidate.reviewAggregate.count,
      latestPublishedDate:
        candidate.reviewAggregate.latestPublishedDate,
      snippet:
        ftsAvailable && candidate.reviewEvidence !== null
          ? truncatePublicText(
              candidate.reviewEvidence.snippet,
              500
            )
          : null
    },
    reasonCodes: reasonCodes(candidate, query),
    warningCodes: warningCodes(
      candidate,
      query,
      ftsAvailable
    )
  };
}

export function buildRelaxationOptions(
  query: NormalizedStructuredSearchQuery,
  resultCount: number
): readonly RelaxationCode[] {
  if (resultCount > 0) {
    return [];
  }
  const options: RelaxationCode[] = [];
  if (query.region !== null || query.maxDistanceM !== null) {
    options.push("EXPAND_REGION_OR_DISTANCE");
  }
  if (query.openNow) {
    options.push("DISABLE_OPEN_NOW");
  }
  if (query.reviewEvidenceStatus === "AVAILABLE") {
    options.push("INCLUDE_INSUFFICIENT_REVIEWS");
  }
  if (query.includedCategories.length > 0) {
    options.push("EXPAND_ADJACENT_CATEGORY");
  }
  return options;
}
