export const fakeKakaoSdkSource = String.raw`
(() => {
  let markerSequence = 0;

  class LatLng {
    constructor(latitude, longitude) {
      this.latitude = latitude;
      this.longitude = longitude;
    }
    getLat() { return this.latitude; }
    getLng() { return this.longitude; }
  }

  class LatLngBounds {
    constructor() { this.points = []; }
    extend(point) { this.points.push(point); }
  }

  class MapView {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      container.dataset.fakeKakaoMap = "ready";
    }
    setBounds(bounds) {
      this.bounds = bounds;
      this.container.dataset.markerCount =
        String(bounds.points.length);
    }
  }

  class Marker {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.button = null;
      this.sequence = markerSequence++;
    }
    setMap(map) {
      if (map === null) {
        this.button?.remove();
        this.button = null;
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "e2e-kakao-marker";
      button.setAttribute(
        "aria-label",
        "지도 마커: " + this.options.title
      );
      button.textContent = "●";
      button.style.position = "absolute";
      button.style.right = (160 + this.sequence * 64) + "px";
      button.style.top = (120 + this.sequence * 72) + "px";
      button.style.zIndex = "1";
      button.style.width = "44px";
      button.style.height = "44px";
      button.style.margin = "8px";
      button.style.borderRadius = "50%";
      button.style.border = "2px solid #422b21";
      button.style.background = "#e9ba73";
      if (this.listeners.click) {
        button.addEventListener("click", this.listeners.click);
      }
      map.container.append(button);
      this.button = button;
    }
    setOpacity(opacity) {
      if (this.button) this.button.style.opacity = String(opacity);
    }
    setZIndex(zIndex) {
      if (this.button) this.button.style.zIndex = String(zIndex);
    }
  }

  window.kakao = {
    maps: {
      load(callback) { setTimeout(callback, 0); },
      LatLng,
      LatLngBounds,
      Map: MapView,
      Marker,
      event: {
        addListener(target, type, listener) {
          target.listeners[type] = listener;
          target.button?.addEventListener(type, listener);
        },
        removeListener(target, type, listener) {
          target.button?.removeEventListener(type, listener);
          delete target.listeners[type];
        }
      }
    }
  };
})();
`;
