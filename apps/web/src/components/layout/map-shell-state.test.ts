import type {
  StoreDetailResponse,
  StructuredSearchResult
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import {
  initialMapShellState,
  mapShellReducer
} from "./map-shell-state.js";

const dataSnapshotVersion = `search-data-v1_${"a".repeat(64)}`;

function searchResult(
  status: "COMPLETE" | "PARTIAL" = "COMPLETE",
  storeIds: string[] = ["store-a"]
): StructuredSearchResult {
  return {
    status,
    partialReason: status === "PARTIAL" ? "FTS_UNAVAILABLE" : null,
    items: storeIds.map((storeId) => ({ storeId }))
  } as StructuredSearchResult;
}

function detail(storeId: string): StoreDetailResponse {
  return {
    store: { storeId },
    metadata: { dataSnapshotVersion }
  } as StoreDetailResponse;
}

function selectedState(storeId = "store-a") {
  return mapShellReducer(initialMapShellState, {
    type: "SELECT_STORE",
    storeId,
    requestId: 1
  });
}

describe("mapShellReducer", () => {
  it("starts list-first with chat closed and no selected store", () => {
    expect(initialMapShellState).toMatchObject({
      searchStatus: "IDLE",
      detailStatus: "IDLE",
      drawerView: "LIST",
      drawerVisibility: "EXPANDED",
      mobileSurface: "LIST",
      chatState: "CLOSED",
      mapStatus: "LOADING",
      selectedStoreId: null
    });
  });

  it("moves a search through loading, success, partial, empty, and error states", () => {
    const loading = mapShellReducer(initialMapShellState, {
      type: "SEARCH_STARTED",
      requestId: 1
    });
    const success = mapShellReducer(loading, {
      type: "SEARCH_SUCCEEDED",
      requestId: 1,
      result: searchResult()
    });
    const partial = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 2
      }),
      {
        type: "SEARCH_SUCCEEDED",
        requestId: 2,
        result: searchResult("PARTIAL")
      }
    );
    const empty = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 3
      }),
      {
        type: "SEARCH_SUCCEEDED",
        requestId: 3,
        result: searchResult("COMPLETE", [])
      }
    );
    const failed = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 4
      }),
      {
        type: "SEARCH_FAILED",
        requestId: 4,
        errorCode: "UNAVAILABLE"
      }
    );

    expect(loading.searchStatus).toBe("LOADING");
    expect(success.searchStatus).toBe("SUCCESS");
    expect(partial.searchStatus).toBe("PARTIAL");
    expect(empty.searchStatus).toBe("EMPTY");
    expect(failed).toMatchObject({
      searchStatus: "ERROR",
      searchErrorCode: "UNAVAILABLE",
      selectedStoreId: null
    });
  });

  it("clears stale selection and detail when a new search starts", () => {
    const withDetail = mapShellReducer(selectedState(), {
      type: "DETAIL_SUCCEEDED",
      storeId: "store-a",
      requestId: 1,
      detail: detail("store-a")
    });

    const nextSearch = mapShellReducer(withDetail, {
      type: "SEARCH_STARTED",
      requestId: 2
    });

    expect(nextSearch).toMatchObject({
      searchStatus: "LOADING",
      selectedStoreId: null,
      detailStatus: "IDLE",
      detail: null,
      drawerView: "LIST"
    });
  });

  it("rejects a search success response from a superseded request", () => {
    const currentSearch = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 1
      }),
      { type: "SEARCH_STARTED", requestId: 2 }
    );

    const afterStaleSuccess = mapShellReducer(currentSearch, {
      type: "SEARCH_SUCCEEDED",
      requestId: 1,
      result: searchResult()
    });

    expect(afterStaleSuccess).toMatchObject({
      searchStatus: "LOADING",
      searchRequestId: 2,
      searchResult: null,
      searchErrorCode: null
    });
  });

  it("rejects a search failure response from a superseded request", () => {
    const currentSearch = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 1
      }),
      { type: "SEARCH_STARTED", requestId: 2 }
    );

    const afterStaleFailure = mapShellReducer(currentSearch, {
      type: "SEARCH_FAILED",
      requestId: 1,
      errorCode: "UNAVAILABLE"
    });

    expect(afterStaleFailure).toMatchObject({
      searchStatus: "LOADING",
      searchRequestId: 2,
      searchResult: null,
      searchErrorCode: null
    });
  });

  it("uses the same selection transition for list and map store IDs", () => {
    const selectFromList = () =>
      mapShellReducer(initialMapShellState, {
        type: "SELECT_STORE" as const,
        storeId: "store-a",
        requestId: 1
      });
    const selectFromMap = () =>
      mapShellReducer(initialMapShellState, {
        type: "SELECT_STORE" as const,
        storeId: "store-a",
        requestId: 1
      });

    expect(selectFromList()).toMatchObject({
      selectedStoreId: "store-a",
      drawerView: "DETAIL",
      detailStatus: "LOADING"
    });
    expect(selectFromMap()).toEqual(selectFromList());
  });

  it("reveals the detail surface after selecting a marker on mobile", () => {
    const mapSurface = mapShellReducer(initialMapShellState, {
      type: "SET_MOBILE_SURFACE",
      surface: "MAP"
    });

    const selected = mapShellReducer(mapSurface, {
      type: "SELECT_STORE",
      storeId: "store-a",
      requestId: 1
    });

    expect(selected).toMatchObject({
      selectedStoreId: "store-a",
      drawerView: "DETAIL",
      mobileSurface: "LIST"
    });
  });

  it("rejects a detail response for a superseded store selection", () => {
    const newerSelection = mapShellReducer(selectedState("store-b"), {
      type: "SELECT_STORE",
      storeId: "store-a",
      requestId: 2
    });

    const afterStaleDetail = mapShellReducer(newerSelection, {
      type: "DETAIL_SUCCEEDED",
      storeId: "store-b",
      requestId: 1,
      detail: detail("store-b")
    });

    expect(afterStaleDetail).toMatchObject({
      selectedStoreId: "store-a",
      detailStatus: "LOADING",
      detail: null
    });
  });

  it("returns from detail to the list while retaining the selected map marker", () => {
    const back = mapShellReducer(selectedState(), { type: "BACK_TO_LIST" });

    expect(back).toMatchObject({
      drawerView: "LIST",
      selectedStoreId: "store-a",
      detailStatus: "IDLE",
      detail: null
    });
  });

  it("preserves search data and selection while the desktop drawer is collapsed", () => {
    const searched = mapShellReducer(
      mapShellReducer(initialMapShellState, {
        type: "SEARCH_STARTED",
        requestId: 1
      }),
      {
        type: "SEARCH_SUCCEEDED",
        requestId: 1,
        result: searchResult()
      }
    );
    const selected = mapShellReducer(searched, {
      type: "SELECT_STORE",
      storeId: "store-a",
      requestId: 2
    });

    const collapsed = mapShellReducer(selected, {
      type: "SET_DRAWER_VISIBILITY",
      visibility: "COLLAPSED"
    });

    expect(collapsed).toMatchObject({
      drawerVisibility: "COLLAPSED",
      selectedStoreId: "store-a",
      searchResult: searchResult()
    });
  });

  it("changes mobile surfaces only through an explicit surface action", () => {
    const mapSurface = mapShellReducer(initialMapShellState, {
      type: "SET_MOBILE_SURFACE",
      surface: "MAP"
    });
    const listSurface = mapShellReducer(mapSurface, {
      type: "SET_MOBILE_SURFACE",
      surface: "LIST"
    });

    expect(initialMapShellState.mobileSurface).toBe("LIST");
    expect(mapSurface.mobileSurface).toBe("MAP");
    expect(listSurface.mobileSurface).toBe("LIST");
  });

  it("records map readiness and map unavailability without changing search state", () => {
    const ready = mapShellReducer(initialMapShellState, {
      type: "SET_MAP_STATUS",
      status: "READY"
    });
    const unavailable = mapShellReducer(ready, {
      type: "SET_MAP_STATUS",
      status: "MAP_UNAVAILABLE"
    });

    expect(ready).toMatchObject({ mapStatus: "READY", searchStatus: "IDLE" });
    expect(unavailable).toMatchObject({
      mapStatus: "MAP_UNAVAILABLE",
      searchStatus: "IDLE"
    });
  });

  it("keeps chat state mutually exclusive with the closed-FAB state", () => {
    const open = mapShellReducer(initialMapShellState, { type: "OPEN_CHAT" });
    const closed = mapShellReducer(open, { type: "CLOSE_CHAT" });

    expect(open.chatState).toBe("OPEN");
    expect(closed.chatState).toBe("CLOSED");
  });
});
