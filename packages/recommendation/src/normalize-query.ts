import type { StructuredSearchInput } from "@bread-map/contracts";
import type { NormalizedStructuredSearchQuery } from "./search-types.js";

export interface NormalizedSearchText {
  normalizedText: string;
  compactKey: string;
}

const APPROVED_SYNONYM_GROUPS = [
  ["사워도우", "sourdough", "천연발효빵"],
  ["크루아상", "크로와상", "croissant"],
  ["페이스트리", "패스트리", "pastry"],
  ["소금빵", "시오빵"],
  ["바게트", "baguette"],
  ["식빵", "loaf"]
] as const;

export function normalizeSearchText(
  input: string
): NormalizedSearchText {
  const normalizedText = input
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\p{Cc}\p{Cf}\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    normalizedText,
    compactKey: normalizedText.replace(/[^\p{L}\p{N}]+/gu, "")
  };
}

const synonymGroupsByKey = new Map<string, readonly string[]>();
for (const group of APPROVED_SYNONYM_GROUPS) {
  for (const term of group) {
    synonymGroupsByKey.set(
      normalizeSearchText(term).compactKey,
      group
    );
  }
}

export function expandApprovedSearchTerms(
  input: string
): readonly NormalizedSearchText[] {
  const normalizedInput = normalizeSearchText(input);
  const group = synonymGroupsByKey.get(normalizedInput.compactKey);
  if (group === undefined) {
    return [normalizedInput];
  }

  const seen = new Set<string>();
  const expanded: NormalizedSearchText[] = [];
  for (const value of group) {
    const normalized = normalizeSearchText(value);
    if (seen.has(normalized.compactKey)) {
      continue;
    }
    seen.add(normalized.compactKey);
    expanded.push(normalized);
  }
  return expanded;
}

function normalizeOptional(
  value: string | null
): NormalizedSearchText | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeSearchText(value);
  if (normalized.compactKey.length === 0) {
    throw new Error("SEARCH_INPUT_INVALID");
  }
  return normalized;
}

export function normalizeStructuredSearchQuery(
  input: StructuredSearchInput
): NormalizedStructuredSearchQuery {
  const menuTerms =
    input.menuName === null
      ? []
      : expandApprovedSearchTerms(input.menuName);
  if (
    input.menuName !== null &&
    menuTerms[0]?.compactKey.length === 0
  ) {
    throw new Error("SEARCH_INPUT_INVALID");
  }
  return {
    region: normalizeOptional(input.region),
    storeName: normalizeOptional(input.storeName),
    menuTerms,
    includedCategories: input.categories
      .filter((filter) => filter.mode === "INCLUDE")
      .map((filter) => filter.category)
      .sort(),
    excludedCategories: input.categories
      .filter((filter) => filter.mode === "EXCLUDE")
      .map((filter) => filter.category)
      .sort(),
    openNow: input.openNow,
    origin: input.origin,
    maxDistanceM: input.maxDistanceM,
    reviewEvidenceStatus: input.reviewEvidenceStatus,
    sortMode: input.sortMode
  };
}
