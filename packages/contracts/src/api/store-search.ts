import { z } from "zod";
import {
  structuredSearchInputSchema,
  type StructuredSearchInput
} from "../search.js";

const INTERNAL_SEARCH_DATA_VERSION =
  `search-data-v1_${"0".repeat(64)}` as const;
type StoreSearchQuery = Omit<
  StructuredSearchInput,
  "dataSnapshotVersion"
>;

function withoutDataSnapshotVersion(
  input: StructuredSearchInput
): StoreSearchQuery {
  return {
    region: input.region,
    storeName: input.storeName,
    menuName: input.menuName,
    categories: input.categories,
    openNow: input.openNow,
    origin: input.origin,
    maxDistanceM: input.maxDistanceM,
    reviewEvidenceStatus: input.reviewEvidenceStatus,
    sortMode: input.sortMode,
    recommendationVersion: input.recommendationVersion
  };
}

const storeSearchQuerySchema = z
  .unknown()
  .transform(
    (
      input,
      context
    ): StoreSearchQuery | typeof z.NEVER => {
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        Object.hasOwn(input, "dataSnapshotVersion")
      ) {
        context.addIssue({
          code: "custom",
          path: ["dataSnapshotVersion"],
          message: "unknown key: dataSnapshotVersion"
        });
        return z.NEVER;
      }

      const result = structuredSearchInputSchema.safeParse(
        typeof input === "object" &&
          input !== null &&
          !Array.isArray(input)
          ? {
              ...input,
              dataSnapshotVersion: INTERNAL_SEARCH_DATA_VERSION
            }
          : input
      );
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            code: "custom",
            path: issue.path,
            message: issue.message
          });
        }
        return z.NEVER;
      }

      return withoutDataSnapshotVersion(result.data);
    }
  );

const searchDataVersionSchema = z
  .string()
  .regex(/^search-data-v1_[0-9a-f]{64}$/);

export const storeSearchRequestSchema = z.strictObject({
  query: storeSearchQuerySchema,
  dataSnapshotVersion: searchDataVersionSchema.nullable()
});

export const storeMapStateSchema = z.strictObject({
  status: z.enum(["READY", "MAP_UNAVAILABLE"])
});

export function parseStoreSearchRequest(
  input: unknown
): StoreSearchRequest {
  return storeSearchRequestSchema.parse(input);
}

export type StoreSearchRequest = z.output<
  typeof storeSearchRequestSchema
>;
export type StoreMapState = z.output<typeof storeMapStateSchema>;
