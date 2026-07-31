import type { StructuredSearchItem } from "@bread-map/contracts";

export interface KakaoLatLng {
  getLat?(): number;
  getLng?(): number;
}

export interface KakaoLatLngBounds {
  extend(point: KakaoLatLng): void;
}

export interface KakaoMap {
  setBounds(bounds: KakaoLatLngBounds): void;
}

export interface KakaoMarker {
  setMap(map: KakaoMap | null): void;
  setOpacity(opacity: number): void;
  setZIndex(zIndex: number): void;
}

export interface KakaoMapsApi {
  LatLng: new (
    latitude: number,
    longitude: number
  ) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (
    container: HTMLElement,
    options: {
      center: KakaoLatLng;
      level: number;
    }
  ) => KakaoMap;
  Marker: new (options: {
    position: KakaoLatLng;
    title: string;
  }) => KakaoMarker;
  event: {
    addListener(
      target: KakaoMarker,
      type: "click",
      listener: () => void
    ): void;
    removeListener(
      target: KakaoMarker,
      type: "click",
      listener: () => void
    ): void;
  };
}

export interface KakaoMapsLoaderApi extends KakaoMapsApi {
  load(callback: () => void): void;
}

export interface KakaoMapRenderHandle {
  updateSelection(storeId: string | null): void;
  destroy(): void;
}

export interface RenderKakaoBakeryMapOptions {
  api: KakaoMapsApi;
  container: HTMLElement;
  items: readonly StructuredSearchItem[];
  selectedStoreId: string | null;
  onSelect(storeId: string): void;
}

const SEOUL_CENTER = {
  latitude: 37.5665,
  longitude: 126.978
} as const;

export function renderKakaoBakeryMap(
  options: RenderKakaoBakeryMapOptions
): KakaoMapRenderHandle {
  const map = new options.api.Map(options.container, {
    center: new options.api.LatLng(
      SEOUL_CENTER.latitude,
      SEOUL_CENTER.longitude
    ),
    level: 8
  });
  const bounds = new options.api.LatLngBounds();
  const markerRecords = options.items.map((item) => {
    const position = new options.api.LatLng(
      item.latitudeE7 / 10_000_000,
      item.longitudeE7 / 10_000_000
    );
    const marker = new options.api.Marker({
      position,
      title: item.displayName
    });
    const listener = () => {
      options.onSelect(item.storeId);
    };
    marker.setMap(map);
    bounds.extend(position);
    options.api.event.addListener(marker, "click", listener);
    return {
      storeId: item.storeId,
      marker,
      listener
    };
  });

  if (markerRecords.length > 0) {
    map.setBounds(bounds);
  }

  let destroyed = false;

  function updateSelection(storeId: string | null): void {
    if (destroyed) {
      return;
    }
    for (const record of markerRecords) {
      const isSelected =
        storeId !== null && record.storeId === storeId;
      record.marker.setOpacity(
        storeId === null || isSelected ? 1 : 0.72
      );
      record.marker.setZIndex(isSelected ? 10 : 1);
    }
  }

  updateSelection(options.selectedStoreId);

  return {
    updateSelection,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const record of markerRecords) {
        options.api.event.removeListener(
          record.marker,
          "click",
          record.listener
        );
        record.marker.setMap(null);
      }
    }
  };
}
