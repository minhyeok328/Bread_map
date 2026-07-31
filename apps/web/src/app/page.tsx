import {
  MapShell
} from "../components/layout/map-shell";

export default function HomePage() {
  const kakaoMapAppKey =
    process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY?.trim() || null;

  return <MapShell kakaoMapAppKey={kakaoMapAppKey} />;
}
