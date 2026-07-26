import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateAppDatabase,
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import { afterEach, describe, expect, it } from "vitest";
import { createLocaldataClient } from "./localdata-client.js";
import {
  runLocaldataIngestion,
  type SafeCatalogLogEvent
} from "./run-ingestion.js";

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
    join(tmpdir(), "bread-map-ingestion-")
  );
  cleanupPaths.push(directory);
  const database = openAppDatabase({
    path: join(directory, "app.sqlite")
  });
  migrateAppDatabase(database, resolve("drizzle/app"));
  return database;
}

describe("runLocaldataIngestion", () => {
  it("loads every valid Seoul row, checkpoints pages and stays idempotent", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();
    const events: SafeCatalogLogEvent[] = [];

    try {
      const first = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000,
        logger: (event) => events.push(event)
      });

      expect(first).toMatchObject({
        status: "SUCCEEDED",
        pageCount: 2,
        readCount: 4,
        insertedCount: 3,
        updatedCount: 0,
        rejectedCount: 1
      });

      const sourceRows = database.client
        .prepare(
          "SELECT source_row_key, payload_json FROM source_snapshot_row ORDER BY source_row_key"
        )
        .all() as Array<{
        source_row_key: string;
        payload_json: string;
      }>;
      const stagingRows = database.client
        .prepare(
          "SELECT mng_no, business_name FROM localdata_bakery_record ORDER BY mng_no"
        )
        .all();
      const checkpoints = database.client
        .prepare(
          `SELECT page_no, read_count, inserted_count, updated_count, rejected_count
           FROM source_checkpoint ORDER BY page_no`
        )
        .all();

      expect(sourceRows).toHaveLength(4);
      expect(stagingRows).toEqual([
        { mng_no: "SEOUL-001", business_name: "한강 빵집" },
        { mng_no: "SEOUL-002", business_name: "남산 베이커리" },
        { mng_no: "SEOUL-003", business_name: "북촌 제과" }
      ]);
      expect(checkpoints).toEqual([
        {
          page_no: 1,
          read_count: 2,
          inserted_count: 2,
          updated_count: 0,
          rejected_count: 0
        },
        {
          page_no: 2,
          read_count: 2,
          inserted_count: 1,
          updated_count: 0,
          rejected_count: 1
        }
      ]);
      expect(
        database.client
          .prepare("SELECT count(*) AS count FROM data_quality_issue")
          .get()
      ).toEqual({ count: 1 });
      expect(sourceRows[0]?.payload_json).not.toContain("SITE_TEL");
      expect(sourceRows[0]?.payload_json).not.toContain("OWNER_NM");
      expect(sourceRows[0]?.payload_json).not.toContain("010-0000-0000");

      const second = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034860000,
        logger: (event) => events.push(event)
      });

      expect(second).toMatchObject({
        runId: first.runId,
        snapshotId: first.snapshotId,
        status: "SUCCEEDED",
        pageCount: 2,
        readCount: 4,
        insertedCount: 0,
        updatedCount: 0,
        rejectedCount: 1
      });
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM source_snapshot_row"
          )
          .get()
      ).toEqual({ count: 4 });
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM localdata_bakery_record"
          )
          .get()
      ).toEqual({ count: 3 });
      expect(
        database.client
          .prepare("SELECT count(*) AS count FROM source_checkpoint")
          .get()
      ).toEqual({ count: 2 });

      const serializedLogs = JSON.stringify(events);
      for (const prohibited of [
        "fixture-api-key",
        "serviceKey",
        "response",
        "ROAD_NM_ADDR",
        "LOTNO_ADDR",
        "서울특별시",
        "010-",
        "OWNER_NM"
      ]) {
        expect(serializedLogs).not.toContain(prohibited);
      }
    } finally {
      database.close();
    }
  });

  it("repairs a drifted staging row as an update without duplication", async () => {
    const fixture = loadFixture();
    const database = await createMigratedDatabase();

    try {
      await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034800000
      });
      database.client
        .prepare(
          "UPDATE localdata_bakery_record SET business_name = ? WHERE mng_no = ?"
        )
        .run("tampered", "SEOUL-001");

      const repaired = await runLocaldataIngestion({
        appDatabase: database,
        client: createFixtureClient(fixture),
        basisDate: fixture.basisDate,
        pageSize: 2,
        now: () => 1785034860000
      });

      expect(repaired).toMatchObject({
        insertedCount: 0,
        updatedCount: 1,
        rejectedCount: 1
      });
      expect(
        database.client
          .prepare(
            "SELECT business_name FROM localdata_bakery_record WHERE mng_no = ?"
          )
          .get("SEOUL-001")
      ).toEqual({ business_name: "한강 빵집" });
      expect(
        database.client
          .prepare(
            "SELECT count(*) AS count FROM localdata_bakery_record"
          )
          .get()
      ).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });
});
