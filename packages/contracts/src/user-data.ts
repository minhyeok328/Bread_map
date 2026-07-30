import { z } from "zod";
import {
  categoryFilterModes,
  menuCategories,
  RECOMMENDATION_VERSION,
  reviewEvidenceStatuses,
  searchSortModes
} from "./search.js";

export const SEARCH_HISTORY_FILTER_VERSION =
  "search-history-filters-v1";

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

const categoryFilterSchema = z.strictObject({
  category: z.enum(menuCategories),
  mode: z.enum(categoryFilterModes)
});

const historyCategoryFiltersSchema = z
  .array(categoryFilterSchema)
  .max(menuCategories.length)
  .superRefine((filters, context) => {
    const seenCategories = new Set<string>();
    for (const [index, filter] of filters.entries()) {
      if (seenCategories.has(filter.category)) {
        context.addIssue({
          code: "custom",
          path: [index, "category"],
          message: "history categories must be unique"
        });
      }
      seenCategories.add(filter.category);
    }
  });

const coarseAreaLabelSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[가-힣A-Za-z0-9 .-]*(구|동|역)$/u)
  .nullable();

export const searchHistoryFiltersSchema = z.strictObject({
  schemaVersion: z.literal(SEARCH_HISTORY_FILTER_VERSION),
  areaLabel: coarseAreaLabelSchema,
  categories: historyCategoryFiltersSchema,
  openNow: z.boolean(),
  maxDistanceBucketM: z
    .number()
    .int()
    .min(250)
    .max(100000)
    .refine((value) => value % 250 === 0, {
      message: "history distance must use a 250m bucket"
    })
    .nullable(),
  reviewEvidenceStatus: z.enum(reviewEvidenceStatuses),
  sortMode: z.enum(searchSortModes)
});

export const favoriteMutationSchema = z.strictObject({
  storeId: opaqueIdSchema
});

export const historyQuerySchema = z.strictObject({
  kind: z.enum(["search", "selection"]),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const searchHistoryMutationSchema = z.strictObject({
  kind: z.literal("search"),
  filters: searchHistoryFiltersSchema,
  dataSnapshotVersion: z
    .string()
    .regex(/^search-data-v1_[0-9a-f]{64}$/),
  recommendationVersion: z.literal(RECOMMENDATION_VERSION),
  resultCount: z.number().int().nonnegative()
});

const selectionHistoryMutationSchema = z.strictObject({
  kind: z.literal("selection"),
  storeId: opaqueIdSchema,
  sourceSurface: z.enum(["LIST", "MAP", "SEARCH"])
});

export const historyMutationSchema = z.discriminatedUnion("kind", [
  searchHistoryMutationSchema,
  selectionHistoryMutationSchema
]);

export const historyDeleteSchema = z.strictObject({
  kind: z.enum(["search", "selection"]),
  historyId: opaqueIdSchema
});

export const accountWithdrawalSchema = z.strictObject({
  confirmation: z.literal("DELETE_MY_ACCOUNT")
});

export function parseFavoriteMutation(
  input: unknown
): FavoriteMutation {
  return favoriteMutationSchema.parse(input);
}

export function parseHistoryQuery(input: unknown): HistoryQuery {
  return historyQuerySchema.parse(input);
}

export function parseHistoryMutation(
  input: unknown
): HistoryMutation {
  return historyMutationSchema.parse(input);
}

export function parseHistoryDelete(input: unknown): HistoryDelete {
  return historyDeleteSchema.parse(input);
}

export function parseAccountWithdrawal(
  input: unknown
): AccountWithdrawal {
  return accountWithdrawalSchema.parse(input);
}

export type SearchHistoryFilters = z.output<
  typeof searchHistoryFiltersSchema
>;
export type FavoriteMutation = z.output<
  typeof favoriteMutationSchema
>;
export type HistoryQuery = z.output<typeof historyQuerySchema>;
export type HistoryMutation = z.output<
  typeof historyMutationSchema
>;
export type HistoryDelete = z.output<typeof historyDeleteSchema>;
export type AccountWithdrawal = z.output<
  typeof accountWithdrawalSchema
>;
