import type {
  MenuCategory,
  OpeningState,
  PublicReviewStatus,
  StoreDetailResponse,
  StructuredSearchItem
} from "@bread-map/contracts";

export interface RecoveryCopy {
  title: string;
  description: string;
  action: string;
}

const categoryLabels: Record<MenuCategory, string> = {
  FERMENTED_BREAD: "발효빵",
  PASTRY: "페이스트리",
  SALT_BREAD: "소금빵",
  BAGUETTE: "바게트",
  LOAF_BREAD: "식빵",
  SWEET_BREAD: "단과자빵",
  SANDWICH: "샌드위치",
  DESSERT: "디저트"
};

const weekdayLabels = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일"
] as const;

export function categoryLabel(category: MenuCategory): string {
  return categoryLabels[category];
}

export function distanceLabel(
  distanceUpperBoundM: number | null
): string {
  if (distanceUpperBoundM === null) {
    return "거리 정보 없음";
  }
  if (distanceUpperBoundM < 1_000) {
    return `${distanceUpperBoundM}m 이내`;
  }
  const kilometers = Number(
    (distanceUpperBoundM / 1_000).toFixed(2)
  );
  return `${kilometers}km 이내`;
}

export function openingStateCopy(
  openingState: OpeningState
): {
  label: string;
  description: string;
} {
  switch (openingState) {
    case "OPEN":
      return {
        label: "영업 중",
        description: "검수된 영업시간 기준"
      };
    case "CLOSED":
      return {
        label: "영업 종료",
        description: "검수된 영업시간 기준"
      };
    case "UNKNOWN":
      return {
        label: "영업시간 확인 필요",
        description: "방문 전에 매장에 확인해 주세요"
      };
  }
}

export function reviewStatusCopy(
  status: PublicReviewStatus
): string {
  return status === "AVAILABLE"
    ? "최근 비식별 리뷰 근거가 있어요."
    : "최근 리뷰 근거가 부족해 확인된 메뉴와 방문 조건을 중심으로 표시합니다.";
}

export function searchReasonCopy(
  item: StructuredSearchItem
): string {
  const firstMenu = item.representativeMenus[0];
  if (
    item.reasonCodes.includes("MENU_MATCH") &&
    firstMenu !== undefined
  ) {
    return `대표 메뉴 ${firstMenu.name}이 검색 조건과 일치해요.`;
  }
  const firstCategory = item.categories[0];
  if (
    item.reasonCodes.includes("CATEGORY_MATCH") &&
    firstCategory !== undefined
  ) {
    return `${categoryLabel(firstCategory)} 카테고리가 검색 조건과 일치해요.`;
  }
  if (item.reasonCodes.includes("STORE_NAME_MATCH")) {
    return "가게명이 검색 조건과 일치해요.";
  }
  if (item.reasonCodes.includes("REVIEW_EVIDENCE")) {
    return "최근 비식별 리뷰 근거를 확인했어요.";
  }
  if (item.reasonCodes.includes("REGION_MATCH")) {
    return `${item.seoulDistrict} 지역 조건과 일치해요.`;
  }
  return "검수된 메뉴와 방문 조건을 확인했어요.";
}

export function formatBasisDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일 기준`;
}

export function formatRating(
  averageBasisPoints: number | null,
  ratedReviewCount: number
): {
  visible: string;
  accessible: string;
} | null {
  if (averageBasisPoints === null || ratedReviewCount === 0) {
    return null;
  }
  const visible = (Math.round(averageBasisPoints / 10) / 100)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return {
    visible,
    accessible: `5점 만점에 ${visible}점, 평점 리뷰 ${ratedReviewCount}개`
  };
}

function minuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatBusinessInterval(
  interval: StoreDetailResponse["businessHours"]["items"][number]
): string {
  const nextDay = interval.closesNextDay ? "다음 날 " : "";
  return `${weekdayLabels[interval.weekday]} ${minuteLabel(
    interval.opensMinute
  )}–${nextDay}${minuteLabel(interval.closesMinute)}`;
}

export function searchErrorCopy(code: string): RecoveryCopy {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return {
        title: "카카오 로그인이 필요해요",
        description:
          "계정별 검색과 가게 정보를 사용하려면 먼저 로그인해 주세요.",
        action: "카카오로 시작하기"
      };
    case "SEARCH_INPUT_INVALID":
    case "INVALID_INPUT":
    case "ORIGIN_REQUIRED":
      return {
        title: "검색 조건을 확인해 주세요",
        description:
          "지역·가게·메뉴·카테고리와 방문 조건을 다시 확인해 주세요.",
        action: "조건 다시 확인"
      };
    case "SEARCH_DATA_STALE":
    case "STALE_DATA":
      return {
        title: "최신 영업 상태를 확인할 수 없어요",
        description:
          "새 검색을 잠시 멈췄어요. 원장 동기화 뒤 다시 시도해 주세요.",
        action: "원장 상태 확인 후 재시도"
      };
    case "SEARCH_DATA_VERSION_MISMATCH":
      return {
        title: "검색 데이터가 갱신됐어요",
        description: "같은 조건으로 최신 결과를 다시 확인해 주세요.",
        action: "최신 결과 다시 찾기"
      };
    default:
      return {
        title: "검색 데이터를 확인할 수 없어요",
        description:
          "검색 조건은 유지했어요. 로컬 상태를 확인한 뒤 다시 시도해 주세요.",
        action: "다시 시도"
      };
  }
}

export function detailErrorCopy(code: string): RecoveryCopy {
  switch (code) {
    case "RESOURCE_NOT_FOUND":
    case "NOT_FOUND":
      return {
        title: "가게 정보를 찾을 수 없어요",
        description:
          "현재 검색 결과로 돌아가 다른 가게를 확인해 주세요.",
        action: "검색 결과로 돌아가기"
      };
    case "SNAPSHOT_MISMATCH":
    case "SEARCH_DATA_VERSION_MISMATCH":
      return {
        title: "검색 결과가 갱신됐어요",
        description:
          "검색 결과가 갱신되어 이 상세를 그대로 표시할 수 없어요.",
        action: "검색 결과로 돌아가기"
      };
    default:
      return {
        title: "가게 정보를 불러오지 못했어요",
        description:
          "검색 결과와 주소는 유지했어요. 잠시 후 다시 열어 주세요.",
        action: "검색 결과로 돌아가기"
      };
  }
}
