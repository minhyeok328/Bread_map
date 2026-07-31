import type {
  StoreDetailResponse,
  StructuredSearchItem
} from "@bread-map/contracts";
import type {
  DetailStatus,
  MapShellErrorCode
} from "../layout/map-shell-state";
import {
  categoryLabel,
  detailErrorCopy,
  formatBasisDate,
  formatBusinessInterval,
  formatRating,
  openingStateCopy
} from "./store-presenters";

export interface StoreDetailProps {
  status: DetailStatus;
  detail: StoreDetailResponse | null;
  errorCode: MapShellErrorCode | null;
  fallbackItem: StructuredSearchItem | null;
  onBack(): void;
  onShowMap(): void;
}

export function StoreDetail({
  status,
  detail,
  errorCode,
  fallbackItem,
  onBack,
  onShowMap
}: StoreDetailProps) {
  if (status === "LOADING") {
    return (
      <section className="store-detail state-panel" aria-busy="true">
        <button className="text-button back-button" onClick={onBack}>
          ← 검색 결과로 돌아가기
        </button>
        <div className="loading-mark" aria-hidden="true" />
        <h2>가게 정보와 근거를 불러오고 있어요</h2>
        <p>{fallbackItem?.displayName ?? "선택한 가게"}</p>
      </section>
    );
  }

  if (status === "ERROR" || detail === null) {
    const copy = detailErrorCopy(errorCode ?? "UNKNOWN");
    return (
      <section className="store-detail state-panel">
        <button className="text-button back-button" onClick={onBack}>
          ← 검색 결과로 돌아가기
        </button>
        <span className="state-icon" aria-hidden="true">
          !
        </span>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
        {fallbackItem ? (
          <address>{fallbackItem.normalizedAddress}</address>
        ) : null}
        <button className="secondary-button" onClick={onBack}>
          {copy.action}
        </button>
      </section>
    );
  }

  const opening = openingStateCopy(detail.store.openingState);
  const rating = formatRating(
    detail.rating.averageBasisPoints,
    detail.rating.ratedReviewCount
  );

  return (
    <article
      className="store-detail"
      data-store-id={detail.store.storeId}
    >
      <div className="detail-toolbar">
        <button
          className="text-button back-button"
          type="button"
          onClick={onBack}
        >
          ← 검색 결과로 돌아가기
        </button>
        <button
          className="icon-text-button mobile-map-action"
          type="button"
          onClick={onShowMap}
        >
          지도 보기
        </button>
      </div>

      <header className="detail-header">
        <p className="eyebrow">{detail.store.seoulDistrict}</p>
        <h2>{detail.store.displayName}</h2>
        <address>{detail.store.normalizedAddress}</address>
        <div className="detail-status-row">
          <span
            className="status-badge"
            data-opening={detail.store.openingState}
          >
            {opening.label}
          </span>
          <span>{opening.description}</span>
        </div>
        <p className="basis-date">
          {formatBasisDate(detail.freshness.sourceBasisDate)}
        </p>
        {detail.freshness.status === "WARNING" ? (
          <div className="inline-notice warning-notice" role="status">
            <strong>정보 확인 필요</strong>
            <span>
              매장 정보가 평소보다 오래됐어요. 방문 전에 직접
              확인해 주세요.
            </span>
          </div>
        ) : null}
      </header>

      <section className="detail-section" aria-labelledby="menu-heading">
        <div className="detail-section-heading">
          <h3 id="menu-heading">확인된 메뉴</h3>
          <span>수동 검수 근거</span>
        </div>
        {detail.menus.status === "AVAILABLE" &&
        detail.menus.items.length > 0 ? (
          <ul className="detail-menu-list">
            {detail.menus.items.map((menu) => (
              <li key={menu.menuId}>
                <strong>{menu.name}</strong>
                <span>{categoryLabel(menu.category)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-section-copy">
            표시할 수 있는 검수 메뉴가 아직 없어요.
          </p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="hours-heading">
        <div className="detail-section-heading">
          <h3 id="hours-heading">영업시간</h3>
          <span>방문 전 재확인 권장</span>
        </div>
        {detail.businessHours.status === "AVAILABLE" &&
        detail.businessHours.items.length > 0 ? (
          <ul className="hours-list">
            {detail.businessHours.items.map((interval) => (
              <li key={interval.intervalId}>
                {formatBusinessInterval(interval)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-section-copy">
            검수된 영업시간을 표시할 수 없어요.
          </p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="review-heading">
        <div className="detail-section-heading">
          <h3 id="review-heading">비식별 리뷰 근거</h3>
          {rating ? (
            <span
              className="rating tabular-number"
              aria-label={rating.accessible}
            >
              <span aria-hidden="true">★ {rating.visible}</span>
            </span>
          ) : (
            <span>평점 근거 없음</span>
          )}
        </div>
        {detail.reviews.status === "INSUFFICIENT" ? (
          <div className="inline-notice evidence-warning">
            최근 리뷰 근거가 부족해 확인된 메뉴와 방문 조건을
            중심으로 표시합니다.
          </div>
        ) : null}
        {detail.reviews.status === "UNAVAILABLE" ? (
          <div className="empty-section-copy">
            <strong>표시할 수 있는 최근 리뷰가 아직 없어요.</strong>
            <span>
              확인된 메뉴·영업 정보와 데이터 기준일은 계속 볼
              수 있어요.
            </span>
          </div>
        ) : (
          <ul className="review-list">
            {detail.reviews.items.map((review) => (
              <li key={review.reviewId}>
                <p>{review.body}</p>
                <time dateTime={review.publishedDate}>
                  {formatBasisDate(review.publishedDate)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="safety-card">
        <strong>안전 여부는 추천할 수 없어요</strong>
        <p>
          재료의 실제 사용 여부나 교차접촉을 검증하지 않습니다.
          주문 전에 매장에 직접 확인해 주세요.
        </p>
      </div>
    </article>
  );
}
