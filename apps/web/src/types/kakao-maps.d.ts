import type {
  KakaoMapsLoaderApi
} from "../components/map/kakao-maps";

declare global {
  interface Window {
    kakao?: {
      maps: KakaoMapsLoaderApi;
    };
  }
}

export {};
