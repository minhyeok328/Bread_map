import type { StructuredSearchItem } from "@bread-map/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  renderKakaoBakeryMap,
  type KakaoLatLng,
  type KakaoMap,
  type KakaoMapsApi,
  type KakaoMarker
} from "./kakao-maps.js";

function item(
  storeId: string,
  latitudeE7: number,
  longitudeE7: number
): StructuredSearchItem {
  return {
    storeId,
    bakeryId: `bakery-${storeId}`,
    displayName: `가게 ${storeId}`,
    normalizedAddress: `서울특별시 테스트구 ${storeId}길 1`,
    seoulDistrict: "마포구",
    latitudeE7,
    longitudeE7,
    distanceUpperBoundM: null,
    openingState: "UNKNOWN",
    representativeMenus: [],
    categories: [],
    review: {
      status: "INSUFFICIENT",
      count: 0,
      latestPublishedDate: null,
      snippet: null
    },
    reasonCodes: ["VERIFIED_DATA"],
    warningCodes: [
      "INSUFFICIENT_REVIEWS",
      "OPENING_HOURS_UNKNOWN"
    ]
  };
}

interface FakeMarker extends KakaoMarker {
  options: {
    position: KakaoLatLng;
    title: string;
  };
  mapHistory: Array<KakaoMap | null>;
  opacityHistory: number[];
  zIndexHistory: number[];
}

function fakeSdk() {
  const maps: KakaoMap[] = [];
  const markers: FakeMarker[] = [];
  const boundsPoints: KakaoLatLng[] = [];
  const listeners = new Map<
    KakaoMarker,
    { click?: () => void }
  >();
  const removed: KakaoMarker[] = [];

  class LatLng implements KakaoLatLng {
    constructor(
      readonly latitude: number,
      readonly longitude: number
    ) {}

    getLat() {
      return this.latitude;
    }

    getLng() {
      return this.longitude;
    }
  }

  class LatLngBounds {
    extend(point: KakaoLatLng) {
      boundsPoints.push(point);
    }
  }

  class MapView implements KakaoMap {
    readonly setBounds = vi.fn();

    constructor(
      readonly container: HTMLElement,
      readonly options: {
        center: KakaoLatLng;
        level: number;
      }
    ) {
      maps.push(this);
    }
  }

  class Marker implements FakeMarker {
    readonly mapHistory: Array<KakaoMap | null> = [];
    readonly opacityHistory: number[] = [];
    readonly zIndexHistory: number[] = [];

    constructor(
      readonly options: {
        position: KakaoLatLng;
        title: string;
      }
    ) {
      markers.push(this);
    }

    setMap(map: KakaoMap | null) {
      this.mapHistory.push(map);
    }

    setOpacity(opacity: number) {
      this.opacityHistory.push(opacity);
    }

    setZIndex(zIndex: number) {
      this.zIndexHistory.push(zIndex);
    }
  }

  const sdk: KakaoMapsApi = {
    LatLng,
    LatLngBounds,
    Map: MapView,
    Marker,
    event: {
      addListener(target, type, listener) {
        listeners.set(target, { [type]: listener });
      },
      removeListener(target) {
        removed.push(target);
        listeners.delete(target);
      }
    }
  };

  return {
    sdk,
    maps,
    markers,
    boundsPoints,
    listeners,
    removed
  };
}

describe("renderKakaoBakeryMap", () => {
  it("creates exactly one marker for every item in the shared result", () => {
    const fake = fakeSdk();
    const candidates = [
      item("store-a", 375_000_000, 1_270_000_000),
      item("store-b", 375_100_000, 1_270_100_000)
    ];
    const container = {} as HTMLElement;

    renderKakaoBakeryMap({
      api: fake.sdk,
      container,
      items: candidates,
      selectedStoreId: null,
      onSelect: vi.fn()
    });

    expect(fake.maps).toHaveLength(1);
    expect(fake.markers).toHaveLength(candidates.length);
    expect(fake.markers.map((marker) => marker.options.title)).toEqual([
      "가게 store-a",
      "가게 store-b"
    ]);
    expect(fake.markers[0]!.options.position).toMatchObject({
      latitude: 37.5,
      longitude: 127
    });
    expect(fake.boundsPoints).toHaveLength(candidates.length);
    expect(fake.maps[0]!.setBounds).toHaveBeenCalledOnce();
  });

  it("returns the original store ID for each marker click", () => {
    const fake = fakeSdk();
    const onSelect = vi.fn();

    renderKakaoBakeryMap({
      api: fake.sdk,
      container: {} as HTMLElement,
      items: [
        item("store-a", 375_000_000, 1_270_000_000),
        item("store-b", 375_100_000, 1_270_100_000)
      ],
      selectedStoreId: null,
      onSelect
    });

    fake.listeners.get(fake.markers[1]!)!.click!();

    expect(onSelect).toHaveBeenCalledWith("store-b");
  });

  it("updates selected marker presentation without rebuilding the map", () => {
    const fake = fakeSdk();
    const handle = renderKakaoBakeryMap({
      api: fake.sdk,
      container: {} as HTMLElement,
      items: [
        item("store-a", 375_000_000, 1_270_000_000),
        item("store-b", 375_100_000, 1_270_100_000)
      ],
      selectedStoreId: "store-a",
      onSelect: vi.fn()
    });

    handle.updateSelection("store-b");

    expect(fake.maps).toHaveLength(1);
    expect(fake.markers[0]!.opacityHistory.at(-1)).toBe(0.72);
    expect(fake.markers[0]!.zIndexHistory.at(-1)).toBe(1);
    expect(fake.markers[1]!.opacityHistory.at(-1)).toBe(1);
    expect(fake.markers[1]!.zIndexHistory.at(-1)).toBe(10);
  });

  it("removes listeners and markers during disposal", () => {
    const fake = fakeSdk();
    const handle = renderKakaoBakeryMap({
      api: fake.sdk,
      container: {} as HTMLElement,
      items: [
        item("store-a", 375_000_000, 1_270_000_000),
        item("store-b", 375_100_000, 1_270_100_000)
      ],
      selectedStoreId: null,
      onSelect: vi.fn()
    });

    handle.destroy();

    expect(fake.removed).toEqual(fake.markers);
    for (const marker of fake.markers) {
      expect(marker.mapHistory.at(-1)).toBeNull();
    }
  });

  it("uses a neutral Seoul center and no marker for an empty result", () => {
    const fake = fakeSdk();

    renderKakaoBakeryMap({
      api: fake.sdk,
      container: {} as HTMLElement,
      items: [],
      selectedStoreId: null,
      onSelect: vi.fn()
    });

    expect(fake.markers).toHaveLength(0);
    expect(fake.maps[0]!.setBounds).not.toHaveBeenCalled();
    expect(fake.maps[0]).toMatchObject({
      options: {
        center: {
          latitude: 37.5665,
          longitude: 126.978
        }
      }
    });
  });
});
