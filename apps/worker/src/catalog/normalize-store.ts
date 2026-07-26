import { createHash } from "node:crypto";
import {
  normalizedStoreCandidateSchema,
  STORE_NORMALIZATION_VERSION,
  type NormalizedCoordinates,
  type NormalizedStoreCandidate
} from "@bread-map/contracts";
import proj4 from "proj4";

const EPSG_5174_DEFINITION = [
  "+proj=tmerc",
  "+lat_0=38",
  "+lon_0=127.0028902777778",
  "+k=1",
  "+x_0=200000",
  "+y_0=500000",
  "+ellps=bessel",
  "+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342",
  "+units=m",
  "+no_defs"
].join(" ");

const SEOUL_BOUNDS = {
  minimumLatitude: 37.4,
  maximumLatitude: 37.75,
  minimumLongitude: 126.7,
  maximumLongitude: 127.3
} as const;

const nonBranchStoreWords = new Set([
  "제과점",
  "빵집",
  "베이커리",
  "카페"
]);

export interface NormalizedAddress {
  displayAddress: string;
  normalizedAddress: string;
  seoulDistrict: string;
}

export interface NormalizedStoreName {
  displayName: string;
  normalizedName: string;
  normalizedBrandName: string;
  branchName: string | null;
}

export interface StoreNormalizationInput {
  snapshotId: string;
  sourceRecordId: string;
  sourceRowId: string;
  managementNumber: string;
  businessName: string;
  roadNameAddress: string | null;
  lotNumberAddress: string | null;
  phone: string | null;
  sourceCoordinateX: string | null;
  sourceCoordinateY: string | null;
  businessStatusCode: string;
  businessStatusName: string;
  detailedBusinessStatusCode: string | null;
  detailedBusinessStatusName: string | null;
  closedDate: string | null;
}

export type StoreNormalizationResult =
  | {
      accepted: true;
      value: NormalizedStoreCandidate;
    }
  | {
      accepted: false;
      reasonCodes: string[];
    };

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeDashes(value: string): string {
  return value.replace(/[‐‑‒–—−－]/gu, "-");
}

function stableCandidateId(input: StoreNormalizationInput): string {
  return `candidate_${createHash("sha256")
    .update(
      [
        STORE_NORMALIZATION_VERSION,
        input.snapshotId,
        input.sourceRecordId
      ].join(":")
    )
    .digest("hex")
    .slice(0, 24)}`;
}

export function normalizeAddress(
  value: string | null
): NormalizedAddress | null {
  const normalizedInput = value?.normalize("NFKC") ?? "";
  if (normalizedInput.trim().length === 0) {
    return null;
  }

  const canonical = normalizeWhitespace(
    normalizeDashes(normalizedInput.trim())
      .replace(/^서울(?:특별시|시)?(?=\s)/u, "서울특별시")
      .replace(/[,·]/gu, " ")
  );
  const district = /^서울특별시\s+([가-힣]+구)(?:\s|$)/u.exec(
    canonical
  )?.[1];
  if (district === undefined) {
    return null;
  }

  return {
    displayAddress: canonical,
    normalizedAddress: canonical,
    seoulDistrict: district
  };
}

export function normalizePhone(value: string | null): string | null {
  const candidate = value?.normalize("NFKC").trim() ?? "";
  if (candidate.length === 0) {
    return null;
  }

  let digits = candidate.replace(/\D/gu, "");
  if (candidate.startsWith("+82") && digits.startsWith("82")) {
    digits = `0${digits.slice(2)}`;
  }
  if (
    !/^0\d{8,10}$/.test(digits) ||
    /0{6,}/.test(digits) ||
    /^(\d)\1+$/.test(digits)
  ) {
    return null;
  }

  return digits;
}

export function normalizeStoreName(value: string): NormalizedStoreName {
  const canonical = normalizeWhitespace(
    value
      .normalize("NFKC")
      .replace(
        /^(?:(?:\(\s*주\s*\)|㈜|주식회사)\s*)+/u,
        ""
      )
      .replace(
        /\s*(?:(?:\(\s*주\s*\)|㈜|주식회사))$/u,
        ""
      )
  );
  const words = canonical.split(" ").filter(Boolean);
  const possibleBranch = words.at(-1) ?? null;
  const branchName =
    possibleBranch !== null &&
    (possibleBranch === "본점" ||
      (possibleBranch.endsWith("점") &&
        !nonBranchStoreWords.has(possibleBranch)))
      ? possibleBranch
      : null;
  const brandWords =
    branchName === null ? words : words.slice(0, -1);
  const comparisonName = (parts: readonly string[]) =>
    parts
      .join("")
      .toLocaleLowerCase("ko-KR")
      .replace(/[^\p{L}\p{N}]/gu, "");

  return {
    displayName: canonical,
    normalizedName: comparisonName(words),
    normalizedBrandName: comparisonName(brandWords),
    branchName
  };
}

export function normalizeCoordinates(
  x: string | null,
  y: string | null
): NormalizedCoordinates | null {
  if (x === null || y === null) {
    return null;
  }
  const sourceX = Number(x);
  const sourceY = Number(y);
  if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
    return null;
  }

  const [longitude, latitude] = proj4(
    EPSG_5174_DEFINITION,
    "EPSG:4326",
    [sourceX, sourceY]
  );
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    latitude < SEOUL_BOUNDS.minimumLatitude ||
    latitude > SEOUL_BOUNDS.maximumLatitude ||
    longitude < SEOUL_BOUNDS.minimumLongitude ||
    longitude > SEOUL_BOUNDS.maximumLongitude
  ) {
    return null;
  }

  return {
    latitudeE7: Math.round(latitude * 10_000_000),
    longitudeE7: Math.round(longitude * 10_000_000),
    crs: "EPSG:4326"
  };
}

function normalizeBusinessStatus(
  input: StoreNormalizationInput
): "active" | "inactive" | "unknown" {
  const statusText = [
    input.businessStatusName,
    input.detailedBusinessStatusName ?? ""
  ].join(" ");
  if (
    input.closedDate !== null ||
    /폐업|휴업|취소|말소/u.test(statusText)
  ) {
    return "inactive";
  }
  if (
    input.businessStatusCode.trim() === "01" &&
    !/폐업|휴업|취소|말소/u.test(statusText)
  ) {
    return "active";
  }
  return "unknown";
}

export function normalizeStore(
  input: StoreNormalizationInput
): StoreNormalizationResult {
  const address = normalizeAddress(
    input.roadNameAddress ?? input.lotNumberAddress
  );
  if (address === null) {
    return {
      accepted: false,
      reasonCodes: ["ADDRESS_MISSING_OR_OUTSIDE_SEOUL"]
    };
  }

  const name = normalizeStoreName(input.businessName);
  if (
    name.displayName.length === 0 ||
    name.normalizedBrandName.length === 0
  ) {
    return {
      accepted: false,
      reasonCodes: ["STORE_NAME_INVALID"]
    };
  }

  const coordinates = normalizeCoordinates(
    input.sourceCoordinateX,
    input.sourceCoordinateY
  );
  const reviewReasonCodes =
    coordinates === null
      ? ["COORDINATE_MISSING_OR_INVALID"]
      : [];
  const businessStatus = normalizeBusinessStatus(input);
  if (businessStatus === "unknown") {
    reviewReasonCodes.push("BUSINESS_STATUS_UNKNOWN");
  }

  const candidate = normalizedStoreCandidateSchema.parse({
    candidateId: stableCandidateId(input),
    snapshotId: input.snapshotId,
    sourceRecordId: input.sourceRecordId,
    sourceRowId: input.sourceRowId,
    managementNumber: input.managementNumber.trim(),
    ...name,
    ...address,
    normalizedPhone: normalizePhone(input.phone),
    coordinates,
    businessStatus,
    normalizationVersion: STORE_NORMALIZATION_VERSION,
    reviewReasonCodes
  });

  return { accepted: true, value: candidate };
}
