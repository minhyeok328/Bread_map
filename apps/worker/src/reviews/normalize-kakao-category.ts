export const APPROVED_KAKAO_BAKERY_TAG = "제과,베이커리";

export function normalizeKakaoCategoryTag(value: string): string {
  const last = value.normalize("NFKC").split(">").at(-1) ?? "";
  return last.trim().replace(/\s*,\s*/g, ",");
}

export function isApprovedBakeryTag(value: string): boolean {
  return (
    normalizeKakaoCategoryTag(value) === APPROVED_KAKAO_BAKERY_TAG
  );
}
