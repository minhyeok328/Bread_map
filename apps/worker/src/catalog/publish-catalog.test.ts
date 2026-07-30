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

function createFixtureWithoutStore(
  fixture: Fixture,
  managementNumber: string
): Fixture {
  const changed = createChangedSnapshotFixture(fixture) as {
    basisDate: string;
    pages: Array<{
      response: {
        body: {
          totalCount: number;
          items: Array<Record<string, unknown>>;
        };
      };
    }>;
  };
  changed.basisDate = "2026-07-26";
  let totalCount = 0;
  for (const page of changed.pages) {
    page.response.body.items =
      page.response.body.items.filter(
        (item) => item.MNG_NO !== managementNumber
      );
    totalCount += page.response.body.items.length;
  }
  for (const page of changed.pages) {
    page.response.body.totalCount = totalCount;
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
            "SELECT count(*) AS count FROM review_document"
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
      expect(
        database.client
          .prepare(
            `SELECT
               state_id AS stateId,
               publish_id AS publishId,
               snapshot_id AS snapshotId,
               source_basis_date AS sourceBasisDate
             FROM catalog_publish_state`
          )
          .get()
      ).toEqual({
        stateId: "active",
        publishId: firstPublish.publishId,
        snapshotId: firstIngestion.snapshotId,
        sourceBasisDate: fixture.basisDate
      });
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
      expect(
        database.client
          .prepare(
            `SELECT publish_id AS publishId,
                    snapshot_id AS snapshotId,
                    source_basis_date AS sourceBasisDate
             FROM catalog_publish_state
             WHERE state_id = 'active'`
          )
          .get()
      ).toEqual({
        publishId: expect.any(String),
        snapshotId: secondIngestion.snapshotId,
        sourceBasisDate: changedFixture.basisDate
      });
    } finally {
      database.close();
    }
  });

  it("rejects a stale source replay before mutating the active catalog", async () => {
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
      const before = database.client
        .prepare(
          `SELECT
             state.publish_id AS publishId,
             state.snapshot_id AS snapshotId,
             group_concat(store.store_id || ':' || store.updated_at_ms,
               ',') AS storeState
           FROM catalog_publish_state AS state
           CROSS JOIN store
          WHERE state.state_id = 'active'
          ORDER BY store.store_id`
        )
        .get();

      const olderFixture = createChangedSnapshotFixture(fixture);
      olderFixture.basisDate = "2026-07-23";
      const olderIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(olderFixture),
        basisDate: olderFixture.basisDate,
        pageSize: 2,
        now: () => 1784948400000
      });

      expect(() =>
        publishCatalog({
          appDatabase: database,
          snapshotId: olderIngestion.snapshotId,
          brandEvidence,
          now: () => 1785200000000
        })
      ).toThrow("CATALOG_SOURCE_STALE");
      expect(
        database.client
          .prepare(
            `SELECT
               state.publish_id AS publishId,
               state.snapshot_id AS snapshotId,
               group_concat(store.store_id || ':' || store.updated_at_ms,
                 ',') AS storeState
             FROM catalog_publish_state AS state
             CROSS JOIN store
            WHERE state.state_id = 'active'
            ORDER BY store.store_id`
          )
          .get()
      ).toEqual(before);
      expect(firstPublish.publishId).toBe(
        (
          before as {
            publishId: string;
          }
        ).publishId
      );
    } finally {
      database.close();
    }
  });

  it("rechecks source order inside the transaction before mutating catalog rows", async () => {
    const fixture = loadFixture();
    const middleFixture = createChangedSnapshotFixture(fixture);
    const newestFixture = createFixtureWithoutStore(
      fixture,
      "SEOUL-001"
    );
    const database = await createMigratedDatabase();
    const initialEvidence = [
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
      const initialIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000
      });
      publishCatalog({
        appDatabase: database,
        snapshotId: initialIngestion.snapshotId,
        brandEvidence: initialEvidence,
        now: () => 1785034900000
      });
      const removedStore = database.client
        .prepare(
          `SELECT store_id AS storeId
           FROM store
           WHERE display_name = '한강 빵집'`
        )
        .get() as { storeId: string };
      const middleIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(middleFixture),
        basisDate: middleFixture.basisDate,
        pageSize: 2,
        now: () => 1785121200000
      });
      const newestIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(newestFixture),
        basisDate: newestFixture.basisDate,
        pageSize: 2,
        now: () => 1785207600000
      });
      let advanced = false;

      expect(() =>
        publishCatalog({
          appDatabase: database,
          snapshotId: middleIngestion.snapshotId,
          brandEvidence: initialEvidence,
          now: () => {
            if (!advanced) {
              advanced = true;
              publishCatalog({
                appDatabase: database,
                snapshotId: newestIngestion.snapshotId,
                brandEvidence: initialEvidence.filter(
                  (evidence) =>
                    !evidence.sourceManagementNumbers.includes(
                      "SEOUL-001"
                    )
                ),
                now: () => 1785207700000
              });
            }
            return 1785207800000;
          }
        })
      ).toThrow("CATALOG_SOURCE_STALE");
      expect(
        database.client
          .prepare(
            `SELECT snapshot_id AS snapshotId
             FROM catalog_publish_state
             WHERE state_id = 'active'`
          )
          .get()
      ).toEqual({ snapshotId: newestIngestion.snapshotId });
      expect(
        database.client
          .prepare(
            `SELECT catalog_status AS catalogStatus
             FROM store
             WHERE store_id = ?`
          )
          .get(removedStore.storeId)
      ).toEqual({ catalogStatus: "excluded" });
    } finally {
      database.close();
    }
  });

  it("supersedes active evidence when same-snapshot reclassification removes its store", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const initialEvidence = [
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
      const first = publishCatalog({
        appDatabase: database,
        snapshotId: ingestion.snapshotId,
        brandEvidence: initialEvidence,
        now: () => 1785034900000
      });
      const store = database.client
        .prepare(
          `SELECT store_id AS storeId
           FROM store
           WHERE display_name = '한강 빵집'`
        )
        .get() as { storeId: string };
      database.client
        .prepare(
          `INSERT INTO search_evidence_publish (
             publish_id, input_catalog_publish_id, contract_version,
             status, active_slot, menu_count, store_alias_count,
             menu_alias_count, business_hour_count, corpus_checksum,
             published_at_ms
           ) VALUES ('evidence_same_snapshot', ?,
             'search-evidence-v1', 'BUILDING', NULL, 1, 0, 0, 0, ?, 1)`
        )
        .run(first.publishId, "d".repeat(64));
      database.client
        .prepare(
          `INSERT INTO menu (
             menu_id, evidence_publish_id, store_id, name,
             normalized_name, category, source, evidence_ref,
             verified_at_ms
           ) VALUES ('menu_same_snapshot',
             'evidence_same_snapshot', ?, '소금빵', '소금빵',
             'SALT_BREAD', 'MANUAL_VERIFIED',
             'fixture://menu/salt-bread', 1)`
        )
        .run(store.storeId);
      database.client
        .prepare(
          `UPDATE search_evidence_publish
           SET status = 'ACTIVE', active_slot = 1
           WHERE publish_id = 'evidence_same_snapshot'`
        )
        .run();
      const reclassifiedEvidence = initialEvidence.map((evidence) =>
        evidence.sourceManagementNumbers.includes("SEOUL-001")
          ? brandEligibilityEvidenceSchema.parse({
              ...evidence,
              ftcStatus: "confirmed_franchise",
              ftcEvidenceRefs: [
                "fixture://ftc/franchise/hangang-bakery"
              ]
            })
          : evidence
      );

      const second = publishCatalog({
        appDatabase: database,
        snapshotId: ingestion.snapshotId,
        brandEvidence: reclassifiedEvidence,
        now: () => 1785035000000
      });

      expect(second.publishId).toBe(first.publishId);
      expect(
        database.client
          .prepare(
            `SELECT catalog_status AS catalogStatus
             FROM store
             WHERE store_id = ?`
          )
          .get(store.storeId)
      ).toEqual({ catalogStatus: "excluded" });
      expect(
        database.client
          .prepare(
            `SELECT status, active_slot AS activeSlot
             FROM search_evidence_publish
             WHERE publish_id = 'evidence_same_snapshot'`
          )
          .get()
      ).toEqual({
        status: "SUPERSEDED",
        activeSlot: null
      });
    } finally {
      database.close();
    }
  });

  it("uses snapshot ID as the final source-order tie breaker", async () => {
    const fixture = loadFixture();
    const changedFixture = createChangedSnapshotFixture(fixture);
    changedFixture.basisDate = fixture.basisDate;
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
      const snapshots: Array<{ snapshotId: string }> = [];
      for (const input of [fixture, changedFixture]) {
        snapshots.push(
          await runLocaldataIngestion({
            appDatabase: database,
            client: createFixtureClient(input),
            basisDate: input.basisDate,
            pageSize: 2,
            now: () => 1785034800000
          })
        );
      }
      const [lower, higher] = [...snapshots].sort((left, right) =>
        left.snapshotId < right.snapshotId ? -1 : 1
      );

      publishCatalog({
        appDatabase: database,
        snapshotId: lower!.snapshotId,
        brandEvidence,
        now: () => 1785034900000
      });
      const latest = publishCatalog({
        appDatabase: database,
        snapshotId: higher!.snapshotId,
        brandEvidence,
        now: () => 1785035000000
      });

      expect(() =>
        publishCatalog({
          appDatabase: database,
          snapshotId: lower!.snapshotId,
          brandEvidence,
          now: () => 1785035100000
        })
      ).toThrow("CATALOG_SOURCE_STALE");
      expect(
        database.client
          .prepare(
            `SELECT publish_id AS publishId, snapshot_id AS snapshotId
             FROM catalog_publish_state
             WHERE state_id = 'active'`
          )
          .get()
      ).toEqual({
        publishId: latest.publishId,
        snapshotId: higher!.snapshotId
      });
    } finally {
      database.close();
    }
  });

  it("demotes stores absent from the active snapshot and supersedes their dependent evidence", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const initialEvidence = [
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
        brandEvidence: initialEvidence,
        now: () => 1785034900000
      });
      const removedStore = database.client
        .prepare(
          `SELECT store_id AS storeId
           FROM store
           WHERE display_name = '한강 빵집'`
        )
        .get() as { storeId: string };

      database.client
        .prepare(
          `INSERT INTO review_publish_version (
             version_id, source_run_id, source_run_status,
             source_as_of_date, status, active_slot, document_count,
             fts_document_count, corpus_checksum, published_at_ms
           ) VALUES ('review_publish_fixture', 'run_fixture',
             'SUCCEEDED', '2026-07-25', 'ACTIVE', 1, 1, 1, ?, 1)`
        )
        .run("a".repeat(64));
      database.client
        .prepare(
          `INSERT INTO review_document (
             review_id, store_id, provider, body, normalized_body,
             rating_basis_points, published_date, collected_at_ms,
             source_run_id, publish_version_id
           ) VALUES ('review_fixture', ?, 'KAKAO_MAP',
             '소금빵이 바삭해요', '소금빵 바삭함', 4500,
             '2026-07-20', 1, 'run_fixture',
             'review_publish_fixture')`
        )
        .run(removedStore.storeId);
      database.client
        .prepare(
          `INSERT INTO fts_index_state (
             state_id, index_version, publish_version_id, status,
             active_slot, document_count, corpus_checksum, built_at_ms
           ) VALUES ('fts_fixture', 'review-fts-unicode61-v1',
             'review_publish_fixture', 'ACTIVE', 1, 1, ?, 1)`
        )
        .run("a".repeat(64));
      database.client
        .prepare(
          `INSERT INTO search_evidence_publish (
             publish_id, input_catalog_publish_id, contract_version,
             status, active_slot, menu_count, store_alias_count,
             menu_alias_count, business_hour_count, corpus_checksum,
             published_at_ms
           ) VALUES ('evidence_fixture', ?, 'search-evidence-v1',
             'ACTIVE', 1, 0, 0, 0, 0, ?, 1)`
        )
        .run(firstPublish.publishId, "b".repeat(64));

      const nextFixture = createFixtureWithoutStore(
        fixture,
        "SEOUL-001"
      );
      const nextIngestion = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(nextFixture),
        basisDate: nextFixture.basisDate,
        pageSize: 2,
        now: () => 1785294000000
      });
      const nextEvidence = initialEvidence.filter(
        (evidence) =>
          !evidence.sourceManagementNumbers.includes("SEOUL-001")
      );
      publishCatalog({
        appDatabase: database,
        snapshotId: nextIngestion.snapshotId,
        brandEvidence: nextEvidence,
        now: () => 1785294100000
      });

      expect(
        database.client
          .prepare(
            `SELECT catalog_status AS catalogStatus
             FROM store
             WHERE store_id = ?`
          )
          .get(removedStore.storeId)
      ).toEqual({ catalogStatus: "excluded" });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
             FROM review_document
             WHERE store_id = ?`
          )
          .get(removedStore.storeId)
      ).toEqual({ count: 0 });
      expect(
        database.client
          .prepare(
            `SELECT status, active_slot AS activeSlot
             FROM search_evidence_publish
             WHERE publish_id = 'evidence_fixture'`
          )
          .get()
      ).toEqual({
        status: "SUPERSEDED",
        activeSlot: null
      });
      expect(
        database.client
          .prepare(
            `SELECT count(*) AS count
             FROM store_source_link
             WHERE store_id = ?
               AND snapshot_id = ?`
          )
          .get(removedStore.storeId, nextIngestion.snapshotId)
      ).toEqual({ count: 0 });
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
        publish: countRows(database, "data_publish"),
        publishState: countRows(
          database,
          "catalog_publish_state"
        )
      }).toEqual({
        bakery: 0,
        store: 0,
        sourceLink: 0,
        match: 0,
        decision: 0,
        manualReview: 0,
        publish: 0,
        publishState: 0
      });
    } finally {
      database.close();
    }
  });
});
