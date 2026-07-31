"use client";

import type {
  StructuredSearchItem
} from "@bread-map/contracts";
import Script from "next/script";
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type {
  MapStatus
} from "../layout/map-shell-state";
import {
  renderKakaoBakeryMap,
  type KakaoMapRenderHandle
} from "./kakao-maps";

export interface BakeryMapProps {
  appKey: string | null;
  items: readonly StructuredSearchItem[];
  selectedStoreId: string | null;
  status: MapStatus;
  retryNonce: number;
  onSelect(storeId: string): void;
  onStatusChange(status: MapStatus): void;
  onRetry(): void;
  onShowList(): void;
}

export function BakeryMap({
  appKey,
  items,
  selectedStoreId,
  status,
  retryNonce,
  onSelect,
  onStatusChange,
  onRetry,
  onShowList
}: BakeryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapHandleRef = useRef<KakaoMapRenderHandle | null>(
    null
  );
  const mountedRef = useRef(true);
  const [sdkReady, setSdkReady] = useState(false);

  const initializeSdk = useCallback(() => {
    const maps = window.kakao?.maps;
    if (maps === undefined || typeof maps.load !== "function") {
      onStatusChange("MAP_UNAVAILABLE");
      return;
    }
    maps.load(() => {
      if (mountedRef.current) {
        setSdkReady(true);
      }
    });
  }, [onStatusChange]);

  useEffect(() => {
    mountedRef.current = true;

    if (appKey === null || appKey.length === 0) {
      onStatusChange("MAP_UNAVAILABLE");
      return () => {
        mountedRef.current = false;
      };
    }

    onStatusChange("LOADING");
    if (window.kakao?.maps !== undefined) {
      initializeSdk();
    }
    return () => {
      mountedRef.current = false;
      mapHandleRef.current?.destroy();
      mapHandleRef.current = null;
    };
  }, [appKey, initializeSdk, onStatusChange, retryNonce]);

  useEffect(() => {
    if (
      !sdkReady ||
      containerRef.current === null ||
      window.kakao?.maps === undefined
    ) {
      return;
    }

    try {
      mapHandleRef.current?.destroy();
      mapHandleRef.current = renderKakaoBakeryMap({
        api: window.kakao.maps,
        container: containerRef.current,
        items,
        selectedStoreId: null,
        onSelect
      });
      onStatusChange("READY");
    } catch {
      mapHandleRef.current?.destroy();
      mapHandleRef.current = null;
      onStatusChange("MAP_UNAVAILABLE");
    }

    return () => {
      mapHandleRef.current?.destroy();
      mapHandleRef.current = null;
    };
  }, [
    items,
    onSelect,
    onStatusChange,
    sdkReady
  ]);

  useEffect(() => {
    mapHandleRef.current?.updateSelection(selectedStoreId);
  }, [selectedStoreId]);

  const scriptSource =
    appKey === null || appKey.length === 0
      ? null
      : `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
          appKey
        )}&autoload=false&attempt=${retryNonce}`;

  return (
    <section className="map-region" aria-labelledby="map-heading">
      <h2 id="map-heading" className="sr-only">
        검색 결과 지도
      </h2>
      {scriptSource ? (
        <Script
          id={`kakao-map-sdk-${retryNonce}`}
          src={scriptSource}
          strategy="afterInteractive"
          onLoad={initializeSdk}
          onReady={initializeSdk}
          onError={() => onStatusChange("MAP_UNAVAILABLE")}
        />
      ) : null}
      <div
        ref={containerRef}
        className="kakao-map"
        data-map-status={status}
        aria-hidden={status !== "READY"}
      />
      <button
        type="button"
        className="secondary-button mobile-list-return"
        onClick={onShowList}
      >
        목록 보기
      </button>

      {status === "LOADING" ? (
        <div className="map-status-card" role="status">
          <div className="loading-mark" aria-hidden="true" />
          <strong>지도를 불러오고 있어요</strong>
          <span>가게 목록은 먼저 살펴볼 수 있어요.</span>
        </div>
      ) : null}

      {status === "MAP_UNAVAILABLE" ? (
        <div className="map-status-card map-error-card" role="status">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <strong>지도를 불러오지 못했어요</strong>
          <span>가게 목록과 주소는 계속 볼 수 있어요.</span>
          <div className="map-recovery-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onRetry}
            >
              지도 다시 시도
            </button>
            <button
              type="button"
              className="text-button"
              onClick={onShowList}
            >
              목록 계속 보기
            </button>
          </div>
        </div>
      ) : null}

      <div className="map-attribution">
        <span>BREAD MAP</span>
        <span>지도 후보와 목록은 같은 결과를 사용합니다</span>
      </div>
    </section>
  );
}
