import type {
  MenuCategory,
  OpeningState,
  PublicReviewStatus,
  ReviewEvidenceStatus,
  SearchSortMode
} from "@bread-map/contracts";
import type { NormalizedSearchText } from "./normalize-query.js";

export interface MenuAliasFact {
  aliasId: string;
  alias: string;
  normalizedAlias: string;
  evidenceId: string;
}

export interface MenuFact {
  menuId: string;
  name: string;
  normalizedName: string;
  category: MenuCategory;
  evidenceId: string;
  aliases: readonly MenuAliasFact[];
}

export interface StoreAliasFact {
  aliasId: string;
  aliasType: "STORE_NAME" | "REGION";
  alias: string;
  normalizedAlias: string;
  evidenceId: string;
}

export interface BusinessHourFact {
  intervalId: string;
  weekday: number;
  sequence: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  evidenceId: string;
}

export interface ReviewAggregateFact {
  count: number;
  latestPublishedDate: string | null;
  ratedCount: number;
  ratingSumBasisPoints: number;
}

export interface RecommendationCandidateFacts {
  storeId: string;
  bakeryId: string;
  displayName: string;
  normalizedName: string;
  normalizedAddress: string;
  seoulDistrict: string;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
  menus: readonly MenuFact[];
  storeAliases: readonly StoreAliasFact[];
  businessHours: readonly BusinessHourFact[];
  reviewAggregate: ReviewAggregateFact;
}

export interface DerivedCandidateFacts
  extends RecommendationCandidateFacts {
  openingState: OpeningState;
  distanceM: number | null;
  reviewStatus: PublicReviewStatus;
  completeness: number;
  adjustedRating: number;
}

export interface ReviewEvidenceFact {
  reviewId: string;
  storeId: string;
  publishedDate: string;
  snippet: string;
  internalRank: number;
  termPriority: number;
}

export interface NormalizedStructuredSearchQuery {
  region: NormalizedSearchText | null;
  storeName: NormalizedSearchText | null;
  menuTerms: readonly NormalizedSearchText[];
  includedCategories: readonly MenuCategory[];
  excludedCategories: readonly MenuCategory[];
  openNow: boolean;
  origin: {
    latitudeE7: number;
    longitudeE7: number;
  } | null;
  maxDistanceM: number | null;
  reviewEvidenceStatus: ReviewEvidenceStatus;
  sortMode: SearchSortMode;
}

export interface RankableCandidate extends DerivedCandidateFacts {
  verifiedMenuMatch: boolean;
  includedCategoryMatchCount: number;
  regionMatch: boolean;
  storeNameMatch: boolean;
  reviewEvidence: ReviewEvidenceFact | null;
  usableFtsEvidence: boolean;
}
