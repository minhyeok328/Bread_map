export const KAKAO_UNLINK_URL =
  "https://kapi.kakao.com/v1/user/unlink";
export const DEFAULT_KAKAO_UNLINK_TIMEOUT_MS = 5_000;

export type KakaoUnlinkResult =
  | "UNLINKED"
  | "PENDING_MANUAL";

export interface KakaoUnlinkOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function unlinkKakaoAccount(
  options: KakaoUnlinkOptions
): Promise<KakaoUnlinkResult> {
  if (options.accessToken.length === 0) {
    return "PENDING_MANUAL";
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_KAKAO_UNLINK_TIMEOUT_MS
  );
  timeout.unref?.();

  try {
    const response = await (options.fetchImpl ?? fetch)(
      KAKAO_UNLINK_URL,
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        signal: controller.signal
      }
    );

    return response.ok ? "UNLINKED" : "PENDING_MANUAL";
  } catch {
    return "PENDING_MANUAL";
  } finally {
    clearTimeout(timeout);
  }
}
