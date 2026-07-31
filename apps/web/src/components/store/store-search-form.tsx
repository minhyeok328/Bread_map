"use client";

import {
  menuCategories,
  RECOMMENDATION_VERSION,
  type MenuCategory,
  type StoreSearchRequest
} from "@bread-map/contracts";
import {
  useState,
  type FormEvent
} from "react";
import { categoryLabel } from "./store-presenters";

type CategoryMode = "NONE" | "INCLUDE" | "EXCLUDE";
type RequestOrigin =
  StoreSearchRequest["query"]["origin"];

export interface StoreSearchFormProps {
  loading: boolean;
  onSearch(request: StoreSearchRequest): Promise<void>;
}

function initialCategoryModes(): Record<
  MenuCategory,
  CategoryMode
> {
  return Object.fromEntries(
    menuCategories.map((category) => [category, "NONE"])
  ) as Record<MenuCategory, CategoryMode>;
}

function nextCategoryMode(mode: CategoryMode): CategoryMode {
  switch (mode) {
    case "NONE":
      return "INCLUDE";
    case "INCLUDE":
      return "EXCLUDE";
    case "EXCLUDE":
      return "NONE";
  }
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function readCurrentOrigin(): Promise<
  NonNullable<RequestOrigin>
> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitudeE7: Math.round(
            position.coords.latitude * 10_000_000
          ),
          longitudeE7: Math.round(
            position.coords.longitude * 10_000_000
          )
        });
      },
      () => {
        reject(new Error("geolocation unavailable"));
      },
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 0
      }
    );
  });
}

export function StoreSearchForm({
  loading,
  onSearch
}: StoreSearchFormProps) {
  const [region, setRegion] = useState("");
  const [storeName, setStoreName] = useState("");
  const [menuName, setMenuName] = useState("");
  const [categoryModes, setCategoryModes] = useState(
    initialCategoryModes
  );
  const [openNow, setOpenNow] = useState(false);
  const [reviewEvidenceStatus, setReviewEvidenceStatus] =
    useState<"ANY" | "AVAILABLE" | "INSUFFICIENT">("ANY");
  const [useCurrentLocation, setUseCurrentLocation] =
    useState(false);
  const [maxDistanceM, setMaxDistanceM] = useState(2_000);
  const [sortMode, setSortMode] = useState<
    "RELEVANCE" | "DISTANCE"
  >("RELEVANCE");
  const [locationStatus, setLocationStatus] = useState<
    "IDLE" | "LOCATING" | "ERROR"
  >("IDLE");

  const busy = loading || locationStatus === "LOCATING";

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (busy) {
      return;
    }

    let origin: RequestOrigin = null;
    try {
      if (useCurrentLocation) {
        setLocationStatus("LOCATING");
        origin = await readCurrentOrigin();
      }

      const categories = menuCategories.flatMap((category) => {
        const mode = categoryModes[category];
        return mode === "NONE"
          ? []
          : [{ category, mode } as const];
      });
      await onSearch({
        query: {
          region: nullableText(region),
          storeName: nullableText(storeName),
          menuName: nullableText(menuName),
          categories,
          openNow,
          origin,
          maxDistanceM:
            origin === null ? null : maxDistanceM,
          reviewEvidenceStatus,
          sortMode:
            origin === null ? "RELEVANCE" : sortMode,
          recommendationVersion: RECOMMENDATION_VERSION
        },
        dataSnapshotVersion: null
      });
      setLocationStatus("IDLE");
    } catch {
      setLocationStatus("ERROR");
    } finally {
      origin = null;
    }
  }

  return (
    <form
      className="store-search"
      aria-labelledby="search-heading"
      onSubmit={handleSubmit}
      autoComplete="off"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">서울 베이커리 탐색</p>
          <h1 id="search-heading">오늘 찾고 싶은 빵이 있나요?</h1>
        </div>
      </div>

      <p className="search-intro">
        지역·가게·메뉴·카테고리와 방문 조건으로 검수된
        독립 베이커리를 찾아보세요.
      </p>

      <div className="search-field-grid">
        <label className="field field-wide">
          <span>지역</span>
          <input
            name="region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            placeholder="예: 망원동, 성수역"
            maxLength={100}
          />
        </label>
        <label className="field">
          <span>가게명</span>
          <input
            name="storeName"
            value={storeName}
            onChange={(event) =>
              setStoreName(event.target.value)
            }
            placeholder="알고 있는 가게"
            maxLength={100}
          />
        </label>
        <label className="field">
          <span>메뉴</span>
          <input
            name="menuName"
            value={menuName}
            onChange={(event) =>
              setMenuName(event.target.value)
            }
            placeholder="예: 소금빵"
            maxLength={100}
          />
        </label>
      </div>

      <fieldset className="filter-group">
        <legend>카테고리</legend>
        <p className="field-help">
          한 번 누르면 포함, 두 번 누르면 제외됩니다.
        </p>
        <div className="chip-row">
          {menuCategories.map((category) => {
            const mode = categoryModes[category];
            const modeLabel =
              mode === "INCLUDE"
                ? "포함"
                : mode === "EXCLUDE"
                  ? "제외"
                  : "미적용";
            return (
              <button
                key={category}
                type="button"
                className="filter-chip"
                data-mode={mode}
                aria-pressed={mode !== "NONE"}
                aria-label={`${categoryLabel(category)}: ${modeLabel}`}
                onClick={() => {
                  setCategoryModes((current) => ({
                    ...current,
                    [category]: nextCategoryMode(
                      current[category]
                    )
                  }));
                }}
              >
                {mode === "EXCLUDE" ? "− " : ""}
                {categoryLabel(category)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="search-options">
        <label className="check-control">
          <input
            type="checkbox"
            checked={openNow}
            onChange={(event) =>
              setOpenNow(event.target.checked)
            }
          />
          <span>현재 영업 중</span>
        </label>
        <label className="field compact-field">
          <span>리뷰 근거</span>
          <select
            value={reviewEvidenceStatus}
            onChange={(event) =>
              setReviewEvidenceStatus(
                event.target.value as
                  | "ANY"
                  | "AVAILABLE"
                  | "INSUFFICIENT"
              )
            }
          >
            <option value="ANY">부족 포함</option>
            <option value="AVAILABLE">근거 있음</option>
            <option value="INSUFFICIENT">부족만</option>
          </select>
        </label>
      </div>

      <div className="location-panel">
        <label className="check-control location-choice">
          <input
            type="checkbox"
            checked={useCurrentLocation}
            onChange={(event) => {
              setUseCurrentLocation(event.target.checked);
              setLocationStatus("IDLE");
            }}
            aria-describedby="location-explanation"
          />
          <span>현재 위치를 이번 검색에만 사용</span>
        </label>
        <p id="location-explanation" className="field-help">
          가까운 가게와 거리 계산에만 사용합니다. 지도 표시를
          위해 Kakao에 전송될 수 있지만 계정·기록·로그에는
          저장하지 않습니다. 동의하지 않아도 지역을 직접
          입력할 수 있어요.
        </p>
        {useCurrentLocation ? (
          <div className="location-options">
            <label className="field compact-field">
              <span>거리</span>
              <select
                value={maxDistanceM}
                onChange={(event) =>
                  setMaxDistanceM(Number(event.target.value))
                }
              >
                <option value={1_000}>1km 이내</option>
                <option value={2_000}>2km 이내</option>
                <option value={5_000}>5km 이내</option>
                <option value={10_000}>10km 이내</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>정렬</span>
              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(
                    event.target.value as
                      | "RELEVANCE"
                      | "DISTANCE"
                  )
                }
              >
                <option value="RELEVANCE">근거 순</option>
                <option value="DISTANCE">가까운 순</option>
              </select>
            </label>
          </div>
        ) : null}
        {locationStatus === "ERROR" ? (
          <div className="inline-notice warning-notice" role="status">
            <strong>현재 위치를 사용할 수 없어요.</strong>
            <span>
              구·동·역을 입력하면 같은 검색을 계속할 수 있어요.
            </span>
          </div>
        ) : null}
      </div>

      <button
        className="primary-button search-submit"
        type="submit"
        disabled={busy}
      >
        {locationStatus === "LOCATING"
          ? "현재 위치를 확인하고 있어요"
          : loading
            ? "조건에 맞는 빵집을 찾고 있어요"
            : "빵집 찾기"}
      </button>

      <p className="safety-note">
        재료·알레르기·교차접촉 안전은 보장하지 않습니다.
        주문하거나 방문하기 전에 매장에 직접 확인해 주세요.
      </p>
    </form>
  );
}
