import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  localdataPageResponseSchema,
  type LocaldataSourceRow
} from "@bread-map/contracts";
import { describe, expect, it } from "vitest";
import { normalizeSourceRow } from "./normalize-source-row.js";

interface Fixture {
  pages: unknown[];
}

function loadRows(): LocaldataSourceRow[] {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      ),
      "utf8"
    )
  ) as Fixture;

  return fixture.pages.flatMap(
    (page) => localdataPageResponseSchema.parse(page).items
  );
}

describe("normalizeSourceRow", () => {
  it("converts source representations without store normalization", () => {
    const [row] = loadRows();
    expect(row).toBeDefined();

    expect(normalizeSourceRow(row!)).toEqual({
      accepted: true,
      value: {
        mngNo: "SEOUL-001",
        openAuthorityGroupCode: "6110000",
        permitDate: "2020-01-02",
        businessStatusCode: "01",
        businessStatusName: "영업/정상",
        detailedBusinessStatusCode: "01",
        detailedBusinessStatusName: "영업",
        closedDate: null,
        businessName: "한강 빵집",
        roadNameAddress: "서울특별시 마포구 월드컵로 1",
        lotNumberAddress: "서울특별시 마포구 합정동 1-1",
        sourceCoordinateX: "191234.125",
        sourceCoordinateY: "451234.5",
        dataUpdatedAtMs: 1784853000000,
        lastModifiedAtMs: 1784853000000
      }
    });
  });

  it("accepts nullable source fields and falls back to the lot-number address", () => {
    const row = loadRows()[1];
    expect(row).toBeDefined();

    expect(normalizeSourceRow(row!)).toEqual({
      accepted: true,
      value: {
        mngNo: "SEOUL-002",
        openAuthorityGroupCode: "6110000",
        permitDate: null,
        businessStatusCode: "01",
        businessStatusName: "영업/정상",
        detailedBusinessStatusCode: null,
        detailedBusinessStatusName: null,
        closedDate: null,
        businessName: "남산 베이커리",
        roadNameAddress: null,
        lotNumberAddress: "서울특별시 중구 회현동 2-2",
        sourceCoordinateX: null,
        sourceCoordinateY: null,
        dataUpdatedAtMs: null,
        lastModifiedAtMs: null
      }
    });
  });

  it("rejects a valid provider row whose address is outside Seoul", () => {
    const row = loadRows()[2];
    expect(row).toBeDefined();

    expect(normalizeSourceRow(row!)).toEqual({
      accepted: false,
      reasonCode: "NOT_SEOUL"
    });
  });

  it("rejects invalid dates before staging", () => {
    const row = loadRows()[0];
    expect(row).toBeDefined();

    expect(
      normalizeSourceRow({
        ...row!,
        permitDate: "20260230"
      })
    ).toEqual({
      accepted: false,
      reasonCode: "INVALID_DATE"
    });
  });
});
