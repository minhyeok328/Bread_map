import { z } from "zod";

export const SEARCH_CONTRACT_VERSION = "structured-search-v1";
export const RECOMMENDATION_VERSION = "recommendation-v1";
export const SEARCH_ALIAS_VERSION = "search-alias-v1";
export const SEARCH_EVIDENCE_VERSION = "search-evidence-v1";
export const RATING_PRIOR_VERSION = "rating-prior-v1";
export const SEARCH_DATA_VERSION_PREFIX = "search-data-v1_";
export const SEARCH_REVIEW_FTS_INDEX_VERSION =
  "review-fts-unicode61-v1";

export const menuCategories = [
  "FERMENTED_BREAD",
  "PASTRY",
  "SALT_BREAD",
  "BAGUETTE",
  "LOAF_BREAD",
  "SWEET_BREAD",
  "SANDWICH",
  "DESSERT"
] as const;

export const categoryFilterModes = [
  "INCLUDE",
  "EXCLUDE"
] as const;
export const reviewEvidenceStatuses = [
  "ANY",
  "AVAILABLE",
  "INSUFFICIENT"
] as const;
export const searchSortModes = [
  "RELEVANCE",
  "DISTANCE"
] as const;
export const openingStates = [
  "OPEN",
  "CLOSED",
  "UNKNOWN"
] as const;
export const publicReviewStatuses = [
  "AVAILABLE",
  "INSUFFICIENT"
] as const;

export const filterReasonCodes = [
  "REGION_MISMATCH",
  "STORE_NAME_MISMATCH",
  "EXCLUDED_CATEGORY",
  "INCLUDED_CATEGORY_MISSING",
  "NOT_OPEN",
  "DISTANCE_EXCEEDED",
  "REVIEW_STATUS_MISMATCH",
  "MENU_MISMATCH"
] as const;

export const searchReasonCodes = [
  "MENU_MATCH",
  "CATEGORY_MATCH",
  "REGION_MATCH",
  "STORE_NAME_MATCH",
  "OPEN_NOW",
  "NEARBY",
  "REVIEW_EVIDENCE",
  "RECENT_REVIEW",
  "VERIFIED_DATA"
] as const;

export const searchWarningCodes = [
  "INSUFFICIENT_REVIEWS",
  "OPENING_HOURS_UNKNOWN",
  "FTS_UNAVAILABLE"
] as const;

export const relaxationCodes = [
  "EXPAND_REGION_OR_DISTANCE",
  "DISABLE_OPEN_NOW",
  "INCLUDE_INSUFFICIENT_REVIEWS",
  "EXPAND_ADJACENT_CATEGORY"
] as const;

export const searchErrorCodes = [
  "SEARCH_INPUT_INVALID",
  "SEARCH_DATA_UNAVAILABLE",
  "SEARCH_DATA_VERSION_MISMATCH",
  "SEARCH_DATA_STALE",
  "SEARCH_DATABASE_UNAVAILABLE"
] as const;

const optionalSearchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .nullable();

const requestOriginSchema = z.strictObject({
  latitudeE7: z
    .number()
    .finite()
    .int()
    .min(-900000000)
    .max(900000000),
  longitudeE7: z
    .number()
    .finite()
    .int()
    .min(-1800000000)
    .max(1800000000)
});

const categoryFilterSchema = z.strictObject({
  category: z.enum(menuCategories),
  mode: z.enum(categoryFilterModes)
});

const categoryFiltersSchema = z
  .array(categoryFilterSchema)
  .max(8)
  .superRefine((filters, context) => {
    const seen = new Set<string>();
    for (const [index, filter] of filters.entries()) {
      const key = `${filter.category}:${filter.mode}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "category filters must be unique"
        });
      }
      seen.add(key);
    }

    for (const category of menuCategories) {
      const modes = filters
        .filter((filter) => filter.category === category)
        .map((filter) => filter.mode);
      if (modes.includes("INCLUDE") && modes.includes("EXCLUDE")) {
        context.addIssue({
          code: "custom",
          path: ["categories"],
          message:
            "a category cannot be both included and excluded"
        });
      }
    }
  });

export const structuredSearchInputSchema = z
  .strictObject({
    region: optionalSearchTextSchema,
    storeName: optionalSearchTextSchema,
    menuName: optionalSearchTextSchema,
    categories: categoryFiltersSchema,
    openNow: z.boolean(),
    origin: requestOriginSchema.nullable(),
    maxDistanceM: z.number().int().min(1).max(100000).nullable(),
    reviewEvidenceStatus: z.enum(reviewEvidenceStatuses),
    sortMode: z.enum(searchSortModes),
    dataSnapshotVersion: z
      .string()
      .regex(/^search-data-v1_[0-9a-f]{64}$/),
    recommendationVersion: z.literal(RECOMMENDATION_VERSION)
  })
  .superRefine((input, context) => {
    if (input.maxDistanceM !== null && input.origin === null) {
      context.addIssue({
        code: "custom",
        path: ["maxDistanceM"],
        message: "maxDistanceM requires origin"
      });
    }
    if (input.sortMode === "DISTANCE" && input.origin === null) {
      context.addIssue({
        code: "custom",
        path: ["sortMode"],
        message: "DISTANCE sort requires origin"
      });
    }
  });

const evidenceRefSchema = z.string().trim().min(1).max(1000);
const verifiedAtMsSchema = z
  .number()
  .int()
  .nonnegative()
  .safe();
const evidenceSourceSchema = z.literal("MANUAL_VERIFIED");
const searchEntityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const evidenceTextSchema = z.string().trim().min(1).max(200);

const menuAliasInputSchema = z.strictObject({
  alias: evidenceTextSchema,
  source: evidenceSourceSchema,
  evidenceRef: evidenceRefSchema,
  verifiedAtMs: verifiedAtMsSchema
});

const menuEvidenceInputSchema = z.strictObject({
  storeId: searchEntityIdSchema,
  name: evidenceTextSchema,
  category: z.enum(menuCategories),
  source: evidenceSourceSchema,
  evidenceRef: evidenceRefSchema,
  verifiedAtMs: verifiedAtMsSchema,
  aliases: z.array(menuAliasInputSchema).max(20)
});

const storeAliasInputSchema = z.strictObject({
  storeId: searchEntityIdSchema,
  aliasType: z.enum(["STORE_NAME", "REGION"]),
  alias: evidenceTextSchema,
  source: evidenceSourceSchema,
  evidenceRef: evidenceRefSchema,
  verifiedAtMs: verifiedAtMsSchema
});

const businessHourInputSchema = z
  .strictObject({
    storeId: searchEntityIdSchema,
    weekday: z.number().int().min(0).max(6),
    sequence: z.number().int().nonnegative().max(100),
    opensMinute: z.number().int().min(0).max(1439),
    closesMinute: z.number().int().min(0).max(1439),
    closesNextDay: z.boolean(),
    source: evidenceSourceSchema,
    evidenceRef: evidenceRefSchema,
    verifiedAtMs: verifiedAtMsSchema
  })
  .superRefine((interval, context) => {
    const validDirection = interval.closesNextDay
      ? interval.closesMinute <= interval.opensMinute
      : interval.closesMinute > interval.opensMinute;
    if (!validDirection) {
      context.addIssue({
        code: "custom",
        path: ["closesMinute"],
        message: "business hour direction is invalid"
      });
    }
  });

export const verifiedSearchEvidenceBatchSchema = z.strictObject({
  catalogPublishId: searchEntityIdSchema,
  contractVersion: z.literal(SEARCH_EVIDENCE_VERSION),
  menus: z.array(menuEvidenceInputSchema).max(5000),
  storeAliases: z.array(storeAliasInputSchema).max(10000),
  businessHours: z.array(businessHourInputSchema).max(50000)
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/);

const representativeMenuSchema = z.strictObject({
  menuId: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  category: z.enum(menuCategories),
  evidenceId: z.string().min(1).max(500)
});

const uniqueEnumArray = <T extends readonly [string, ...string[]]>(
  values: T,
  maximum: number
) =>
  z
    .array(z.enum(values))
    .max(maximum)
    .refine((items) => new Set(items).size === items.length, {
      message: "values must be unique"
    });

export const structuredSearchItemSchema = z.strictObject({
  storeId: z.string().min(1).max(128),
  bakeryId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200),
  normalizedAddress: z.string().min(1).max(500),
  seoulDistrict: z.string().regex(/^[가-힣]+구$/),
  latitudeE7: z.number().int().min(-900000000).max(900000000),
  longitudeE7: z
    .number()
    .int()
    .min(-1800000000)
    .max(1800000000),
  distanceUpperBoundM: z
    .number()
    .int()
    .positive()
    .max(20100000)
    .refine((value) => value % 250 === 0, {
      message: "distance upper bound must use 250m buckets"
    })
    .nullable(),
  openingState: z.enum(openingStates),
  representativeMenus: z.array(representativeMenuSchema).max(3),
  categories: uniqueEnumArray(menuCategories, menuCategories.length),
  review: z.strictObject({
    status: z.enum(publicReviewStatuses),
    count: z.number().int().nonnegative(),
    latestPublishedDate: isoDateSchema.nullable(),
    snippet: z.string().min(1).max(500).nullable()
  }),
  reasonCodes: uniqueEnumArray(
    searchReasonCodes,
    searchReasonCodes.length
  ),
  warningCodes: uniqueEnumArray(
    searchWarningCodes,
    searchWarningCodes.length
  )
});

const filterReasonCountSchema = z.object(
  Object.fromEntries(
    filterReasonCodes.map((reasonCode) => [
      reasonCode,
      z.number().int().nonnegative()
    ])
  ) as Record<
    (typeof filterReasonCodes)[number],
    z.ZodNumber
  >
);

export const structuredSearchResultSchema = z
  .strictObject({
    status: z.enum(["COMPLETE", "PARTIAL"]),
    partialReason: z.literal("FTS_UNAVAILABLE").nullable(),
    items: z.array(structuredSearchItemSchema),
    metadata: z.strictObject({
      searchContractVersion: z.literal(SEARCH_CONTRACT_VERSION),
      recommendationVersion: z.literal(RECOMMENDATION_VERSION),
      dataSnapshotVersion: z
        .string()
        .regex(/^search-data-v1_[0-9a-f]{64}$/),
      catalogPublishId: z.string().min(1).max(128),
      searchEvidencePublishId: z
        .string()
        .min(1)
        .max(128)
        .nullable(),
      reviewPublishVersionId: z
        .string()
        .min(1)
        .max(128)
        .nullable(),
      sourceBasisDate: isoDateSchema,
      ftsIndexVersion: z
        .literal(SEARCH_REVIEW_FTS_INDEX_VERSION)
        .nullable(),
      aliasVersion: z.literal(SEARCH_ALIAS_VERSION),
      ratingPriorVersion: z.literal(RATING_PRIOR_VERSION)
    }),
    filterSummary: z.strictObject({
      initialCount: z.number().int().nonnegative(),
      resultCount: z.number().int().nonnegative(),
      reasonCounts: filterReasonCountSchema
    }),
    relaxationOptions: uniqueEnumArray(
      relaxationCodes,
      relaxationCodes.length
    )
  })
  .superRefine((result, context) => {
    const isValidStatus =
      (result.status === "COMPLETE" &&
        result.partialReason === null) ||
      (result.status === "PARTIAL" &&
        result.partialReason === "FTS_UNAVAILABLE");
    if (!isValidStatus) {
      context.addIssue({
        code: "custom",
        path: ["partialReason"],
        message: "status and partialReason must agree"
      });
    }
    if (result.filterSummary.resultCount !== result.items.length) {
      context.addIssue({
        code: "custom",
        path: ["filterSummary", "resultCount"],
        message: "resultCount must equal items length"
      });
    }
  });

export function parseStructuredSearchInput(
  input: unknown
): StructuredSearchInput {
  return structuredSearchInputSchema.parse(input);
}

export type MenuCategory = (typeof menuCategories)[number];
export type CategoryFilterMode =
  (typeof categoryFilterModes)[number];
export type ReviewEvidenceStatus =
  (typeof reviewEvidenceStatuses)[number];
export type SearchSortMode = (typeof searchSortModes)[number];
export type OpeningState = (typeof openingStates)[number];
export type PublicReviewStatus =
  (typeof publicReviewStatuses)[number];
export type FilterReasonCode =
  (typeof filterReasonCodes)[number];
export type SearchReasonCode =
  (typeof searchReasonCodes)[number];
export type SearchWarningCode =
  (typeof searchWarningCodes)[number];
export type RelaxationCode = (typeof relaxationCodes)[number];
export type SearchErrorCode = (typeof searchErrorCodes)[number];
export type StructuredSearchInput = z.output<
  typeof structuredSearchInputSchema
>;
export type StructuredSearchResult = z.output<
  typeof structuredSearchResultSchema
>;
export type VerifiedSearchEvidenceBatch = z.output<
  typeof verifiedSearchEvidenceBatchSchema
>;
export type StructuredSearchItem =
  StructuredSearchResult["items"][number];
