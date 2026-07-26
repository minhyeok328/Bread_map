# Seoul Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행정안전부 `식품_제과점영업` 응답을 고정 fixture와 같은 계약으로 검증하고, 서울 후보 원본 row와 정규화 전 staging row를 `app.sqlite`에 누락·중복 없이 적재하며 안전한 checkpoint와 run summary를 남긴다.

**Architecture:** `packages/contracts`가 LOCALDATA envelope·row와 ingestion summary를 검증하고, worker client는 주입된 `fetch`로 page를 읽되 secret나 body를 노출하지 않는다. `app.sqlite`에는 source catalog, immutable snapshot, allowlist된 원본 row, typed staging row, run, page checkpoint와 redacted quality issue를 서로 다른 table로 저장한다. 전체 page를 검증한 canonical snapshot checksum으로 같은 snapshot과 run을 재사용하고, page transaction의 upsert와 unique key로 재실행을 멱등하게 만든다.

**Tech Stack:** Node.js 24, TypeScript 6, Zod 4, better-sqlite3 12, Drizzle ORM 0.45, Drizzle Kit 0.31, Vitest 4

## Global Constraints

- `app.sqlite`만 source catalog·snapshot·staging·ingestion checkpoint를 소유하며 `raw.sqlite` migration은 변경하지 않는다.
- API 응답에서 승인된 LOCALDATA 최소 field만 원본 row canonical JSON에 남긴다. API key와 전체 response body는 저장·로그하지 않는다.
- 로그는 event, run/source/snapshot ID, page와 읽음·삽입·갱신·거부 count만 허용한다. 주소·전화·사람 이름·token·secret는 로그 field가 될 수 없다.
- CI와 자동 test는 `apps/worker/src/catalog/__fixtures__/localdata-seoul.json`만 사용한다. live mode는 `--live`와 `DATA_GO_KR_SERVICE_KEY`가 함께 있을 때 operator가 명시적으로 실행한다.
- Feature 3의 상호·주소·좌표 service normalization, 좌표계 변환, 중복 매장 병합, franchise/eligibility 판정과 catalog publish는 구현하지 않는다.
- 현재 작업에서는 사용자의 지시에 따라 commit과 push를 수행하지 않는다.

---

### Task 1: LOCALDATA response contract and paginated client

**Files:**
- Create: `packages/contracts/src/catalog.ts`
- Create: `packages/contracts/src/catalog.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/worker/src/catalog/localdata-client.ts`
- Create: `apps/worker/src/catalog/localdata-client.test.ts`
- Create: `apps/worker/src/catalog/__fixtures__/localdata-seoul.json`

**Interfaces:**
- Produces: `localdataSourceRowSchema`, `localdataPageResponseSchema`, `LocaldataSourceRow`, `LocaldataPage`, `IngestionSummary`
- Produces: `createLocaldataClient(options): LocaldataClient`
- Produces: `LocaldataClient.fetchPage({ pageNo, numOfRows }): Promise<LocaldataPage>`

- [ ] **Step 1: Add a two-page fixture with nullable fields**

The fixture shape is:

```ts
interface LocaldataFixture {
  basisDate: "2026-07-24";
  pages: [
    { response: { header: { resultCode: "00"; resultMsg: string }; body: { pageNo: 1; numOfRows: 2; totalCount: 4; items: LocaldataSourceRow[] } } },
    { response: { header: { resultCode: "00"; resultMsg: string }; body: { pageNo: 2; numOfRows: 2; totalCount: 4; items: LocaldataSourceRow[] } } }
  ];
}
```

It contains three Seoul rows and one non-Seoul row. At least one Seoul row has `LCPMT_YMD`, `CLSBIZ_YMD`, `ROAD_NM_ADDR`, coordinates or update time set to `null`.

- [ ] **Step 2: Write contract and pagination tests**

```ts
expect(localdataPageResponseSchema.parse(fixture.pages[0]).items).toHaveLength(2);
expect(() => localdataPageResponseSchema.parse(withoutMngNo)).toThrow();
expect(parsedNullableRow.roadNameAddress).toBeNull();
expect(requestedPageNumbers).toEqual([1, 2]);
expect(allPages.flatMap((page) => page.items)).toHaveLength(4);
```

The client test injects a fixture-backed `fetch` and asserts the requested URL has `pageNo`, `numOfRows`, `returnType=json` while never making a network request.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
corepack pnpm test -- packages/contracts/src/catalog.test.ts apps/worker/src/catalog/localdata-client.test.ts
```

Expected: FAIL because the catalog contract and client modules do not exist.

- [ ] **Step 4: Implement the minimum contract and client**

The response parser maps the provider envelope to:

```ts
interface LocaldataPage {
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: LocaldataSourceRow[];
}
```

`fetchPage` uses `https://apis.data.go.kr/1741000/bakeries/info`, checks HTTP success, JSON parsing, provider result code, requested/returned page equality and item count. Errors expose only stable codes such as `LOCALDATA_HTTP_ERROR`, `LOCALDATA_RESPONSE_INVALID` and `LOCALDATA_PAGE_MISMATCH`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 3 command. Expected: PASS with no external request.

### Task 2: Catalog schema and independent app migration

**Files:**
- Create: `packages/app-db/src/schema/catalog.ts`
- Create: `packages/app-db/src/schema/catalog.test.ts`
- Modify: `packages/app-db/src/schema/index.ts`
- Create: `drizzle/app/0001_catalog_ingestion.sql`
- Create: `drizzle/app/meta/0001_snapshot.json`
- Modify: `drizzle/app/meta/_journal.json`

**Interfaces:**
- Consumes: `LocaldataSourceRow`, `IngestionSummary`
- Produces: `sourceCatalog`, `sourceSnapshots`, `sourceSnapshotRows`, `localdataBakeryRecords`, `ingestionRuns`, `sourceCheckpoints`, `dataQualityIssues`

- [ ] **Step 1: Write a fresh-migration schema test**

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  "source_catalog",
  "source_snapshot",
  "source_snapshot_row",
  "localdata_bakery_record",
  "ingestion_run",
  "source_checkpoint",
  "data_quality_issue"
]));
expect(uniqueIndexes).toContain("source_snapshot_source_sha256_unique");
expect(uniqueIndexes).toContain("localdata_bakery_record_snapshot_mng_unique");
```

The test also verifies `source_snapshot_row.payload_json` and `localdata_bakery_record.road_name_address` are different columns in different tables, and migration reapplication succeeds.

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```powershell
corepack pnpm test -- packages/app-db/src/schema/catalog.test.ts
```

Expected: FAIL because the catalog tables and migration do not exist.

- [ ] **Step 3: Implement Drizzle schema**

Use application-generated `TEXT` IDs, epoch-millisecond `INTEGER` timestamps, foreign keys inside `app.sqlite`, and these uniqueness contracts:

```text
source_catalog(source_key)
source_snapshot(source_id, sha256 BLOB)
source_snapshot_row(snapshot_id, page_no, row_index)
source_snapshot_row(snapshot_id, source_row_key)
localdata_bakery_record(snapshot_id, mng_no)
ingestion_run(source_id, snapshot_id, adapter_version)
source_checkpoint(run_id, page_no)
data_quality_issue(run_id, source_row_id, rule_code)
```

Only ingestion status values `RUNNING`, `SUCCEEDED`, `FAILED_FINAL` are allowed in this Feature. Source coordinates remain canonical source text for Feature 3; no WGS84 conversion or matching fields are added.

- [ ] **Step 4: Generate only the app migration**

Run:

```powershell
& .\node_modules\.bin\drizzle-kit.CMD generate --name=catalog_ingestion --config=drizzle/app.config.ts
```

Review the generated SQL and metadata. `drizzle/raw` must remain byte-for-byte unchanged.

- [ ] **Step 5: Run the schema and existing migration tests**

Run:

```powershell
corepack pnpm test -- packages/app-db/src/schema/catalog.test.ts scripts/migrate-databases.test.ts
```

Expected: PASS for fresh and repeated app migration and existing raw migration.

### Task 3: Allowlisted source row to typed staging conversion

**Files:**
- Create: `apps/worker/src/catalog/normalize-source-row.ts`
- Create: `apps/worker/src/catalog/normalize-source-row.test.ts`

**Interfaces:**
- Consumes: `LocaldataSourceRow`
- Produces: `normalizeSourceRow(row): { accepted: true; value: LocaldataStagingRow } | { accepted: false; reasonCode: "ADDRESS_MISSING" | "NOT_SEOUL" | "INVALID_DATE" | "INVALID_TIMESTAMP" | "INVALID_COORDINATE" }`

- [ ] **Step 1: Write table tests for accepted, nullable and rejected rows**

```ts
expect(normalizeSourceRow(seoulRow)).toMatchObject({
  accepted: true,
  value: { mngNo: "SEOUL-001", permitDate: "2020-01-02" }
});
expect(normalizeSourceRow(nullableSeoulRow)).toMatchObject({
  accepted: true,
  value: { permitDate: null, closedDate: null }
});
expect(normalizeSourceRow(nonSeoulRow)).toEqual({
  accepted: false,
  reasonCode: "NOT_SEOUL"
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm test -- apps/worker/src/catalog/normalize-source-row.test.ts
```

Expected: FAIL because the conversion module does not exist.

- [ ] **Step 3: Implement representation-only normalization**

Trim allowlisted source strings, convert empty nullable values to `null`, convert `YYYYMMDD` to `YYYY-MM-DD`, validate update timestamps and preserve EPSG:5174 coordinate text without transforming it. Seoul selection uses road address first and lot-number address second. Do not normalize store names/addresses, merge rows, transform coordinates or decide eligibility.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 4: Idempotent ingestion, page checkpoints and safe logs

**Files:**
- Create: `apps/worker/src/catalog/run-ingestion.ts`
- Create: `apps/worker/src/catalog/run-ingestion.test.ts`

**Interfaces:**
- Consumes: `LocaldataClient`, `AppDatabaseHandle`, `basisDate`, `now`, optional safe logger
- Produces: `runLocaldataIngestion(options): Promise<IngestionSummary>`
- Produces safe log events `catalog_page_committed` and `catalog_ingestion_completed`

- [ ] **Step 1: Write an integration test against a fresh migrated app DB**

```ts
expect(first.summary).toMatchObject({
  readCount: 4,
  insertedCount: 3,
  updatedCount: 0,
  rejectedCount: 1,
  pageCount: 2
});
expect(stagingRows).toHaveLength(3);
expect(sourceRows).toHaveLength(4);
expect(checkpoints).toHaveLength(2);
```

The same test runs the exact fixture again and asserts:

```ts
expect(second.runId).toBe(first.runId);
expect(second).toMatchObject({ insertedCount: 0, updatedCount: 0 });
expect(stagingRowsAfterSecondRun).toHaveLength(3);
expect(sourceRowsAfterSecondRun).toHaveLength(4);
```

- [ ] **Step 2: Add checkpoint-count and repair-upsert tests**

Assert each checkpoint records page read/insert/update/reject counts. Mutate one staging value between runs, rerun the same snapshot, and expect one update with no new row.

- [ ] **Step 3: Add an automated log safety test**

Serialize every captured log event and assert it does not contain:

```ts
["fixture-api-key", "serviceKey", "response", "ROAD_NM_ADDR", "LOTNO_ADDR", "서울특별시", "010-", "OWNER_NM"]
```

The fixture may include an unknown phone/person-name field to prove the Zod allowlist strips it before canonical row persistence and logging.

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm test -- apps/worker/src/catalog/run-ingestion.test.ts
```

Expected: FAIL because the ingestion service does not exist.

- [ ] **Step 5: Implement checksum, transactions, upserts and summaries**

Fetch pages until `pageNo * numOfRows >= totalCount`; reject total-count drift, duplicate page numbers and duplicate source keys inside one snapshot. Canonically serialize the validated allowlisted page rows, calculate SHA-256 and byte size, reuse `(source_id, sha256)` snapshot and deterministic `(source_id, snapshot_id, adapter_version)` run, then commit each page in a short app DB transaction.

For every page:

1. insert immutable `source_snapshot_row` records;
2. convert each row to staging or a redacted quality issue;
3. insert unchanged staging rows, update drifted staging rows, and never duplicate `(snapshot_id, mng_no)`;
4. upsert the page checkpoint with current-attempt counts;
5. after all pages, update the run status and aggregate counts.

- [ ] **Step 6: Run the focused and related tests and verify GREEN**

Run:

```powershell
corepack pnpm test -- apps/worker/src/catalog/run-ingestion.test.ts apps/worker/src/catalog/localdata-client.test.ts packages/app-db/src/schema/catalog.test.ts
```

Expected: PASS.

### Task 5: Fixture command, explicit live smoke and delivery sync

**Files:**
- Create: `apps/worker/src/commands/ingest-catalog.ts`
- Create: `apps/worker/src/commands/ingest-catalog.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/index.ts`
- Modify: `package.json`
- Modify: `docs/10-delivery/README.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Interfaces:**
- Produces: `ingestCatalogCommand({ argv, env, fetchImpl, stdout, now }): Promise<IngestionSummary>`
- Produces root scripts `ingest:catalog:fixture` and `smoke:catalog:live`

- [ ] **Step 1: Write command mode tests**

```ts
await expect(command({ argv: [], env: {} })).rejects.toThrow("INGEST_MODE_REQUIRED");
await expect(command({ argv: ["--live"], env: {} })).rejects.toThrow("DATA_GO_KR_SERVICE_KEY_REQUIRED");
expect(await command({ argv: ["--fixture", fixturePath], env: {} })).toMatchObject({
  insertedCount: 3,
  rejectedCount: 1
});
```

The test supplies a temporary app path and confirms fixture mode makes zero external requests. Live mode is not invoked with a key in automated tests.

- [ ] **Step 2: Run the command test and verify RED**

Run:

```powershell
corepack pnpm test -- apps/worker/src/commands/ingest-catalog.test.ts
```

Expected: FAIL because the command does not exist.

- [ ] **Step 3: Implement command and scripts**

`--fixture <path>` reads the committed fixture and serves its pages through an injected fixture `fetch`. `--live` is the only mode that reads `DATA_GO_KR_SERVICE_KEY`; it uses the official client endpoint and never prints the key or response body. Both modes migrate/open only the app DB and print a single safe JSON summary.

- [ ] **Step 4: Synchronize delivery docs**

Document the fixture command as the automated/CI path and the live command as an optional manual smoke. Record that no Docker, raw DB migration or external key is required for automated verification, and that Feature 3 remains pending.

- [ ] **Step 5: Run fixture command twice against one temporary app DB**

Expected first summary: read 4, inserted 3, updated 0, rejected 1. Expected second summary: read 4, inserted 0, updated 0, rejected 1. DB staging count remains 3.

### Task 6: Full verification and migration drift

**Files:**
- Verify all modified files; do not add live credentials or generated runtime databases.

- [ ] **Step 1: Run frozen install and static/runtime gates**

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

- [ ] **Step 2: Run both migration drift checks**

```powershell
corepack pnpm db:check:app
corepack pnpm db:check:raw
```

Expected: both pass; only app migration history changed.

- [ ] **Step 3: Inspect repository cleanliness and prohibited artifacts**

Confirm no SQLite/WAL/SHM, API key, response-body dump, `.env`, build output or unrelated user change is tracked. Do not run the live smoke without an operator-provided key and explicit invocation.

## Plan Self-Review

- Spec coverage: schema, pagination, nullable fields, raw/staging separation, snapshot/run idempotency, page/run counts, log safety, fixture-only CI and explicit live smoke each map to Tasks 1–5.
- Scope boundary: store normalization, WGS84 conversion, merge, franchise and eligibility are explicitly excluded from Tasks 2–4.
- Type consistency: `LocaldataSourceRow` flows from Task 1 to Tasks 3–4; `LocaldataPage` is the client output; `IngestionSummary` is shared by service and command.
- Placeholder scan: no deferred implementation placeholder remains. Feature 3 work is an explicit non-goal, not an unfinished Feature 2 step.
