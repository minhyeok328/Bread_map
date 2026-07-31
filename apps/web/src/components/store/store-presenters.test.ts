import type {
  StoreDetailResponse,
  StructuredSearchItem
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  detailErrorCopy,
  distanceLabel,
  formatBasisDate,
  formatBusinessInterval,
  formatRating,
  openingStateCopy,
  reviewStatusCopy,
  searchErrorCopy,
  searchReasonCopy
} from "./store-presenters.js";

const item: StructuredSearchItem = {
  storeId: "store-a",
  bakeryId: "bakery-a",
  displayName: "테스트 베이커리",
  normalizedAddress: "서울특별시 마포구 테스트로 1",
  seoulDistrict: "마포구",
  latitudeE7: 375_000_000,
  longitudeE7: 1_270_000_000,
  distanceUpperBoundM: 1_250,
  openingState: "OPEN",
  representativeMenus: [
    {
      menuId: "menu-a",
      name: "소금빵",
      category: "SALT_BREAD",
      evidenceId: "evidence-a"
    }
  ],
  categories: ["SALT_BREAD"],
  review: {
    status: "INSUFFICIENT",
    count: 2,
    latestPublishedDate: "2026-07-29",
    snippet: "버터 향이 선명해요."
  },
  reasonCodes: ["MENU_MATCH", "REGION_MATCH"],
  warningCodes: ["INSUFFICIENT_REVIEWS"]
};

describe("store presenters", () => {
  it("formats only public upper-bound distance with tabular-friendly text", () => {
    expect(distanceLabel(250)).toBe("250m 이내");
    expect(distanceLabel(1_250)).toBe("1.25km 이내");
    expect(distanceLabel(null)).toBe("거리 정보 없음");
  });

  it("maps opening and review states to explicit Korean copy", () => {
    expect(openingStateCopy("OPEN")).toEqual({
      label: "영업 중",
      description: "검수된 영업시간 기준"
    });
    expect(openingStateCopy("CLOSED").label).toBe("영업 종료");
    expect(openingStateCopy("UNKNOWN").label).toBe(
      "영업시간 확인 필요"
    );
    expect(reviewStatusCopy("INSUFFICIENT")).toContain(
      "최근 리뷰 근거가 부족해"
    );
    expect(reviewStatusCopy("AVAILABLE")).toBe(
      "최근 비식별 리뷰 근거가 있어요."
    );
  });

  it("uses verified menu and category evidence for card reasons", () => {
    expect(searchReasonCopy(item)).toBe(
      "대표 메뉴 소금빵이 검색 조건과 일치해요."
    );
    expect(categoryLabel("FERMENTED_BREAD")).toBe("발효빵");
    expect(categoryLabel("SALT_BREAD")).toBe("소금빵");
  });

  it("formats source dates, ratings, and overnight hours accessibly", () => {
    expect(formatBasisDate("2026-07-30")).toBe(
      "2026년 7월 30일 기준"
    );
    expect(formatRating(4_725, 8)).toEqual({
      visible: "4.73",
      accessible: "5점 만점에 4.73점, 평점 리뷰 8개"
    });
    expect(formatRating(null, 0)).toBeNull();

    const interval: StoreDetailResponse["businessHours"]["items"][number] =
      {
        intervalId: "hours-a",
        weekday: 5,
        sequence: 0,
        opensMinute: 1_320,
        closesMinute: 120,
        closesNextDay: true,
        evidenceId: "hours-a",
        source: "MANUAL_VERIFIED",
        verifiedAtMs: 1_754_000_000_000
      };
    expect(formatBusinessInterval(interval)).toBe(
      "금요일 22:00–다음 날 02:00"
    );
  });
});

describe("safe recovery copy", () => {
  it.each([
    [
      "AUTHENTICATION_REQUIRED",
      "카카오 로그인이 필요해요",
      "카카오로 시작하기"
    ],
    [
      "SEARCH_INPUT_INVALID",
      "검색 조건을 확인해 주세요",
      "조건 다시 확인"
    ],
    [
      "INVALID_INPUT",
      "검색 조건을 확인해 주세요",
      "조건 다시 확인"
    ],
    [
      "SEARCH_DATA_STALE",
      "최신 영업 상태를 확인할 수 없어요",
      "원장 상태 확인 후 재시도"
    ],
    [
      "STALE_DATA",
      "최신 영업 상태를 확인할 수 없어요",
      "원장 상태 확인 후 재시도"
    ],
    [
      "NETWORK_UNAVAILABLE",
      "검색 데이터를 확인할 수 없어요",
      "다시 시도"
    ]
  ])("maps %s without internal detail", (code, title, action) => {
    const copy = searchErrorCopy(code);
    expect(copy.title).toBe(title);
    expect(copy.action).toBe(action);
    expect(JSON.stringify(copy)).not.toMatch(
      /sqlite|stack|token|fingerprint/i
    );
  });

  it("keeps not-found and snapshot detail errors recoverable", () => {
    expect(detailErrorCopy("RESOURCE_NOT_FOUND")).toEqual({
      title: "가게 정보를 찾을 수 없어요",
      description:
        "현재 검색 결과로 돌아가 다른 가게를 확인해 주세요.",
      action: "검색 결과로 돌아가기"
    });
    expect(
      detailErrorCopy("SNAPSHOT_MISMATCH").description
    ).toContain("검색 결과가 갱신");
    expect(detailErrorCopy("NOT_FOUND").title).toBe(
      "가게 정보를 찾을 수 없어요"
    );
  });
});
