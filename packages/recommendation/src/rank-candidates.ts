import type {
  NormalizedStructuredSearchQuery,
  RankableCandidate,
  ReviewEvidenceFact
} from "./search-types.js";

function ascendingNumber(
  left: number | null,
  right: number | null
): number {
  if (left === null) {
    return right === null ? 0 : 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function descendingNumber(left: number, right: number): number {
  return right - left;
}

function descendingNullableText(
  left: string | null,
  right: string | null
): number {
  if (left === null) {
    return right === null ? 0 : 1;
  }
  if (right === null) {
    return -1;
  }
  return right < left ? -1 : right > left ? 1 : 0;
}

function ascendingText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function openingRank(
  candidate: RankableCandidate
): number {
  return {
    OPEN: 0,
    UNKNOWN: 1,
    CLOSED: 2
  }[candidate.openingState];
}

function compareEvidence(
  left: ReviewEvidenceFact | null,
  right: ReviewEvidenceFact | null
): number {
  if (left === null) {
    return right === null ? 0 : 1;
  }
  if (right === null) {
    return -1;
  }
  return (
    left.termPriority - right.termPriority ||
    left.internalRank - right.internalRank ||
    descendingNullableText(
      left.publishedDate,
      right.publishedDate
    ) ||
    ascendingText(left.reviewId, right.reviewId)
  );
}

function availableReviewCount(
  candidate: RankableCandidate
): number {
  return candidate.reviewStatus === "AVAILABLE"
    ? candidate.reviewAggregate.count
    : 0;
}

function compareSharedRelevance(
  left: RankableCandidate,
  right: RankableCandidate
): number {
  return (
    Number(right.verifiedMenuMatch) -
      Number(left.verifiedMenuMatch) ||
    descendingNumber(
      left.includedCategoryMatchCount,
      right.includedCategoryMatchCount
    ) ||
    Number(right.usableFtsEvidence) -
      Number(left.usableFtsEvidence) ||
    compareEvidence(
      left.usableFtsEvidence ? left.reviewEvidence : null,
      right.usableFtsEvidence ? right.reviewEvidence : null
    ) ||
    descendingNumber(
      availableReviewCount(left),
      availableReviewCount(right)
    ) ||
    descendingNullableText(
      left.reviewStatus === "AVAILABLE"
        ? left.reviewAggregate.latestPublishedDate
        : null,
      right.reviewStatus === "AVAILABLE"
        ? right.reviewAggregate.latestPublishedDate
        : null
    )
  );
}

export function rankCandidates(
  candidates: readonly RankableCandidate[],
  query: NormalizedStructuredSearchQuery
): readonly RankableCandidate[] {
  return [...candidates].sort((left, right) => {
    const shared = compareSharedRelevance(left, right);
    if (shared !== 0) {
      return shared;
    }
    const visitConditions =
      query.sortMode === "DISTANCE"
        ? ascendingNumber(left.distanceM, right.distanceM) ||
          openingRank(left) - openingRank(right)
        : openingRank(left) - openingRank(right) ||
          ascendingNumber(left.distanceM, right.distanceM);
    return (
      visitConditions ||
      descendingNumber(left.completeness, right.completeness) ||
      descendingNumber(
        left.adjustedRating,
        right.adjustedRating
      ) ||
      ascendingText(left.storeId, right.storeId)
    );
  });
}
