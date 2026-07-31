import {
  MapShell
} from "../components/layout/map-shell";
import { resolvePublicAuthError } from "../auth-error";

export interface HomePageProps {
  searchParams: Promise<{
    error?: string | string[];
  }>;
}

export default async function HomePage({
  searchParams
}: HomePageProps) {
  const kakaoMapAppKey =
    process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY?.trim() || null;
  const parameters = await searchParams;
  const authErrorCode = resolvePublicAuthError(parameters.error);

  return (
    <MapShell
      kakaoMapAppKey={kakaoMapAppKey}
      authErrorCode={authErrorCode}
    />
  );
}
