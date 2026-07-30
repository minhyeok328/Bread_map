import { describe, expect, it } from "vitest";
import { RECOMMENDATION_VERSION } from "../search.js";
import {
  parseStoreDetailPath,
  parseStoreDetailQuery,
  storeDetailPathSchema,
  storeDetailQuerySchema,
  storeDetailResponseSchema,
  type StoreDetailQuery,
  type StoreDetailResponse
} from "./store-detail.js";

const dataSnapshotVersion =
  `search-data-v1_${"a".repeat(64)}`;

function validResponse(): StoreDetailResponse {
  return {
    store: {
      storeId: "store_1",
      bakeryId: "bakery_1",
      displayName: "서교 빵집",
      normalizedAddress: "서울특별시 마포구 월드컵로 1",
      seoulDistrict: "마포구",
      normalizedPhone: "0212345678",
      latitudeE7: 375634614,
      longitudeE7: 1269014494,
      openingState: "OPEN",
      latestVerifiedAtMs: 1785340800000
    },
    menus: {
      status: "AVAILABLE",
      items: [
        {
          menuId: "menu_1",
          name: "소금빵",
          category: "SALT_BREAD",
          evidenceId: "menu_1",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 1785340800000
        }
      ]
    },
    businessHours: {
      status: "AVAILABLE",
      items: [
        {
          intervalId: "hours_1",
          weekday: 3,
          sequence: 0,
          opensMinute: 540,
          closesMinute: 1080,
          closesNextDay: false,
          evidenceId: "hours_1",
          source: "MANUAL_VERIFIED",
          verifiedAtMs: 1785340800000
        }
      ]
    },
    rating: {
      averageBasisPoints: 4500,
      ratedReviewCount: 2,
      totalReviewCount: 3
    },
    reviews: {
      status: "AVAILABLE",
      page: 1,
      limit: 2,
      totalCount: 3,
      totalPages: 2,
      items: [
        {
          reviewId: "review_3",
          body: "소금빵이 맛있어요",
          ratingBasisPoints: 5000,
          publishedDate: "2026-07-29",
          provider: "KAKAO_MAP"
        },
        {
          reviewId: "review_2",
          body: "다시 방문하고 싶어요",
          ratingBasisPoints: 4000,
          publishedDate: "2026-07-28",
          provider: "KAKAO_MAP"
        }
      ]
    },
    freshness: {
      status: "CURRENT",
      sourceBasisDate: "2026-07-30"
    },
    metadata: {
      dataSnapshotVersion,
      catalogPublishId: "publish_fixture-01",
      searchEvidencePublishId: "search_evidence_fixture",
      reviewPublishVersionId: "review_publish_fixture",
      recommendationVersion: RECOMMENDATION_VERSION
    }
  };
}

describe("store detail request schemas", () => {
  it("parses a strict safe store path", () => {
    expect(parseStoreDetailPath({ storeId: "store:fixture-01" })).toEqual({
      storeId: "store:fixture-01"
    });
  });

  it.each([
    { storeId: "" },
    { storeId: "../app.sqlite" },
    { storeId: "store id" },
    { storeId: `s${"a".repeat(128)}` },
    { storeId: "store_1", extra: true }
  ])("rejects an unsafe or non-exact path %#", (path) => {
    expect(storeDetailPathSchema.safeParse(path).success).toBe(false);
  });

  it("defaults omitted review pagination after parsing raw strings", () => {
    const query = parseStoreDetailQuery({
      dataSnapshotVersion
    });
    const expected = {
      dataSnapshotVersion,
      reviewPage: 1,
      reviewLimit: 10
    } satisfies StoreDetailQuery;

    expect(query).toEqual(expected);
  });

  it("accepts canonical decimal strings at the pagination caps", () => {
    expect(
      parseStoreDetailQuery({
        dataSnapshotVersion,
        reviewPage: "1000",
        reviewLimit: "20"
      })
    ).toEqual({
      dataSnapshotVersion,
      reviewPage: 1000,
      reviewLimit: 20
    });
  });

  it.each([
    {
      name: "missing snapshot",
      query: {}
    },
    {
      name: "unsafe snapshot",
      query: { dataSnapshotVersion: "../app.sqlite" }
    },
    {
      name: "unknown field",
      query: { dataSnapshotVersion, page: "1" }
    },
    ...["0", "01", "+1", " 1", "1 ", "1.0", "1e2", "1001"].map(
      (reviewPage) => ({
        name: `non-canonical or out-of-range page ${reviewPage}`,
        query: { dataSnapshotVersion, reviewPage }
      })
    ),
    ...["0", "01", "+1", " 1", "1 ", "1.0", "1e1", "21"].map(
      (reviewLimit) => ({
        name: `non-canonical or out-of-range limit ${reviewLimit}`,
        query: { dataSnapshotVersion, reviewLimit }
      })
    )
  ])("rejects $name", ({ query }) => {
    expect(storeDetailQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("storeDetailResponseSchema", () => {
  it("accepts the complete public detail response", () => {
    const response = validResponse();

    expect(storeDetailResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects unknown public response fields", () => {
    expect(
      storeDetailResponseSchema.safeParse({
        ...validResponse(),
        evidenceRef: "C:\\private\\evidence.json"
      }).success
    ).toBe(false);
    expect(
      storeDetailResponseSchema.safeParse({
        ...validResponse(),
        store: {
          ...validResponse().store,
          normalizedName: "private normalized name"
        }
      }).success
    ).toBe(false);
  });

  it.each(["menus", "businessHours"] as const)(
    "requires an unavailable %s section to be empty",
    (section) => {
      const response = validResponse();
      response[section].status = "UNAVAILABLE";

      expect(storeDetailResponseSchema.safeParse(response).success).toBe(
        false
      );

      response[section].items = [];
      expect(
        storeDetailResponseSchema.safeParse(response).success
      ).toBe(true);
    }
  );

  it("requires an evidence publish when either evidence section is available", () => {
    const response = validResponse();
    response.metadata.searchEvidencePublishId = null;

    expect(storeDetailResponseSchema.safeParse(response).success).toBe(
      false
    );

    response.menus = { status: "UNAVAILABLE", items: [] };
    response.businessHours = { status: "UNAVAILABLE", items: [] };
    expect(storeDetailResponseSchema.safeParse(response).success).toBe(
      true
    );
  });

  it.each([
    {
      name: "rated count exceeds total count",
      rating: {
        averageBasisPoints: 4500,
        ratedReviewCount: 4,
        totalReviewCount: 3
      }
    },
    {
      name: "average is null with rated reviews",
      rating: {
        averageBasisPoints: null,
        ratedReviewCount: 1,
        totalReviewCount: 1
      }
    },
    {
      name: "average exists without rated reviews",
      rating: {
        averageBasisPoints: 0,
        ratedReviewCount: 0,
        totalReviewCount: 1
      }
    }
  ])("rejects rating inconsistency: $name", ({ rating }) => {
    expect(
      storeDetailResponseSchema.safeParse({
        ...validResponse(),
        rating
      }).success
    ).toBe(false);
  });

  it("requires the rating and review sections to report the same total", () => {
    const response = validResponse();
    response.rating.totalReviewCount = 4;

    expect(storeDetailResponseSchema.safeParse(response).success).toBe(
      false
    );
  });

  it.each([
    {
      name: "available with fewer than three reviews",
      reviews: {
        ...validResponse().reviews,
        status: "AVAILABLE",
        totalCount: 2,
        totalPages: 1
      }
    },
    {
      name: "insufficient with three reviews",
      reviews: {
        ...validResponse().reviews,
        status: "INSUFFICIENT",
        totalCount: 3
      }
    },
    {
      name: "unavailable with a review item",
      reviews: {
        ...validResponse().reviews,
        status: "UNAVAILABLE",
        totalCount: 0,
        totalPages: 0
      }
    },
    {
      name: "incorrect total page count",
      reviews: {
        ...validResponse().reviews,
        totalPages: 1
      }
    },
    {
      name: "more items than the requested limit",
      reviews: {
        ...validResponse().reviews,
        limit: 1,
        totalPages: 3
      }
    }
  ])("rejects review inconsistency: $name", ({ reviews }) => {
    expect(
      storeDetailResponseSchema.safeParse({
        ...validResponse(),
        reviews
      }).success
    ).toBe(false);
  });

  it("accepts insufficient reviews and requires unavailable reviews to have no publish", () => {
    const insufficient = validResponse();
    insufficient.reviews = {
      status: "INSUFFICIENT",
      page: 1,
      limit: 10,
      totalCount: 2,
      totalPages: 1,
      items: insufficient.reviews.items.slice(0, 2)
    };
    insufficient.rating.totalReviewCount = 2;

    expect(
      storeDetailResponseSchema.safeParse(insufficient).success
    ).toBe(true);

    const unavailable = validResponse();
    unavailable.reviews = {
      status: "UNAVAILABLE",
      page: 1,
      limit: 10,
      totalCount: 0,
      totalPages: 0,
      items: []
    };
    unavailable.rating = {
      averageBasisPoints: null,
      ratedReviewCount: 0,
      totalReviewCount: 0
    };

    expect(
      storeDetailResponseSchema.safeParse(unavailable).success
    ).toBe(false);

    unavailable.metadata.reviewPublishVersionId = null;
    expect(
      storeDetailResponseSchema.safeParse(unavailable).success
    ).toBe(true);
  });

  it("requires a review publish whenever reviews are available or insufficient", () => {
    const response = validResponse();
    response.metadata.reviewPublishVersionId = null;

    expect(storeDetailResponseSchema.safeParse(response).success).toBe(
      false
    );
  });

  it("does not apply the request page cap to the response page count", () => {
    const response = validResponse();
    response.reviews = {
      ...response.reviews,
      limit: 20,
      totalCount: 20001,
      totalPages: 1001
    };
    response.rating.totalReviewCount = 20001;

    expect(storeDetailResponseSchema.safeParse(response).success).toBe(
      true
    );
  });
});
