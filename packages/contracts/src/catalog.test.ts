import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  localdataPageResponseSchema,
  type LocaldataPage
} from "./catalog.js";

interface Fixture {
  pages: unknown[];
}

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(
      resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      ),
      "utf8"
    )
  ) as Fixture;
}

describe("LOCALDATA catalog contract", () => {
  it("parses the fixed response envelope and strips fields outside the allowlist", () => {
    const fixture = loadFixture();
    const page = localdataPageResponseSchema.parse(
      fixture.pages[0]
    ) satisfies LocaldataPage;

    expect(page).toMatchObject({
      pageNo: 1,
      numOfRows: 2,
      totalCount: 4
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual({
      openAuthorityGroupCode: "6110000",
      managementNumber: "SEOUL-001",
      permitDate: "20200102",
      businessStatusCode: "01",
      businessStatusName: "영업/정상",
      detailedBusinessStatusCode: "01",
      detailedBusinessStatusName: "영업",
      closedDate: null,
      businessName: "한강 빵집",
      roadNameAddress: "서울특별시 마포구 월드컵로 1",
      lotNumberAddress: "서울특별시 마포구 합정동 1-1",
      coordinateX: "191234.125",
      coordinateY: "451234.5",
      dataUpdatedAt: "20260724093000",
      lastModifiedAt: "20260724093000"
    });
  });

  it("accepts documented nullable LOCALDATA fields", () => {
    const fixture = loadFixture();
    const page = localdataPageResponseSchema.parse(fixture.pages[0]);

    expect(page.items[1]).toMatchObject({
      managementNumber: "SEOUL-002",
      permitDate: null,
      detailedBusinessStatusCode: null,
      detailedBusinessStatusName: null,
      roadNameAddress: null,
      coordinateX: null,
      coordinateY: null,
      dataUpdatedAt: null,
      lastModifiedAt: null
    });
  });

  it("rejects a row when a required source key is missing", () => {
    const fixture = loadFixture();
    const malformed = structuredClone(fixture.pages[0]) as {
      response: {
        body: {
          items: Array<Record<string, unknown>>;
        };
      };
    };
    delete malformed.response.body.items[0]?.MNG_NO;

    expect(() => localdataPageResponseSchema.parse(malformed)).toThrow();
  });
});
