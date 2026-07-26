import type { LocaldataSourceRow } from "@bread-map/contracts";

export type SourceRowRejectionCode =
  | "INVALID_REQUIRED_FIELD"
  | "ADDRESS_MISSING"
  | "NOT_SEOUL"
  | "INVALID_DATE"
  | "INVALID_TIMESTAMP"
  | "INVALID_COORDINATE";

export interface LocaldataStagingRow {
  mngNo: string;
  openAuthorityGroupCode: string;
  permitDate: string | null;
  businessStatusCode: string;
  businessStatusName: string;
  detailedBusinessStatusCode: string | null;
  detailedBusinessStatusName: string | null;
  closedDate: string | null;
  businessName: string;
  roadNameAddress: string | null;
  lotNumberAddress: string | null;
  sourceCoordinateX: string | null;
  sourceCoordinateY: string | null;
  dataUpdatedAtMs: number | null;
  lastModifiedAtMs: number | null;
}

export type NormalizeSourceRowResult =
  | {
      accepted: true;
      value: LocaldataStagingRow;
    }
  | {
      accepted: false;
      reasonCode: SourceRowRejectionCode;
    };

const invalidValue = Symbol("invalid-source-value");

function trimNullable(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

function parseSourceDate(
  value: string | null
): string | null | typeof invalidValue {
  const candidate = trimNullable(value);
  if (candidate === null) {
    return null;
  }
  if (!/^\d{8}$/.test(candidate)) {
    return invalidValue;
  }

  const year = Number(candidate.slice(0, 4));
  const month = Number(candidate.slice(4, 6));
  const day = Number(candidate.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalidValue;
  }

  return `${candidate.slice(0, 4)}-${candidate.slice(4, 6)}-${candidate.slice(6, 8)}`;
}

function parseSourceTimestamp(
  value: string | null
): number | null | typeof invalidValue {
  const candidate = trimNullable(value);
  if (candidate === null) {
    return null;
  }
  if (!/^\d{14}$/.test(candidate)) {
    return invalidValue;
  }

  const year = Number(candidate.slice(0, 4));
  const month = Number(candidate.slice(4, 6));
  const day = Number(candidate.slice(6, 8));
  const hour = Number(candidate.slice(8, 10));
  const minute = Number(candidate.slice(10, 12));
  const second = Number(candidate.slice(12, 14));
  const localDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  );
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second
  ) {
    return invalidValue;
  }

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 9,
    minute,
    second
  );
}

function isSeoulAddress(value: string): boolean {
  return /^(?:서울특별시|서울시|서울)(?:\s|$)/.test(value);
}

function isCoordinate(value: string): boolean {
  return /^[+-]?\d+(?:\.\d+)?$/.test(value);
}

export function normalizeSourceRow(
  row: LocaldataSourceRow
): NormalizeSourceRowResult {
  const mngNo = row.managementNumber.trim();
  const openAuthorityGroupCode = row.openAuthorityGroupCode.trim();
  const businessStatusCode = row.businessStatusCode.trim();
  const businessStatusName = row.businessStatusName.trim();
  const businessName = row.businessName.trim();

  if (
    [
      mngNo,
      openAuthorityGroupCode,
      businessStatusCode,
      businessStatusName,
      businessName
    ].some((value) => value.length === 0)
  ) {
    return {
      accepted: false,
      reasonCode: "INVALID_REQUIRED_FIELD"
    };
  }

  const roadNameAddress = trimNullable(row.roadNameAddress);
  const lotNumberAddress = trimNullable(row.lotNumberAddress);
  const address = roadNameAddress ?? lotNumberAddress;
  if (address === null) {
    return { accepted: false, reasonCode: "ADDRESS_MISSING" };
  }
  if (!isSeoulAddress(address)) {
    return { accepted: false, reasonCode: "NOT_SEOUL" };
  }

  const permitDate = parseSourceDate(row.permitDate);
  const closedDate = parseSourceDate(row.closedDate);
  if (permitDate === invalidValue || closedDate === invalidValue) {
    return { accepted: false, reasonCode: "INVALID_DATE" };
  }

  const dataUpdatedAtMs = parseSourceTimestamp(row.dataUpdatedAt);
  const lastModifiedAtMs = parseSourceTimestamp(row.lastModifiedAt);
  if (
    dataUpdatedAtMs === invalidValue ||
    lastModifiedAtMs === invalidValue
  ) {
    return { accepted: false, reasonCode: "INVALID_TIMESTAMP" };
  }

  const sourceCoordinateX = trimNullable(row.coordinateX);
  const sourceCoordinateY = trimNullable(row.coordinateY);
  if (
    (sourceCoordinateX === null) !== (sourceCoordinateY === null) ||
    (sourceCoordinateX !== null &&
      (!isCoordinate(sourceCoordinateX) ||
        !isCoordinate(sourceCoordinateY!)))
  ) {
    return { accepted: false, reasonCode: "INVALID_COORDINATE" };
  }

  return {
    accepted: true,
    value: {
      mngNo,
      openAuthorityGroupCode,
      permitDate,
      businessStatusCode,
      businessStatusName,
      detailedBusinessStatusCode: trimNullable(
        row.detailedBusinessStatusCode
      ),
      detailedBusinessStatusName: trimNullable(
        row.detailedBusinessStatusName
      ),
      closedDate,
      businessName,
      roadNameAddress,
      lotNumberAddress,
      sourceCoordinateX,
      sourceCoordinateY,
      dataUpdatedAtMs,
      lastModifiedAtMs
    }
  };
}
