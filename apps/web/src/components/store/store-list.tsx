import type {
  StructuredSearchItem
} from "@bread-map/contracts";
import {
  distanceLabel,
  formatBasisDate,
  openingStateCopy,
  reviewStatusCopy,
  searchReasonCopy
} from "./store-presenters";

export interface StoreListProps {
  items: readonly StructuredSearchItem[];
  selectedStoreId: string | null;
  sourceBasisDate: string;
  onSelect(storeId: string): void;
}

export function StoreList({
  items,
  selectedStoreId,
  sourceBasisDate,
  onSelect
}: StoreListProps) {
  return (
    <nav className="store-results" aria-label="검색 결과 가게">
      <ol className="store-list">
        {items.map((item, index) => {
          const opening = openingStateCopy(item.openingState);
          const selected = item.storeId === selectedStoreId;
          return (
            <li key={item.storeId}>
              <button
                type="button"
                className="result-card"
                data-selected={selected}
                data-store-id={item.storeId}
                aria-pressed={selected}
                onClick={() => onSelect(item.storeId)}
              >
                <span className="result-card-rank" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="result-card-body">
                  <span className="result-card-heading">
                    <strong>{item.displayName}</strong>
                    <span
                      className="status-badge"
                      data-opening={item.openingState}
                    >
                      {opening.label}
                    </span>
                  </span>
                  <span className="result-card-address">
                    {item.normalizedAddress}
                  </span>
                  <span className="result-card-reason">
                    {searchReasonCopy(item)}
                  </span>
                  {item.representativeMenus.length > 0 ? (
                    <span className="menu-pill-row">
                      {item.representativeMenus.map((menu) => (
                        <span className="menu-pill" key={menu.menuId}>
                          {menu.name}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="result-card-meta">
                    <span className="tabular-number">
                      {distanceLabel(item.distanceUpperBoundM)}
                    </span>
                    <span>{formatBasisDate(sourceBasisDate)}</span>
                  </span>
                  <span
                    className="evidence-note"
                    data-review={item.review.status}
                  >
                    {reviewStatusCopy(item.review.status)}
                  </span>
                </span>
                <span className="result-card-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
