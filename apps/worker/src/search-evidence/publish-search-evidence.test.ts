import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  SEARCH_EVIDENCE_VERSION,
  type VerifiedSearchEvidenceBatch
} from "@bread-map/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { publishSearchEvidence } from "./publish-search-evidence.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function createDatabase(): Promise<AppDatabaseHandle> {
  const directory = await mkdtemp(
    join(tmpdir(), "bread-map-search-evidence-publish-")
  );
  cleanupPaths.push(directory);
  const database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  seedActiveCatalog(database);
  return database;
}

function seedActiveCatalog(database: AppDatabaseHandle): void {
  database.client
    .prepare(
      `INSERT INTO source_catalog (
         source_id, source_key, official_url, required_fields_json,
         terms_checked_at_ms, created_at_ms
       ) VALUES ('source_fixture', 'fixture', 'https://example.test',
         '[]', 1, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO source_snapshot (
         snapshot_id, source_id, sha256, byte_size, basis_date,
         downloaded_at_ms, adapter_version, local_path_hint
       ) VALUES ('snapshot_fixture', 'source_fixture', ?, 1,
         '2026-07-30', 100, 'fixture-v1', NULL)`
    )
    .run(Buffer.alloc(32, 1));
  database.client
    .prepare(
      `INSERT INTO source_snapshot_row (
         source_row_id, snapshot_id, page_no, row_index,
         source_row_key, payload_json, payload_sha256, created_at_ms
       ) VALUES ('source_row_fixture', 'snapshot_fixture', 1, 0,
         'SEOUL-FIXTURE-001', '{}', ?, 1)`
    )
    .run(Buffer.alloc(32, 2));
  database.client
    .prepare(
      `INSERT INTO localdata_bakery_record (
         record_id, snapshot_id, source_row_id, mng_no,
         open_authority_group_code, permit_date,
         business_status_code, business_status_name,
         detailed_business_status_code,
         detailed_business_status_name, closed_date, business_name,
         road_name_address, lot_number_address,
         source_coordinate_x, source_coordinate_y,
         data_updated_at_ms, last_modified_at_ms, staged_at_ms
       ) VALUES ('record_fixture', 'snapshot_fixture',
         'source_row_fixture', 'SEOUL-FIXTURE-001', '6110000', NULL,
         '01', '영업/정상', '01', '영업', NULL, '한강 빵집',
         '서울특별시 마포구 월드컵로 1', NULL, '191234.125',
         '451234.5', NULL, NULL, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO bakery (
         bakery_id, display_name, normalized_name, catalog_status,
         created_at_ms, updated_at_ms
       ) VALUES ('bakery_fixture', '한강 빵집', '한강빵집',
         'published', 1, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO store (
         store_id, bakery_id, display_name, normalized_name,
         normalized_brand_name, normalized_address, seoul_district,
         normalized_phone, latitude_e7, longitude_e7,
         business_status, catalog_status, latest_verified_at_ms,
         created_at_ms, updated_at_ms
       ) VALUES ('store_fixture', 'bakery_fixture', '한강 빵집',
         '한강빵집', '한강빵집', '서울특별시 마포구 월드컵로 1',
         '마포구', '0212345678', 375634614, 1269014494, 'active',
         'published', 100, 1, 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO store_source_link (
         link_id, store_id, source_record_id, source_row_id,
         snapshot_id, source_type, linked_at_ms
       ) VALUES ('link_fixture', 'store_fixture', 'record_fixture',
         'source_row_fixture', 'snapshot_fixture', 'LOCALDATA', 1)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO data_publish (
         publish_id, input_snapshot_id, normalization_version,
         matcher_version, eligibility_version, status,
         candidate_count, published_count, excluded_count,
         admin_review_count, published_at_ms
       ) VALUES ('publish_fixture', 'snapshot_fixture',
         'store-normalization-v1', 'store-matcher-v1',
         'store-eligibility-v1', 'SUCCEEDED', 1, 1, 0, 0, 100)`
    )
    .run();
  database.client
    .prepare(
      `INSERT INTO catalog_publish_state (
         state_id, publish_id, snapshot_id, source_basis_date,
         source_downloaded_at_ms, updated_at_ms
       ) VALUES ('active', 'publish_fixture', 'snapshot_fixture',
         '2026-07-30', 100, 100)`
    )
    .run();
}

function validBatch(): VerifiedSearchEvidenceBatch {
  return {
    catalogPublishId: "publish_fixture",
    contractVersion: SEARCH_EVIDENCE_VERSION,
    menus: [
      {
        storeId: "store_fixture",
        name: " 소금빵 ",
        category: "SALT_BREAD",
        source: "MANUAL_VERIFIED",
        evidenceRef: "fixture://menu/salt-bread",
        verifiedAtMs: 200,
        aliases: [
          {
            alias: "시오빵",
            source: "MANUAL_VERIFIED",
            evidenceRef: "fixture://menu/sio-bread",
            verifiedAtMs: 200
          }
        ]
      },
      {
        storeId: "store_fixture",
        name: "크루아상",
        category: "PASTRY",
        source: "MANUAL_VERIFIED",
        evidenceRef: "fixture://menu/croissant",
        verifiedAtMs: 200,
        aliases: []
      }
    ],
    storeAliases: [
      {
        storeId: "store_fixture",
        aliasType: "REGION",
        alias: "홍대입구",
        source: "MANUAL_VERIFIED",
        evidenceRef: "fixture://region/hongdae",
        verifiedAtMs: 200
      }
    ],
    businessHours: [
      {
        storeId: "store_fixture",
        weekday: 4,
        sequence: 0,
        opensMinute: 600,
        closesMinute: 1080,
        closesNextDay: false,
        source: "MANUAL_VERIFIED",
        evidenceRef: "fixture://hours/thursday",
        verifiedAtMs: 200
      }
    ]
  };
}

describe("publishSearchEvidence", () => {
  it("publishes a normalized immutable batch and replays idempotently", async () => {
    const database = await createDatabase();
    try {
      const first = publishSearchEvidence({
        appDatabase: database,
        batch: validBatch(),
        now: () => 300
      });
      const second = publishSearchEvidence({
        appDatabase: database,
        batch: structuredClone(validBatch()),
        now: () => 999
      });

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        publishId: expect.stringMatching(
          /^search_evidence_[0-9a-f]{24}$/
        ),
        catalogPublishId: "publish_fixture",
        corpusChecksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        menuCount: 2,
        menuAliasCount: 1,
        storeAliasCount: 1,
        businessHourCount: 1,
        publishedAtMs: 300
      });
      expect(
        database.client
          .prepare(
            `SELECT name, normalized_name AS normalizedName
             FROM menu
             ORDER BY normalized_name`
          )
          .all()
      ).toEqual([
        { name: "소금빵", normalizedName: "소금빵" },
        { name: "크루아상", normalizedName: "크루아상" }
      ]);
      expect(
        database.client
          .prepare(
            `SELECT status, active_slot AS activeSlot
             FROM search_evidence_publish`
          )
          .all()
      ).toEqual([{ status: "ACTIVE", activeSlot: 1 }]);
    } finally {
      database.close();
    }
  });

  it("preserves verified display text while deriving compact search keys", async () => {
    const database = await createDatabase();
    try {
      const batch = structuredClone(validBatch());
      batch.menus[0]!.name = " Pain au Chocolat (70%) ";
      batch.menus[0]!.aliases[0]!.alias = " Chef's Choice ";

      publishSearchEvidence({
        appDatabase: database,
        batch,
        now: () => 300
      });

      expect(
        database.client
          .prepare(
            `SELECT name, normalized_name AS normalizedName
             FROM menu
             WHERE category = 'SALT_BREAD'`
          )
          .get()
      ).toEqual({
        name: "Pain au Chocolat (70%)",
        normalizedName: "painauchocolat70"
      });
      expect(
        database.client
          .prepare(
            `SELECT alias, normalized_alias AS normalizedAlias
             FROM menu_alias`
          )
          .get()
      ).toEqual({
        alias: "Chef's Choice",
        normalizedAlias: "chefschoice"
      });
    } finally {
      database.close();
    }
  });

  it.each([
    {
      name: "unknown input key",
      mutate: (batch: Record<string, unknown>) => {
        batch.debug = true;
      },
      code: "SEARCH_EVIDENCE_INPUT_INVALID"
    },
    {
      name: "unverified source",
      mutate: (batch: Record<string, unknown>) => {
        (
          batch.menus as Array<Record<string, unknown>>
        )[0]!.source = "INFERRED";
      },
      code: "SEARCH_EVIDENCE_INPUT_INVALID"
    },
    {
      name: "wrong active catalog",
      mutate: (batch: Record<string, unknown>) => {
        batch.catalogPublishId = "publish_other";
      },
      code: "SEARCH_EVIDENCE_CATALOG_MISMATCH"
    },
    {
      name: "non-member store",
      mutate: (batch: Record<string, unknown>) => {
        (
          batch.menus as Array<Record<string, unknown>>
        )[0]!.storeId = "store_missing";
      },
      code: "SEARCH_EVIDENCE_STORE_NOT_ACTIVE"
    },
    {
      name: "normalized duplicate menu",
      mutate: (batch: Record<string, unknown>) => {
        const menus = batch.menus as Array<Record<string, unknown>>;
        menus[1]!.name = "소금-빵";
      },
      code: "SEARCH_EVIDENCE_DUPLICATE"
    },
    {
      name: "overlapping hours",
      mutate: (batch: Record<string, unknown>) => {
        (
          batch.businessHours as Array<Record<string, unknown>>
        ).push({
          storeId: "store_fixture",
          weekday: 4,
          sequence: 1,
          opensMinute: 1000,
          closesMinute: 1200,
          closesNextDay: false,
          source: "MANUAL_VERIFIED",
          evidenceRef: "fixture://hours/overlap",
          verifiedAtMs: 200
        });
      },
      code: "SEARCH_EVIDENCE_HOURS_OVERLAP"
    }
  ])("rejects $name without writes", async ({ mutate, code }) => {
    const database = await createDatabase();
    try {
      const input = structuredClone(
        validBatch()
      ) as unknown as Record<string, unknown>;
      mutate(input);

      expect(() =>
        publishSearchEvidence({
          appDatabase: database,
          batch: input,
          now: () => 300
        })
      ).toThrow(code);
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM search_evidence_publish"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("validates large internal store sets in bounded SQLite chunks", async () => {
    const database = await createDatabase();
    try {
      const batch = structuredClone(validBatch());
      batch.menus = [];
      batch.storeAliases = [];
      batch.businessHours = Array.from(
        { length: 33000 },
        (_, index) => ({
          storeId: `store_missing_${index}`,
          weekday: 0,
          sequence: 0,
          opensMinute: 600,
          closesMinute: 1080,
          closesNextDay: false,
          source: "MANUAL_VERIFIED" as const,
          evidenceRef: `fixture://hours/${index}`,
          verifiedAtMs: 200
        })
      );

      expect(() =>
        publishSearchEvidence({
          appDatabase: database,
          batch,
          now: () => 300
        })
      ).toThrow("SEARCH_EVIDENCE_STORE_NOT_ACTIVE");
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM search_evidence_publish"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  }, 15000);

  it("atomically swaps the active batch and preserves it on failure", async () => {
    const database = await createDatabase();
    try {
      const first = publishSearchEvidence({
        appDatabase: database,
        batch: validBatch(),
        now: () => 300
      });
      const changed = structuredClone(validBatch());
      changed.menus[0]!.name = "통밀빵";
      changed.menus[0]!.category = "FERMENTED_BREAD";
      const second = publishSearchEvidence({
        appDatabase: database,
        batch: changed,
        now: () => 400
      });

      expect(second.publishId).not.toBe(first.publishId);
      expect(
        database.client
          .prepare(
            `SELECT publish_id AS publishId, status,
                    active_slot AS activeSlot
             FROM search_evidence_publish
             ORDER BY published_at_ms`
          )
          .all()
      ).toEqual([
        {
          publishId: first.publishId,
          status: "SUPERSEDED",
          activeSlot: null
        },
        {
          publishId: second.publishId,
          status: "ACTIVE",
          activeSlot: 1
        }
      ]);

      database.client.exec(
        `CREATE TRIGGER fail_search_evidence_menu
         BEFORE INSERT ON menu
         WHEN new.name = '실패빵'
         BEGIN
           SELECT RAISE(ABORT, 'fixture evidence failure');
         END`
      );
      const failing = structuredClone(validBatch());
      failing.menus[0]!.name = "실패빵";

      expect(() =>
        publishSearchEvidence({
          appDatabase: database,
          batch: failing,
          now: () => 500
        })
      ).toThrow("fixture evidence failure");
      expect(
        database.client
          .prepare(
            `SELECT publish_id AS publishId
             FROM search_evidence_publish
             WHERE status = 'ACTIVE' AND active_slot = 1`
          )
          .get()
      ).toEqual({ publishId: second.publishId });
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM search_evidence_publish"
          )
          .get()
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }
  });
});
