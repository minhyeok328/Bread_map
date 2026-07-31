import type {
  StoreDetailResponse,
  StructuredSearchResult
} from "@bread-map/contracts";

export type SearchStatus =
  | "IDLE"
  | "LOADING"
  | "SUCCESS"
  | "PARTIAL"
  | "EMPTY"
  | "ERROR";
export type DetailStatus = "IDLE" | "LOADING" | "SUCCESS" | "ERROR";
export type DrawerView = "LIST" | "DETAIL";
export type DrawerVisibility = "EXPANDED" | "COLLAPSED";
export type MobileSurface = "LIST" | "MAP";
export type ChatState = "CLOSED" | "OPEN";
export type MapStatus = "LOADING" | "READY" | "MAP_UNAVAILABLE";
export type MapShellErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "STALE_DATA"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface MapShellState {
  searchStatus: SearchStatus;
  searchRequestId: number | null;
  searchResult: StructuredSearchResult | null;
  searchErrorCode: MapShellErrorCode | null;
  selectedStoreId: string | null;
  detailStatus: DetailStatus;
  detailRequestId: number | null;
  detail: StoreDetailResponse | null;
  detailErrorCode: MapShellErrorCode | null;
  drawerView: DrawerView;
  drawerVisibility: DrawerVisibility;
  mobileSurface: MobileSurface;
  chatState: ChatState;
  mapStatus: MapStatus;
}

export type MapShellAction =
  | { type: "SEARCH_STARTED"; requestId: number }
  | {
      type: "SEARCH_SUCCEEDED";
      requestId: number;
      result: StructuredSearchResult;
    }
  | {
      type: "SEARCH_FAILED";
      requestId: number;
      errorCode: MapShellErrorCode;
    }
  | { type: "SELECT_STORE"; storeId: string; requestId: number }
  | {
      type: "DETAIL_SUCCEEDED";
      storeId: string;
      requestId: number;
      detail: StoreDetailResponse;
    }
  | {
      type: "DETAIL_FAILED";
      storeId: string;
      requestId: number;
      errorCode: MapShellErrorCode;
    }
  | { type: "BACK_TO_LIST" }
  | { type: "SET_DRAWER_VISIBILITY"; visibility: DrawerVisibility }
  | { type: "SET_MOBILE_SURFACE"; surface: MobileSurface }
  | { type: "SET_MAP_STATUS"; status: MapStatus }
  | { type: "OPEN_CHAT" }
  | { type: "CLOSE_CHAT" };

export const initialMapShellState: MapShellState = {
  searchStatus: "IDLE",
  searchRequestId: null,
  searchResult: null,
  searchErrorCode: null,
  selectedStoreId: null,
  detailStatus: "IDLE",
  detailRequestId: null,
  detail: null,
  detailErrorCode: null,
  drawerView: "LIST",
  drawerVisibility: "EXPANDED",
  mobileSurface: "LIST",
  chatState: "CLOSED",
  mapStatus: "LOADING"
};

function clearDetail(): Pick<
  MapShellState,
  "selectedStoreId" | "detailStatus" | "detailRequestId" | "detail" | "detailErrorCode" | "drawerView"
> {
  return {
    selectedStoreId: null,
    detailStatus: "IDLE",
    detailRequestId: null,
    detail: null,
    detailErrorCode: null,
    drawerView: "LIST"
  };
}

function searchStatusFor(result: StructuredSearchResult): SearchStatus {
  if (result.items.length === 0) {
    return "EMPTY";
  }

  return result.status === "PARTIAL" ? "PARTIAL" : "SUCCESS";
}

function isCurrentSearch(state: MapShellState, requestId: number): boolean {
  return state.searchRequestId === requestId;
}

function isCurrentDetail(
  state: MapShellState,
  storeId: string,
  requestId: number
): boolean {
  return (
    state.selectedStoreId === storeId && state.detailRequestId === requestId
  );
}

function hasCurrentSnapshot(
  state: MapShellState,
  detail: StoreDetailResponse
): boolean {
  const searchSnapshot = state.searchResult?.metadata.dataSnapshotVersion;
  return (
    searchSnapshot === undefined ||
    detail.metadata.dataSnapshotVersion === searchSnapshot
  );
}

function assertNever(action: never): never {
  throw new Error(`Unhandled map shell action: ${String(action)}`);
}

export function mapShellReducer(
  state: MapShellState,
  action: MapShellAction
): MapShellState {
  switch (action.type) {
    case "SEARCH_STARTED":
      return {
        ...state,
        searchStatus: "LOADING",
        searchRequestId: action.requestId,
        searchResult: null,
        searchErrorCode: null,
        ...clearDetail()
      };

    case "SEARCH_SUCCEEDED":
      if (!isCurrentSearch(state, action.requestId)) {
        return state;
      }

      return {
        ...state,
        searchStatus: searchStatusFor(action.result),
        searchResult: action.result,
        searchErrorCode: null,
        ...clearDetail()
      };

    case "SEARCH_FAILED":
      if (!isCurrentSearch(state, action.requestId)) {
        return state;
      }

      return {
        ...state,
        searchStatus: "ERROR",
        searchResult: null,
        searchErrorCode: action.errorCode,
        ...clearDetail()
      };

    case "SELECT_STORE":
      return {
        ...state,
        selectedStoreId: action.storeId,
        detailStatus: "LOADING",
        detailRequestId: action.requestId,
        detail: null,
        detailErrorCode: null,
        drawerView: "DETAIL",
        mobileSurface: "LIST"
      };

    case "DETAIL_SUCCEEDED":
      if (
        !isCurrentDetail(state, action.storeId, action.requestId) ||
        !hasCurrentSnapshot(state, action.detail)
      ) {
        return state;
      }

      return {
        ...state,
        detailStatus: "SUCCESS",
        detail: action.detail,
        detailErrorCode: null
      };

    case "DETAIL_FAILED":
      if (!isCurrentDetail(state, action.storeId, action.requestId)) {
        return state;
      }

      return {
        ...state,
        detailStatus: "ERROR",
        detail: null,
        detailErrorCode: action.errorCode
      };

    case "BACK_TO_LIST":
      return {
        ...state,
        detailStatus: "IDLE",
        detailRequestId: null,
        detail: null,
        detailErrorCode: null,
        drawerView: "LIST"
      };

    case "SET_DRAWER_VISIBILITY":
      return { ...state, drawerVisibility: action.visibility };

    case "SET_MOBILE_SURFACE":
      return { ...state, mobileSurface: action.surface };

    case "SET_MAP_STATUS":
      return { ...state, mapStatus: action.status };

    case "OPEN_CHAT":
      return { ...state, chatState: "OPEN" };

    case "CLOSE_CHAT":
      return { ...state, chatState: "CLOSED" };

    default:
      return assertNever(action);
  }
}
