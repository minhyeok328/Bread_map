import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  brandEligibilityEvidenceSchema,
  type BrandEligibilityEvidence
} from "@bread-map/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createLocaldataClient } from "./localdata-client.js";
import { publishCatalog } from "./publish-catalog.js";
import { runLocaldataIngestion } from "./run-ingestion.js";

interface Fixture {
  basisDate: string;
  pages: unknown[];
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

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

function createFixtureClient(fixture: Fixture) {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input.toString()
    );
    const pageNo = Number(url.searchParams.get("pageNo"));
    const page = fixture.pages[pageNo - 1];
    return new Response(JSON.stringify(page), {
      status: page === undefined ? 404 : 200,
      headers: { "content-type": "application/json" }
    });
  };
  return createLocaldataClient({
    serviceKey: "fixture-api-key",
    fetchImpl
  });
}

async function createMigratedDatabase(): Promise<AppDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-catalog-publish-")
  );
  cleanupPaths.push(directory);
  const database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  return database;
}

function approvedSingleEvidence(
  brandKey: string,
  displayName: string,
  managementNumber: string
): BrandEligibilityEvidence {
  return brandEligibilityEvidenceSchema.parse({
    brandKey,
    displayName,
    sourceManagementNumbers: [managementNumber],
    ftcStatus: "not_found",
    ftcEvidenceRefs: [`fixture://ftc/no-match/${brandKey}`],
    operatorEvidenceRefs: [],
    independenceEvidenceRefs: [
      `fixture://independent/${brandKey}`
    ],
    adminReviewStatus: "approved",
    adminEvidenceRefs: [`fixture://admin/${brandKey}`]
  });
}

function createChangedSnapshotFixture(fixture: Fixture): Fixture {
  const changed = structuredClone(fixture) as {
    basisDate: string;
    pages: Array<{
      response: {
        body: {
          items: Array<Record<string, unknown>>;
        };
      };
    }>;
  };
  changed.basisDate = "2026-07-25";
  for (const page of changed.pages) {
    for (const item of page.response.body.items) {
      item.DAT_UPDT_PNT = "20260725120000";
    }
  }
  return changed;
}

function createSixStoreFixture(): Fixture {
  const items = Array.from({ length: 6 }, (_, index) => ({
    OPN_ATMY_GRP_CD: "6110000",
    MNG_NO: `SEOUL-CHAIN-${index + 1}`,
    LCPMT_YMD: "20200102",
    SALS_STTS_CD: "01",
    SALS_STTS_NM: "영업/정상",
    DTL_SALS_STTS_CD: "01",
    DTL_SALS_STTS_NM: "영업",
    CLSBIZ_YMD: null,
    BPLC_NM: `검증 체인 ${index + 1}호점`,
    ROAD_NM_ADDR: `서울특별시 마포구 월드컵로 ${index + 1}`,
    LOTNO_ADDR: null,
    CRD_INFO_X: String(175000 + index * 10000),
    CRD_INFO_Y: String(440000 + index * 3000),
    DAT_UPDT_PNT: "20260724120000",
    LAST_MDFCN_PNT: "20260724120000"
  }));
  return {
    basisDate: "2026-07-24",
    pages: [
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE"
          },
          body: {
            pageNo: 1,
            numOfRows: 6,
            totalCount: 6,
            items
          }
        }
      }
    ]
  };
}

function countRows(
  database: AppDatabaseHandle,
  table: string
): number {
  return (
    database.client
      .prepare(`SELECT count(*) AS count FROM ${table}`)
      .get() as { count: number }
  ).count;
}

describe("publishCatalog", () => {
  it("publishes eligible zero-review stores and stays idempotent for the same Feature 2 staging input", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const brandEvidence = [
      approvedSingleEvidence(
        "hangang-bakery",
        "한강 빵집",
        "SEOUL-001"
      ),
      approvedSingleEvidence(
        "namsan-bakery",
        "남산 베이커리",
        "SEOUL-002"
      ),
      approvedSingleEvidence(
        "bukchon-bakery",
        "북촌 제과",
        "SEOUL-003"
      )
    ];

    try {
      const firstIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000
      });
      const firstPublish = publishCatalog({
        appDatabase: database,
        snapshotId: firstIngestion.snapshotId,
        brandEvidence,
        now: () => 1785034900000
      });

      expect(firstPublish).toMatchObject({
        status: "SUCCEEDED",
        candidateCount: 3,
        publishedCount: 2,
        excludedCount: 0,
        adminReviewCount: 1
      });
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'review_document'"
          )
          .get()
      ).toEqual({ count: 0 });

      const publishedStores = database.client
        .prepare(
          `SELECT
             s.store_id, s.latitude_e7, s.longitude_e7,
             d.status AS decision_status, d.reasons_json
           FROM store s
           JOIN eligibility_decision d ON d.store_id = s.store_id
           WHERE s.catalog_status = 'published'
           ORDER BY s.store_id`
        )
        .all() as Array<{
        store_id: string;
        latitude_e7: number;
        longitude_e7: number;
        decision_status: string;
        reasons_json: string;
      }>;
      expect(publishedStores).toHaveLength(2);
      expect(
        new Set(publishedStores.map((store) => store.store_id)).size
      ).toBe(2);
      for (const store of publishedStores) {
        expect(store.store_id).toMatch(/^store_[a-f0-9]{24}$/);
        expect(store.latitude_e7).toBeGreaterThanOrEqual(
          374000000
        );
        expect(store.latitude_e7).toBeLessThanOrEqual(377500000);
        expect(store.longitude_e7).toBeGreaterThanOrEqual(
          1267000000
        );
        expect(store.longitude_e7).toBeLessThanOrEqual(
          1273000000
        );
        expect(store.decision_status).toBe("eligible");
        const reasons = JSON.parse(store.reasons_json) as Array<{
          code: string;
          evidenceRefs: string[];
        }>;
        expect(reasons).not.toEqual([]);
        expect(
          reasons.every(
            (reason) =>
              reason.code.length > 0 &&
              reason.evidenceRefs.length > 0
          )
        ).toBe(true);
      }

      const adminReviewStores = database.client
        .prepare(
          `SELECT s.store_id
           FROM store s
           JOIN manual_review r
             ON r.target_type = 'store'
            AND r.target_id = s.store_id
           WHERE s.catalog_status = 'admin_review'
             AND r.status = 'open'
           ORDER BY s.store_id`
        )
        .all() as Array<{ store_id: string }>;
      expect(adminReviewStores).toHaveLength(1);
      expect(
        publishedStores.map((store) => store.store_id)
      ).not.toContain(adminReviewStores[0]!.store_id);

      const secondIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785035000000
      });
      const secondPublish = publishCatalog({
        appDatabase: database,
        snapshotId: secondIngestion.snapshotId,
        brandEvidence,
        now: () => 1785035100000
      });

      expect(secondIngestion.snapshotId).toBe(
        firstIngestion.snapshotId
      );
      expect(secondPublish).toEqual(firstPublish);
      expect({
        bakery: countRows(database, "bakery"),
        store: countRows(database, "store"),
        sourceLink: countRows(database, "store_source_link"),
        match: countRows(database, "match_candidate"),
        decision: countRows(database, "eligibility_decision"),
        manualReview: countRows(database, "manual_review"),
        publish: countRows(database, "data_publish")
      }).toEqual({
        bakery: 3,
        store: 3,
        sourceLink: 3,
        match: 0,
        decision: 3,
        manualReview: 1,
        publish: 1
      });
    } finally {
      database.close();
    }
  });

  it("keeps store identity stable when the same stores arrive in a changed snapshot", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const brandEvidence = [
      approvedSingleEvidence(
        "hangang-bakery",
        "한강 빵집",
        "SEOUL-001"
      ),
      approvedSingleEvidence(
        "namsan-bakery",
        "남산 베이커리",
        "SEOUL-002"
      ),
      approvedSingleEvidence(
        "bukchon-bakery",
        "북촌 제과",
        "SEOUL-003"
      )
    ];

    try {
      const firstIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000
      });
      publishCatalog({
        appDatabase: database,
        snapshotId: firstIngestion.snapshotId,
        brandEvidence,
        now: () => 1785034900000
      });
      const firstStoreIds = (
        database.client
          .prepare("SELECT store_id FROM store ORDER BY store_id")
          .all() as Array<{ store_id: string }>
      ).map((row) => row.store_id);

      const changedFixture = createChangedSnapshotFixture(fixture);
      const secondIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(changedFixture),
        basisDate: changedFixture.basisDate,
        pageSize: 2,
        now: () => 1785121200000
      });
      publishCatalog({
        appDatabase: database,
        snapshotId: secondIngestion.snapshotId,
        brandEvidence,
        now: () => 1785121300000
      });
      const secondStoreIds = (
        database.client
          .prepare("SELECT store_id FROM store ORDER BY store_id")
          .all() as Array<{ store_id: string }>
      ).map((row) => row.store_id);

      expect(secondIngestion.snapshotId).not.toBe(
        firstIngestion.snapshotId
      );
      expect(secondStoreIds).toEqual(firstStoreIds);
      expect(countRows(database, "store")).toBe(3);
      expect(countRows(database, "store_source_link")).toBe(6);
    } finally {
      database.close();
    }
  });

  it("cannot publish five stores by omitting a sixth apparent brand member", async () => {
    const fixture = createSixStoreFixture();
    const database = await createMigratedDatabase();
    const evidence = brandEligibilityEvidenceSchema.parse({
      brandKey: "fixture-six-store-chain",
      displayName: "검증 체인",
      sourceManagementNumbers: Array.from(
        { length: 5 },
        (_, index) => `SEOUL-CHAIN-${index + 1}`
      ),
      ftcStatus: "not_found",
      ftcEvidenceRefs: ["fixture://ftc/no-match/six-store-chain"],
      operatorEvidenceRefs: ["fixture://operator/six-store-chain"],
      independenceEvidenceRefs: [],
      adminReviewStatus: "approved",
      adminEvidenceRefs: ["fixture://admin/six-store-chain"]
    });

    try {
      const ingestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 6,
        now: () => 1785034800000
      });
      const summary = publishCatalog({
        appDatabase: database,
        snapshotId: ingestion.snapshotId,
        brandEvidence: [evidence],
        now: () => 1785034900000
      });

      expect(summary).toMatchObject({
        publishedCount: 0,
        excludedCount: 6,
        adminReviewCount: 0
      });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
             FROM eligibility_decision
             WHERE classification = 'CHAIN_TOO_LARGE'
               AND status = 'excluded'`
          )
          .get()
      ).toEqual({ count: 6 });
    } finally {
      database.close();
    }
  });

  it("rolls back every catalog mutation when persistence fails", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const brandEvidence = [
      approvedSingleEvidence(
        "hangang-bakery",
        "한강 빵집",
        "SEOUL-001"
      ),
      approvedSingleEvidence(
        "namsan-bakery",
        "남산 베이커리",
        "SEOUL-002"
      ),
      approvedSingleEvidence(
        "bukchon-bakery",
        "북촌 제과",
        "SEOUL-003"
      )
    ];

    try {
      const ingestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000
      });
      database.client.exec(
        `CREATE TRIGGER fail_eligibility_persist
         BEFORE INSERT ON eligibility_decision
         BEGIN
           SELECT RAISE(ABORT, 'fixture persistence failure');
         END`
      );

      expect(() =>
        publishCatalog({
          appDatabase: database,
          snapshotId: ingestion.snapshotId,
          brandEvidence,
          now: () => 1785034900000
        })
      ).toThrow("fixture persistence failure");
      expect({
        bakery: countRows(database, "bakery"),
        store: countRows(database, "store"),
        sourceLink: countRows(database, "store_source_link"),
        match: countRows(database, "match_candidate"),
        decision: countRows(database, "eligibility_decision"),
        manualReview: countRows(database, "manual_review"),
        publish: countRows(database, "data_publish")
      }).toEqual({
        bakery: 0,
        store: 0,
        sourceLink: 0,
        match: 0,
        decision: 0,
        manualReview: 0,
        publish: 0
      });
    } finally {
      database.close();
    }
  });
});
