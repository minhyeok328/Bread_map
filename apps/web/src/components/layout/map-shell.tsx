"use client";

import type {
  StoreSearchRequest,
  StructuredSearchItem
} from "@bread-map/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState
} from "react";
import {
  BbangbbangFab
} from "../chat/bbangbbang-fab";
import {
  ChatShell,
  type ChatStoreContext
} from "../chat/chat-shell";
import { BakeryMap } from "../map/bakery-map";
import {
  PublicApiError,
  readStoreDetail,
  searchStores
} from "../store/store-api-client";
import { StoreDrawer } from "../store/store-drawer";
import {
  initialMapShellState,
  mapShellReducer,
  type MapStatus,
  type MapShellErrorCode
} from "./map-shell-state";

const EMPTY_ITEMS: readonly StructuredSearchItem[] = [];

export interface MapShellProps {
  kakaoMapAppKey: string | null;
}

function publicErrorCode(error: unknown): MapShellErrorCode {
  if (!(error instanceof PublicApiError)) {
    return "UNKNOWN";
  }
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return "AUTHENTICATION_REQUIRED";
    case "SEARCH_INPUT_INVALID":
    case "ORIGIN_REQUIRED":
      return "INVALID_INPUT";
    case "RESOURCE_NOT_FOUND":
      return "NOT_FOUND";
    case "SEARCH_DATA_STALE":
    case "SEARCH_DATA_VERSION_MISMATCH":
    case "SNAPSHOT_MISMATCH":
      return "STALE_DATA";
    case "SEARCH_DATA_UNAVAILABLE":
    case "SEARCH_DATABASE_UNAVAILABLE":
    case "NETWORK_UNAVAILABLE":
    case "REQUEST_FAILED":
      return "UNAVAILABLE";
    case "REQUEST_ABORTED":
    case "INTERNAL_ERROR":
    case "INVALID_RESPONSE":
    case "STORE_ID_MISMATCH":
      return "UNKNOWN";
  }
}

export function MapShell({
  kakaoMapAppKey
}: MapShellProps) {
  const [state, dispatch] = useReducer(
    mapShellReducer,
    initialMapShellState
  );
  const [mapRetryNonce, setMapRetryNonce] = useState(0);
  const searchRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const lastSearchRequestRef =
    useRef<StoreSearchRequest | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const restoreFabFocusRef = useRef(false);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    if (
      state.chatState === "CLOSED" &&
      restoreFabFocusRef.current
    ) {
      restoreFabFocusRef.current = false;
      fabRef.current?.focus();
    }
  }, [state.chatState]);

  const handleSearch = useCallback(
    async (request: StoreSearchRequest) => {
      lastSearchRequestRef.current =
        request.query.origin === null ? request : null;
      searchAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const requestId = ++searchRequestIdRef.current;
      dispatch({ type: "SEARCH_STARTED", requestId });

      try {
        const result = await searchStores(request, {
          signal: controller.signal
        });
        dispatch({
          type: "SEARCH_SUCCEEDED",
          requestId,
          result
        });
      } catch (error) {
        dispatch({
          type: "SEARCH_FAILED",
          requestId,
          errorCode: publicErrorCode(error)
        });
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
      }
    },
    []
  );

  const handleRetrySearch = useCallback(() => {
    const request = lastSearchRequestRef.current;
    if (request !== null) {
      void handleSearch(request);
    }
  }, [handleSearch]);

  const handleStoreSelection = useCallback(
    (storeId: string) => {
      const result = state.searchResult;
      if (
        result === null ||
        !result.items.some((item) => item.storeId === storeId)
      ) {
        return;
      }

      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      const requestId = ++detailRequestIdRef.current;
      dispatch({
        type: "SELECT_STORE",
        storeId,
        requestId
      });

      void readStoreDetail(
        storeId,
        result.metadata.dataSnapshotVersion,
        { signal: controller.signal }
      )
        .then((detail) => {
          dispatch({
            type: "DETAIL_SUCCEEDED",
            storeId,
            requestId,
            detail
          });
        })
        .catch((error: unknown) => {
          dispatch({
            type: "DETAIL_FAILED",
            storeId,
            requestId,
            errorCode: publicErrorCode(error)
          });
        })
        .finally(() => {
          if (detailAbortRef.current === controller) {
            detailAbortRef.current = null;
          }
        });
    },
    [state.searchResult]
  );

  const handleBack = useCallback(() => {
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    dispatch({ type: "BACK_TO_LIST" });
  }, []);

  const handleCloseChat = useCallback(() => {
    restoreFabFocusRef.current = true;
    dispatch({ type: "CLOSE_CHAT" });
  }, []);

  const handleMapStatus = useCallback(
    (status: MapStatus) => {
      dispatch({ type: "SET_MAP_STATUS", status });
    },
    []
  );

  const items = state.searchResult?.items ?? EMPTY_ITEMS;
  const selectedItem =
    items.find(
      (item) => item.storeId === state.selectedStoreId
    ) ?? null;
  const chatContext: ChatStoreContext | null =
    state.detail?.store ??
    (selectedItem === null
      ? null
      : {
          displayName: selectedItem.displayName,
          normalizedAddress: selectedItem.normalizedAddress
        });

  return (
    <main
      className="map-shell"
      data-drawer={state.drawerVisibility}
      data-mobile-surface={state.mobileSurface}
      data-chat={state.chatState}
    >
      <a className="skip-link" href="#search-heading">
        검색으로 바로가기
      </a>

      <BakeryMap
        key={mapRetryNonce}
        appKey={kakaoMapAppKey}
        items={items}
        selectedStoreId={state.selectedStoreId}
        status={state.mapStatus}
        retryNonce={mapRetryNonce}
        onSelect={handleStoreSelection}
        onStatusChange={handleMapStatus}
        onRetry={() => {
          setMapRetryNonce((current) => current + 1);
        }}
        onShowList={() => {
          dispatch({
            type: "SET_MOBILE_SURFACE",
            surface: "LIST"
          });
        }}
      />

      <StoreDrawer
        state={state}
        onSearch={handleSearch}
        onRetrySearch={handleRetrySearch}
        onSelect={handleStoreSelection}
        onBack={handleBack}
        onToggleDrawer={() => {
          dispatch({
            type: "SET_DRAWER_VISIBILITY",
            visibility:
              state.drawerVisibility === "EXPANDED"
                ? "COLLAPSED"
                : "EXPANDED"
          });
        }}
        onToggleMobileSurface={() => {
          dispatch({
            type: "SET_MOBILE_SURFACE",
            surface:
              state.mobileSurface === "LIST" ? "MAP" : "LIST"
          });
        }}
      />

      {state.chatState === "CLOSED" ? (
        <BbangbbangFab
          ref={fabRef}
          onOpen={() => dispatch({ type: "OPEN_CHAT" })}
        />
      ) : (
        <ChatShell
          storeContext={chatContext}
          onClose={handleCloseChat}
        />
      )}
    </main>
  );
}
