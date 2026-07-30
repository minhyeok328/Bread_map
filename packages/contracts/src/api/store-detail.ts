import { z } from "zod";
import {
  RECOMMENDATION_VERSION,
  menuCategories,
  openingStates
} from "../search.js";

const safeEntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const searchDataVersionSchema = z
  .string()
  .regex(/^search-data-v1_[0-9a-f]{64}$/);
const canonicalPositiveDecimalSchema = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum));
const verifiedAtMsSchema = z
  .number()
  .int()
  .nonnegative()
  .safe();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/);
const evidenceStatusSchema = z.enum([
  "AVAILABLE",
  "UNAVAILABLE"
]);

export const storeDetailPathSchema = z.strictObject({
  storeId: safeEntityIdSchema
});

export const storeDetailQuerySchema = z.strictObject({
  dataSnapshotVersion: searchDataVersionSchema,
  reviewPage: canonicalPositiveDecimalSchema(1000).default(1),
  reviewLimit: canonicalPositiveDecimalSchema(20).default(10)
});

const storeDetailStoreSchema = z.strictObject({
  storeId: safeEntityIdSchema,
  bakeryId: safeEntityIdSchema,
  displayName: z.string().trim().min(1).max(200),
  normalizedAddress: z.string().trim().min(1).max(500),
  seoulDistrict: z.string().regex(/^[가-힣]+구$/),
  normalizedPhone: z
    .string()
    .regex(/^\d{9,11}$/)
    .nullable(),
  latitudeE7: z
    .number()
    .int()
    .min(-900000000)
    .max(900000000),
  longitudeE7: z
    .number()
    .int()
    .min(-1800000000)
    .max(1800000000),
  openingState: z.enum(openingStates),
  latestVerifiedAtMs: verifiedAtMsSchema
});

const verifiedEvidenceSchema = {
  evidenceId: safeEntityIdSchema,
  source: z.literal("MANUAL_VERIFIED"),
  verifiedAtMs: verifiedAtMsSchema
} as const;

const storeDetailMenuSchema = z.strictObject({
  menuId: safeEntityIdSchema,
  name: z.string().trim().min(1).max(200),
  category: z.enum(menuCategories),
  ...verifiedEvidenceSchema
});

const storeDetailMenuSectionSchema = z
  .strictObject({
    status: evidenceStatusSchema,
    items: z.array(storeDetailMenuSchema).max(5000)
  })
  .superRefine((section, context) => {
    if (
      section.status === "UNAVAILABLE" &&
      section.items.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "unavailable menu section must be empty"
      });
    }
  });

const storeDetailBusinessHourSchema = z
  .strictObject({
    intervalId: safeEntityIdSchema,
    weekday: z.number().int().min(0).max(6),
    sequence: z.number().int().nonnegative().max(100),
    opensMinute: z.number().int().min(0).max(1439),
    closesMinute: z.number().int().min(0).max(1439),
    closesNextDay: z.boolean(),
    ...verifiedEvidenceSchema
  })
  .superRefine((interval, context) => {
    const hasValidDirection = interval.closesNextDay
      ? interval.closesMinute <= interval.opensMinute
      : interval.closesMinute > interval.opensMinute;
    if (!hasValidDirection) {
      context.addIssue({
        code: "custom",
        path: ["closesMinute"],
        message: "business hour direction is invalid"
      });
    }
  });

const storeDetailBusinessHoursSectionSchema = z
  .strictObject({
    status: evidenceStatusSchema,
    items: z.array(storeDetailBusinessHourSchema).max(50000)
  })
  .superRefine((section, context) => {
    if (
      section.status === "UNAVAILABLE" &&
      section.items.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "unavailable business-hours section must be empty"
      });
    }
  });

const storeDetailRatingSchema = z
  .strictObject({
    averageBasisPoints: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .nullable(),
    ratedReviewCount: z.number().int().nonnegative(),
    totalReviewCount: z.number().int().nonnegative()
  })
  .superRefine((rating, context) => {
    if (rating.ratedReviewCount > rating.totalReviewCount) {
      context.addIssue({
        code: "custom",
        path: ["ratedReviewCount"],
        message: "rated review count cannot exceed total review count"
      });
    }

    const hasAverage = rating.averageBasisPoints !== null;
    if (hasAverage !== (rating.ratedReviewCount > 0)) {
      context.addIssue({
        code: "custom",
        path: ["averageBasisPoints"],
        message:
          "average rating must be null exactly when rated count is zero"
      });
    }
  });

const storeDetailReviewSchema = z.strictObject({
  reviewId: safeEntityIdSchema,
  body: z.string().trim().min(1).max(5000),
  ratingBasisPoints: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .nullable(),
  publishedDate: isoDateSchema,
  provider: z.literal("KAKAO_MAP")
});

const storeDetailReviewsSchema = z
  .strictObject({
    status: z.enum([
      "AVAILABLE",
      "INSUFFICIENT",
      "UNAVAILABLE"
    ]),
    page: z.number().int().min(1).max(1000),
    limit: z.number().int().min(1).max(20),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    items: z.array(storeDetailReviewSchema).max(20)
  })
  .superRefine((reviews, context) => {
    const statusMatchesTotal =
      (reviews.status === "AVAILABLE" &&
        reviews.totalCount >= 3) ||
      (reviews.status === "INSUFFICIENT" &&
        reviews.totalCount <= 2) ||
      (reviews.status === "UNAVAILABLE" &&
        reviews.totalCount === 0 &&
        reviews.items.length === 0);
    if (!statusMatchesTotal) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "review status must match total review count"
      });
    }

    if (reviews.items.length > reviews.limit) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "review items cannot exceed the requested limit"
      });
    }
    if (reviews.items.length > reviews.totalCount) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "review items cannot exceed the total count"
      });
    }

    const expectedTotalPages = Math.ceil(
      reviews.totalCount / reviews.limit
    );
    if (reviews.totalPages !== expectedTotalPages) {
      context.addIssue({
        code: "custom",
        path: ["totalPages"],
        message: "total pages must equal the paged review count"
      });
    }
  });

export const storeDetailResponseSchema = z
  .strictObject({
    store: storeDetailStoreSchema,
    menus: storeDetailMenuSectionSchema,
    businessHours: storeDetailBusinessHoursSectionSchema,
    rating: storeDetailRatingSchema,
    reviews: storeDetailReviewsSchema,
    freshness: z.strictObject({
      status: z.enum(["CURRENT", "WARNING"]),
      sourceBasisDate: isoDateSchema
    }),
    metadata: z.strictObject({
      dataSnapshotVersion: searchDataVersionSchema,
      catalogPublishId: safeEntityIdSchema,
      searchEvidencePublishId: safeEntityIdSchema.nullable(),
      reviewPublishVersionId: safeEntityIdSchema.nullable(),
      recommendationVersion: z.literal(RECOMMENDATION_VERSION)
    })
  })
  .superRefine((response, context) => {
    if (
      (response.menus.status === "AVAILABLE" ||
        response.businessHours.status === "AVAILABLE") &&
      response.metadata.searchEvidencePublishId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "searchEvidencePublishId"],
        message:
          "available evidence requires an evidence publish"
      });
    }

    if (
      response.rating.totalReviewCount !==
      response.reviews.totalCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["rating", "totalReviewCount"],
        message:
          "rating and review sections must report the same total"
      });
    }

    const reviewsArePublished =
      response.reviews.status !== "UNAVAILABLE";
    const identifiesReviewPublish =
      response.metadata.reviewPublishVersionId !== null;
    if (reviewsArePublished !== identifiesReviewPublish) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "reviewPublishVersionId"],
        message:
          "review availability must match the review publish"
      });
    }
  });

export function parseStoreDetailPath(
  input: unknown
): StoreDetailPath {
  return storeDetailPathSchema.parse(input);
}

export function parseStoreDetailQuery(
  input: unknown
): StoreDetailQuery {
  return storeDetailQuerySchema.parse(input);
}

export type StoreDetailPath = z.output<
  typeof storeDetailPathSchema
>;
export type StoreDetailQuery = z.output<
  typeof storeDetailQuerySchema
>;
export type StoreDetailResponse = z.output<
  typeof storeDetailResponseSchema
>;
