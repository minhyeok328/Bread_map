import type {
  MenuCategory,
  ReviewEvidenceStatus,
  SearchErrorCode,
  SearchSortMode
} from "@bread-map/contracts";

export interface SearchFixtureMenu {
  menuId: string;
  name: string;
  normalizedName: string;
  category: MenuCategory;
  aliases: readonly {
    aliasId: string;
    alias: string;
    normalizedAlias: string;
  }[];
}

export interface SearchFixtureStoreAlias {
  aliasId: string;
  aliasType: "STORE_NAME" | "REGION";
  alias: string;
  normalizedAlias: string;
}

export interface SearchFixtureBusinessHour {
  intervalId: string;
  weekday: number;
  sequence: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
}

export interface SearchFixtureReview {
  reviewId: string;
  body: string;
  normalizedBody: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
}

export interface SearchFixtureStore {
  storeId: string;
  bakeryId: string;
  displayName: string;
  normalizedName: string;
  normalizedAddress: string;
  seoulDistrict: string;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
  menus: readonly SearchFixtureMenu[];
  aliases: readonly SearchFixtureStoreAlias[];
  hours: readonly SearchFixtureBusinessHour[];
  reviews: readonly SearchFixtureReview[];
}

export interface SearchScenarioInput {
  region: string | null;
  storeName: string | null;
  menuName: string | null;
  categories: readonly {
    category: MenuCategory;
    mode: "INCLUDE" | "EXCLUDE";
  }[];
  openNow: boolean;
  origin: {
    latitudeE7: number;
    longitudeE7: number;
  } | null;
  maxDistanceM: number | null;
  reviewEvidenceStatus: ReviewEvidenceStatus;
  sortMode: SearchSortMode;
}

export interface SearchEvaluationScenario {
  id: string;
  group:
    | "region"
    | "store"
    | "menu"
    | "category"
    | "visit"
    | "evidence"
    | "combined"
    | "degradation"
    | "expected-error";
  input: SearchScenarioInput;
  requestTimeMs: number;
  expectedTopFiveStoreIds: readonly string[];
  forbiddenStoreIds: readonly string[];
  countsTowardHitRate: boolean;
  requiredHit?: boolean;
  expectedStatus?: "COMPLETE" | "PARTIAL";
  expectedErrorCode?: SearchErrorCode;
  degradation?: "FTS_UNAVAILABLE";
  useMismatchedVersion?: boolean;
  ratingGuards?: readonly {
    strongerStoreId: string;
    weakerHighRatingStoreId: string;
  }[];
}

const categories: readonly MenuCategory[] = [
  "FERMENTED_BREAD",
  "PASTRY",
  "SALT_BREAD",
  "BAGUETTE",
  "LOAF_BREAD",
  "SWEET_BREAD",
  "SANDWICH",
  "DESSERT"
];

function padded(index: number): string {
  return String(index).padStart(2, "0");
}

function menu(
  storeIndex: number,
  position: number,
  overrides: Partial<SearchFixtureMenu> = {}
): SearchFixtureMenu {
  const suffix = `${padded(storeIndex)}_${position}`;
  const category =
    categories[(storeIndex * 2 + position) % categories.length]!;
  return {
    menuId: `menu_${suffix}`,
    name: `검증메뉴 ${suffix}`,
    normalizedName: `검증메뉴${suffix}`,
    category,
    aliases: [],
    ...overrides
  };
}

function reviews(
  storeIndex: number,
  count: number,
  keyword: string
): SearchFixtureReview[] {
  return Array.from({ length: count }, (_, reviewIndex) => ({
    reviewId: `review_${padded(storeIndex)}_${reviewIndex + 1}`,
    body: `${keyword} 후기 ${reviewIndex + 1}`,
    normalizedBody: `${keyword} 후기 ${reviewIndex + 1}`,
    ratingBasisPoints:
      storeIndex === 5
        ? 5000
        : storeIndex === 1
          ? 3500
          : 3800 + ((storeIndex + reviewIndex) % 10) * 100,
    publishedDate: `2026-07-${String(
      30 - (reviewIndex % 10)
    ).padStart(2, "0")}`
  }));
}

function buildStores(): SearchFixtureStore[] {
  return Array.from({ length: 30 }, (_, offset) => {
    const index = offset + 1;
    const id = padded(index);
    const menuCount = index <= 20 ? 2 : 1;
    const district =
      index <= 10
        ? "마포구"
        : index <= 20
          ? "종로구"
          : "강남구";
    const base: SearchFixtureStore = {
      storeId: `store_${id}`,
      bakeryId: `bakery_${id}`,
      displayName: `검증 빵집 ${id}`,
      normalizedName: `검증빵집${id}`,
      normalizedAddress: `서울특별시 ${district} 검증로 ${index}`,
      seoulDistrict: district,
      normalizedPhone:
        index % 3 === 0 ? null : `02${String(10000000 + index)}`,
      latitudeE7: 375634614 + offset * 10000,
      longitudeE7: 1269014494 + offset * 7000,
      menus: Array.from({ length: menuCount }, (_, position) =>
        menu(index, position)
      ),
      aliases: [
        {
          aliasId: `region_alias_${id}`,
          aliasType: "REGION",
          alias: `검증동네 ${id}`,
          normalizedAlias: `검증동네${id}`
        }
      ],
      hours: [
        {
          intervalId: `hours_${id}`,
          weekday: 4,
          sequence: 0,
          opensMinute: 600,
          closesMinute: 1080,
          closesNextDay: false
        }
      ],
      reviews: reviews(index, index % 5, `검증메뉴${id}`)
    };

    if (index === 1) {
      return {
        ...base,
        displayName: "한강 빵집",
        normalizedName: "한강빵집",
        menus: [
          menu(index, 0, {
            menuId: "menu_01_salt",
            name: "소금빵",
            normalizedName: "소금빵",
            category: "SALT_BREAD",
            aliases: [
              {
                aliasId: "menu_alias_01_sio",
                alias: "시오빵",
                normalizedAlias: "시오빵"
              }
            ]
          }),
          menu(index, 1, {
            menuId: "menu_01_croissant",
            name: "크루아상",
            normalizedName: "크루아상",
            category: "PASTRY"
          })
        ],
        aliases: [
          {
            aliasId: "region_alias_01_hongdae",
            aliasType: "REGION",
            alias: "홍대입구",
            normalizedAlias: "홍대입구"
          },
          {
            aliasId: "region_alias_01_hapjeong",
            aliasType: "REGION",
            alias: "합정역",
            normalizedAlias: "합정역"
          },
          {
            aliasId: "store_alias_01",
            aliasType: "STORE_NAME",
            alias: "한강제과",
            normalizedAlias: "한강제과"
          }
        ],
        reviews: reviews(1, 4, "소금빵")
      };
    }
    if (index === 2) {
      return {
        ...base,
        displayName: "새벽 제과",
        normalizedName: "새벽제과",
        menus: [
          menu(index, 0, {
            menuId: "menu_02_sourdough",
            name: "사워도우",
            normalizedName: "사워도우",
            category: "FERMENTED_BREAD"
          }),
          menu(index, 1, {
            menuId: "menu_02_baguette",
            name: "바게트",
            normalizedName: "바게트",
            category: "BAGUETTE"
          })
        ],
        hours: [
          {
            intervalId: "hours_02_overnight",
            weekday: 1,
            sequence: 0,
            opensMinute: 1320,
            closesMinute: 120,
            closesNextDay: true
          }
        ],
        reviews: reviews(2, 2, "사워도우")
      };
    }
    if (index === 3) {
      return {
        ...base,
        displayName: "북촌 제과",
        normalizedName: "북촌제과",
        seoulDistrict: "종로구",
        normalizedAddress: "서울특별시 종로구 북촌로 3"
      };
    }
    if (index === 5) {
      return {
        ...base,
        displayName: "리뷰 소금 연구소",
        normalizedName: "리뷰소금연구소",
        menus: [
          menu(index, 0, {
            category: "DESSERT"
          }),
          menu(index, 1, {
            category: "SWEET_BREAD"
          })
        ],
        reviews: reviews(5, 4, "소금빵")
      };
    }
    return base;
  });
}

const thursdayNoon = Date.parse("2026-07-30T12:00:00+09:00");
const tuesdayOneAm = Date.parse("2026-08-04T01:00:00+09:00");
const staleRequest = Date.parse("2026-08-31T12:00:00+09:00");

function baseInput(
  overrides: Partial<SearchScenarioInput> = {}
): SearchScenarioInput {
  return {
    region: null,
    storeName: null,
    menuName: null,
    categories: [],
    openNow: false,
    origin: null,
    maxDistanceM: null,
    reviewEvidenceStatus: "ANY",
    sortMode: "RELEVANCE",
    ...overrides
  };
}

export const searchEvaluationFixture = {
  fixtureId: "search-evaluation-v1",
  sourceBasisDate: "2026-07-30",
  stores: buildStores(),
  scenarios: [
    {
      id: "region-district",
      group: "region",
      input: baseInput({ region: "마포구" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_11"],
      countsTowardHitRate: true
    },
    {
      id: "region-neighborhood-alias",
      group: "region",
      input: baseInput({ region: "홍대 입구" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "region-station-alias",
      group: "region",
      input: baseInput({ region: "합정역" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "store-exact",
      group: "store",
      input: baseInput({ storeName: "한강 빵집" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "store-approved-alias",
      group: "store",
      input: baseInput({ storeName: "한강 제과" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "menu-exact",
      group: "menu",
      input: baseInput({ menuName: "소금빵" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: [],
      countsTowardHitRate: true,
      ratingGuards: [
        {
          strongerStoreId: "store_01",
          weakerHighRatingStoreId: "store_05"
        }
      ]
    },
    {
      id: "menu-synonym",
      group: "menu",
      input: baseInput({ menuName: "시오빵" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: [],
      countsTowardHitRate: true
    },
    {
      id: "menu-review-fallback",
      group: "menu",
      input: baseInput({
        storeName: "리뷰 소금 연구소",
        menuName: "소금빵"
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_05"],
      forbiddenStoreIds: ["store_01"],
      countsTowardHitRate: true,
      requiredHit: true
    },
    {
      id: "category-include",
      group: "category",
      input: baseInput({
        categories: [{ category: "PASTRY", mode: "INCLUDE" }]
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "category-exclude",
      group: "category",
      input: baseInput({
        categories: [
          { category: "SALT_BREAD", mode: "EXCLUDE" }
        ]
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_02"],
      forbiddenStoreIds: ["store_01"],
      countsTowardHitRate: true
    },
    {
      id: "open-now",
      group: "visit",
      input: baseInput({
        storeName: "한강 빵집",
        openNow: true
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: [],
      countsTowardHitRate: true
    },
    {
      id: "overnight-open",
      group: "visit",
      input: baseInput({
        storeName: "새벽 제과",
        openNow: true
      }),
      requestTimeMs: tuesdayOneAm,
      expectedTopFiveStoreIds: ["store_02"],
      forbiddenStoreIds: [],
      countsTowardHitRate: true
    },
    {
      id: "distance-boundary",
      group: "visit",
      input: baseInput({
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        },
        maxDistanceM: 100
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "distance-sort",
      group: "visit",
      input: baseInput({
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        },
        sortMode: "DISTANCE"
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: [],
      countsTowardHitRate: true
    },
    {
      id: "reviews-available",
      group: "evidence",
      input: baseInput({
        reviewEvidenceStatus: "AVAILABLE"
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_02"],
      countsTowardHitRate: true
    },
    {
      id: "reviews-insufficient",
      group: "evidence",
      input: baseInput({
        storeName: "새벽 제과",
        reviewEvidenceStatus: "INSUFFICIENT"
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_02"],
      forbiddenStoreIds: ["store_01"],
      countsTowardHitRate: true
    },
    {
      id: "combined-hard-filters",
      group: "combined",
      input: baseInput({
        region: "홍대입구",
        menuName: "소금빵",
        categories: [
          { category: "SALT_BREAD", mode: "INCLUDE" }
        ],
        openNow: true,
        origin: {
          latitudeE7: 375634614,
          longitudeE7: 1269014494
        },
        maxDistanceM: 500
      }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_05"],
      countsTowardHitRate: true
    },
    {
      id: "fts-unavailable-fallback",
      group: "degradation",
      input: baseInput({ menuName: "소금빵" }),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: ["store_01"],
      forbiddenStoreIds: ["store_05"],
      countsTowardHitRate: true,
      requiredHit: true,
      expectedStatus: "PARTIAL",
      degradation: "FTS_UNAVAILABLE"
    },
    {
      id: "version-mismatch",
      group: "expected-error",
      input: baseInput(),
      requestTimeMs: thursdayNoon,
      expectedTopFiveStoreIds: [],
      forbiddenStoreIds: [],
      countsTowardHitRate: false,
      expectedErrorCode: "SEARCH_DATA_VERSION_MISMATCH",
      useMismatchedVersion: true
    },
    {
      id: "stale-source",
      group: "expected-error",
      input: baseInput(),
      requestTimeMs: staleRequest,
      expectedTopFiveStoreIds: [],
      forbiddenStoreIds: [],
      countsTowardHitRate: false,
      expectedErrorCode: "SEARCH_DATA_STALE"
    }
  ] satisfies readonly SearchEvaluationScenario[]
} as const;
