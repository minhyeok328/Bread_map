"use client";

import type {
  RelaxationCode,
  StoreSearchRequest
} from "@bread-map/contracts";
import Link from "next/link";
import {
  useLayoutEffect,
  useRef
} from "react";
import type {
  MapShellState
} from "../layout/map-shell-state";
import { searchErrorCopy } from "./store-presenters";
import {
  StoreDetail
} from "./store-detail";
import { StoreList } from "./store-list";
import { StoreSearchForm } from "./store-search-form";

const relaxationCopy: Record<RelaxationCode, string> = {
  EXPAND_REGION_OR_DISTANCE: "지역 또는 거리 범위를 한 단계 넓히기",
  DISABLE_OPEN_NOW: "현재 영업 중 필터 해제",
  INCLUDE_INSUFFICIENT_REVIEWS: "리뷰 근거 부족 매장 포함",
  EXPAND_ADJACENT_CATEGORY: "인접한 메뉴 카테고리 보기"
};

export interface StoreDrawerProps {
  state: MapShellState;
  onSearch(request: StoreSearchRequest): Promise<void>;
  onRetrySearch(): void;
  onSelect(storeId: string): void;
  onBack(): void;
  onToggleDrawer(): void;
  onToggleMobileSurface(): void;
}

function resultAnnouncement(state: MapShellState): string {
  if (state.searchStatus === "LOADING") {
    return "조건에 맞는 빵집을 찾고 있어요.";
  }
  const result = state.searchResult;
  if (result === null) {
    return "";
  }
  if (result.items.length === 0) {
    return "현재 조건과 데이터에서는 확인된 후보가 없습니다.";
  }
  return `${result.items.length}개의 빵집을 찾았어요. 선두 후보는 ${result.items[0]!.displayName}입니다.`;
}

export function StoreDrawer({
  state,
  onSearch,
  onRetrySearch,
  onSelect,
  onBack,
  onToggleDrawer,
  onToggleMobileSurface
}: StoreDrawerProps) {
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const collapsed = state.drawerVisibility === "COLLAPSED";
  const result = state.searchResult;
  const selectedItem =
    result?.items.find(
      (item) => item.storeId === state.selectedStoreId
    ) ?? null;

  useLayoutEffect(() => {
    if (drawerContentRef.current !== null) {
      drawerContentRef.current.scrollTop = 0;
    }
  }, [state.drawerView]);

  return (
    <aside
      className="store-drawer"
      data-visibility={state.drawerVisibility}
      data-view={state.drawerView}
      aria-label="빵집 검색과 결과"
    >
      <button
        className="drawer-toggle"
        type="button"
        onClick={onToggleDrawer}
        aria-label={collapsed ? "검색 패널 펼치기" : "검색 패널 접기"}
        title={collapsed ? "검색 패널 펼치기" : "검색 패널 접기"}
        aria-expanded={!collapsed}
      >
        {collapsed ? "→" : "←"}
      </button>

      <div ref={drawerContentRef} className="drawer-content">
        <div
          className="list-view"
          hidden={state.drawerView !== "LIST"}
        >
          <StoreSearchForm
            loading={state.searchStatus === "LOADING"}
            onSearch={onSearch}
          />

          <div className="mobile-surface-switch">
            <button
              type="button"
              className="secondary-button"
              onClick={onToggleMobileSurface}
            >
              {state.mobileSurface === "LIST"
                ? "지도 보기"
                : "목록 보기"}
            </button>
          </div>

          <p
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {resultAnnouncement(state)}
          </p>

          {state.searchStatus === "IDLE" ? (
            <section className="drawer-state initial-state">
              <span className="state-symbol" aria-hidden="true">
                ⌁
              </span>
              <h2>검색 조건을 조합해 보세요</h2>
              <p>
                확인된 메뉴와 방문 조건을 근거로 모든 후보를
                같은 순서로 지도와 목록에 표시합니다.
              </p>
            </section>
          ) : null}

          {state.searchStatus === "LOADING" ? (
            <section
              className="drawer-state loading-state"
              aria-busy="true"
            >
              <div className="loading-mark" aria-hidden="true" />
              <h2>조건에 맞는 빵집을 찾고 있어요</h2>
              <p>
                적격성·강한 제외를 먼저 확인한 뒤 메뉴와 리뷰
                근거를 비교합니다.
              </p>
            </section>
          ) : null}

          {state.searchStatus === "ERROR" ? (
            <section className="drawer-state error-state">
              {(() => {
                const copy = searchErrorCopy(
                  state.searchErrorCode ?? "UNKNOWN"
                );
                return (
                  <>
                    <span className="state-icon" aria-hidden="true">
                      !
                    </span>
                    <h2>{copy.title}</h2>
                    <p>{copy.description}</p>
                    {state.searchErrorCode ===
                    "AUTHENTICATION_REQUIRED" ? (
                      <Link
                        className="primary-button"
                        href="/api/auth/signin"
                      >
                        {copy.action}
                      </Link>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={onRetrySearch}
                      >
                        {copy.action}
                      </button>
                    )}
                  </>
                );
              })()}
            </section>
          ) : null}

          {state.searchStatus === "EMPTY" && result ? (
            <section className="drawer-state empty-state">
              <span className="state-symbol" aria-hidden="true">
                ∅
              </span>
              <h2>
                현재 조건과 데이터에서는 확인된 후보를 찾지
                못했어요
              </h2>
              <p>
                빵집이 없다고 단정하지 않아요. 아래 항목 중
                원하는 조건만 직접 바꿔 다시 찾아보세요.
              </p>
              {result.relaxationOptions.length > 0 ? (
                <ul className="relaxation-list">
                  {result.relaxationOptions.map((option) => (
                    <li key={option}>
                      <a href="#search-heading">
                        {relaxationCopy[option]}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {(state.searchStatus === "SUCCESS" ||
            state.searchStatus === "PARTIAL") &&
          result ? (
            <section
              className="result-section"
              aria-labelledby="results-heading"
            >
              <header className="result-summary">
                <div>
                  <p className="eyebrow">
                    {result.metadata.sourceBasisDate} 데이터
                  </p>
                  <h2 id="results-heading">
                    확인된 빵집 {result.items.length}곳
                  </h2>
                </div>
                <span className="result-count tabular-number">
                  {result.items.length}
                </span>
              </header>
              {state.searchStatus === "PARTIAL" ? (
                <div
                  className="inline-notice info-notice"
                  role="status"
                >
                  리뷰 검색을 사용할 수 없어 메뉴·카테고리·지역
                  조건으로 결과를 표시합니다.
                </div>
              ) : null}
              <StoreList
                items={result.items}
                selectedStoreId={state.selectedStoreId}
                sourceBasisDate={
                  result.metadata.sourceBasisDate
                }
                onSelect={onSelect}
              />
            </section>
          ) : null}
        </div>

        <div
          className="detail-view"
          hidden={state.drawerView !== "DETAIL"}
        >
          <StoreDetail
            status={state.detailStatus}
            detail={state.detail}
            errorCode={state.detailErrorCode}
            fallbackItem={selectedItem}
            onBack={onBack}
            onShowMap={onToggleMobileSurface}
          />
        </div>
      </div>
    </aside>
  );
}
