import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  RATING_PRIOR_VERSION,
  RECOMMENDATION_VERSION,
  SEARCH_ALIAS_VERSION,
  SEARCH_CONTRACT_VERSION,
  SEARCH_REVIEW_FTS_INDEX_VERSION,
  structuredSearchInputSchema,
  structuredSearchResultSchema,
  type StructuredSearchInput,
  type StructuredSearchResult
} from "@bread-map/contracts";
import {
  buildPublicSearchItem,
  buildRelaxationOptions,
  calculateAdjustedRating,
  calculateCompleteness,
  calculateGlobalRatingMean,
  calculateRoundedDistanceM,
  deriveOpeningState,
  deriveReviewStatus,
  filterCandidates,
  normalizeStructuredSearchQuery,
  rankCandidates,
  type DerivedCandidateFacts,
  type RecommendationCandidateFacts,
  type ReviewEvidenceFact
} from "@bread-map/recommendation";
import type { ReviewRepository } from "./review-repository.js";
import {
  createSqliteReviewRepository
} from "./sqlite-review-repository.js";
import {
  createSqliteStoreSearchRepository,
  runSqliteSearchReadTransaction
} from "./sqlite-store-search-repository.js";
import {
  StoreSearchError,
  type StoreSearchRepository
} from "./store-search-repository.js";

export interface ExecuteStoreSearchOptions {
  input: unknown;
  requestTimeMs: number;
  storeRepository: StoreSearchRepository;
  reviewRepository: ReviewRepository;
}

export interface ExecuteSqliteStoreSearchOptions {
  appDatabase: AppDatabaseHandle;
  input: unknown;
  requestTimeMs: number;
}

export interface ResolveCurrentSearchDataVersionOptions {
  requestTimeMs: number;
  storeRepository: StoreSearchRepository;
}

export interface ResolveCurrentSqliteSearchDataVersionOptions {
  appDatabase: AppDatabaseHandle;
  requestTimeMs: number;
}

function parseInput(input: unknown): StructuredSearchInput {
  const parsed = structuredSearchInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new StoreSearchError("SEARCH_INPUT_INVALID");
  }
  return parsed.data;
}

function assertRequestTime(requestTimeMs: number): void {
  if (
    !Number.isSafeInteger(requestTimeMs) ||
    requestTimeMs < 0
  ) {
    throw new StoreSearchError("SEARCH_INPUT_INVALID");
  }
}

export function resolveCurrentSearchDataVersion({
  requestTimeMs,
  storeRepository
}: ResolveCurrentSearchDataVersionOptions): string {
  assertRequestTime(requestTimeMs);
  return storeRepository.inspectCurrentSnapshot(
    requestTimeMs
  ).dataSnapshotVersion;
}

export function resolveCurrentSqliteSearchDataVersion({
  appDatabase,
  requestTimeMs
}: ResolveCurrentSqliteSearchDataVersionOptions): string {
  return resolveCurrentSearchDataVersion({
    requestTimeMs,
    storeRepository:
      createSqliteStoreSearchRepository(appDatabase)
  });
}

function deriveCandidates(
  candidates: readonly RecommendationCandidateFacts[],
  input: StructuredSearchInput,
  requestTimeMs: number
): readonly DerivedCandidateFacts[] {
  const globalMean = calculateGlobalRatingMean(candidates);
  return candidates.map((candidate) => {
    const openingState = deriveOpeningState(
      candidate.businessHours,
      requestTimeMs
    );
    const distanceM =
      input.origin === null
        ? null
        : calculateRoundedDistanceM(input.origin, {
            latitudeE7: candidate.latitudeE7,
            longitudeE7: candidate.longitudeE7
          });
    return {
      ...candidate,
      openingState,
      distanceM,
      reviewStatus: deriveReviewStatus(
        candidate.reviewAggregate.count
      ),
      completeness: calculateCompleteness(
        candidate,
        openingState
      ),
      adjustedRating: calculateAdjustedRating(
        candidate.reviewAggregate,
        globalMean
      )
    };
  });
}

export function executeStoreSearch({
  input: unknownInput,
  requestTimeMs,
  storeRepository,
  reviewRepository
}: ExecuteStoreSearchOptions): StructuredSearchResult {
  const input = parseInput(unknownInput);
  assertRequestTime(requestTimeMs);
  let query: ReturnType<
    typeof normalizeStructuredSearchQuery
  >;
  try {
    query = normalizeStructuredSearchQuery(input);
  } catch {
    throw new StoreSearchError("SEARCH_INPUT_INVALID");
  }

  const snapshot = storeRepository.loadSnapshot({
    expectedDataSnapshotVersion: input.dataSnapshotVersion,
    requestTimeMs
  });
  const candidates = deriveCandidates(
    snapshot.candidates,
    input,
    requestTimeMs
  );

  let ftsAvailable = true;
  let evidenceHits: readonly ReviewEvidenceFact[] = [];
  if (query.menuTerms.length > 0) {
    if (candidates.length === 0) {
      ftsAvailable =
        snapshot.descriptor.ftsIndexVersion ===
        SEARCH_REVIEW_FTS_INDEX_VERSION;
    } else {
      const evidence = reviewRepository.searchStoreEvidence({
        terms: query.menuTerms.map(
          (term) => term.normalizedText
        ),
        storeIds: candidates.map(
          (candidate) => candidate.storeId
        )
      });
      ftsAvailable = evidence.status === "AVAILABLE";
      evidenceHits = evidence.hits;
    }
  }
  const reviewEvidenceByStore = new Map(
    evidenceHits.map((hit) => [hit.storeId, hit])
  );
  const filtered = filterCandidates({
    candidates,
    query,
    reviewEvidenceByStore,
    ftsAvailable
  });
  const ranked = rankCandidates(filtered.candidates, query);
  const items = ranked.map((candidate) =>
    buildPublicSearchItem(candidate, query, ftsAvailable)
  );
  const partial =
    query.menuTerms.length > 0 && !ftsAvailable;
  const result = {
    status: partial ? "PARTIAL" : "COMPLETE",
    partialReason: partial ? "FTS_UNAVAILABLE" : null,
    items,
    metadata: {
      searchContractVersion: SEARCH_CONTRACT_VERSION,
      recommendationVersion: RECOMMENDATION_VERSION,
      dataSnapshotVersion:
        snapshot.descriptor.dataSnapshotVersion,
      catalogPublishId: snapshot.descriptor.catalogPublishId,
      searchEvidencePublishId:
        snapshot.descriptor.searchEvidencePublishId,
      reviewPublishVersionId:
        snapshot.descriptor.reviewPublishVersionId,
      sourceBasisDate: snapshot.descriptor.sourceBasisDate,
      ftsIndexVersion:
        ftsAvailable &&
        snapshot.descriptor.ftsIndexVersion ===
          SEARCH_REVIEW_FTS_INDEX_VERSION
          ? SEARCH_REVIEW_FTS_INDEX_VERSION
          : null,
      aliasVersion: SEARCH_ALIAS_VERSION,
      ratingPriorVersion: RATING_PRIOR_VERSION
    },
    filterSummary: {
      initialCount: candidates.length,
      resultCount: items.length,
      reasonCounts: filtered.reasonCounts
    },
    relaxationOptions: buildRelaxationOptions(
      query,
      items.length
    )
  };
  const parsedResult =
    structuredSearchResultSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new StoreSearchError("SEARCH_DATA_UNAVAILABLE");
  }
  return parsedResult.data;
}

export function executeSqliteStoreSearch({
  appDatabase,
  input,
  requestTimeMs
}: ExecuteSqliteStoreSearchOptions): StructuredSearchResult {
  const storeRepository =
    createSqliteStoreSearchRepository(appDatabase);
  const reviewRepository =
    createSqliteReviewRepository(appDatabase);
  return runSqliteSearchReadTransaction(appDatabase, () =>
    executeStoreSearch({
      input,
      requestTimeMs,
      storeRepository,
      reviewRepository
    })
  );
}
