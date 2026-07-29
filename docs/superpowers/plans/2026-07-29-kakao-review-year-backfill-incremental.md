# Kakao Review Year Backfill and Incremental Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 매장당 20건 제한을 제거하고, Feature 3 published 매장의 공개 Kakao review를 최근 12개월 cutoff까지 최초 backfill한 뒤 operator 수동 run에서 신규 review만 증분 수집한다.

**Architecture:** 기존 worker-only Playwright·비식별·AES-GCM pipeline을 유지하면서 versioned DOM pagination contract, 400일 seen-fingerprint ledger와 store sync anchor를 추가한다. 최초 run은 cutoff 또는 DOM end까지 진행하고, 후속 run은 이전 anchor와 겹치는 page까지 처리하며 anchor가 사라지면 같은 logical run에서 backfill fallback으로 전환한다. 60분 실행 예산은 성공 상한이 아니라 checkpoint 기반 `PAUSED_BUDGET`이며, login·CAPTCHA·401·403·429·access denial·외부 redirect·DOM/order 변경은 provider run 전체를 즉시 중단한다.

**Tech Stack:** Node.js `>=24.15.0 <25`, TypeScript 6, pnpm 11.16.0, Zod 4, Drizzle ORM 0.45, better-sqlite3 12.11, Vitest 4, Playwright 1.61

## Global Constraints

- 구현 기준 설계는 `docs/superpowers/specs/2026-07-29-kakao-review-year-backfill-incremental-design.md`다.
- 모든 작업은 main agent가 직접 수행하며 Subagent나 병렬 agent를 사용하지 않는다.
- review 대상은 Feature 3 `catalog_status='published'`이고 strong Kakao match와 유효 locator가 있는 서울 매장뿐이다.
- review 기간은 run의 고정 `as_of_date`에서 UTC calendar month 기준 최근 12개월이며 개수 hard cap은 두지 않는다.
- 최초 run은 12개월 cutoff 또는 DOM end까지, 후속 run은 기존 anchor overlap까지 처리한다.
- cron·daemon·예약 실행·자동 resume·자동 retry는 추가하지 않는다.
- active provider run 1개와 active Playwright page 1개를 유지한다. 여러 review page를 같은 browser page의 DOM control로 순차 이동하는 것은 허용한다.
- page action 사이에는 3,000ms의 고정 최소 간격을 적용하고 random delay·proxy·stealth·User-Agent rotation을 사용하지 않는다.
- login·CAPTCHA·401·403·429·access denial·외부 origin redirect·DOM selector 변경·review 날짜 순서 변경은 provider run 전체를 즉시 중단한다.
- nickname은 HMAC fingerprint 계산 직후 폐기하고 어떤 DB·log·fixture output·error·summary에도 저장하지 않는다.
- 비식별 성공 body만 AES-256-GCM ciphertext로 저장한다. ciphertext·temporary locator는 최대 30일, seen fingerprint·sync state·run·checkpoint·audit는 최대 400일 보존한다.
- `raw.sqlite`는 backup·snapshot·restore하지 않고 `apps/web`은 raw schema·locator·secret·collector를 import하지 않는다.
- CLI와 test summary는 status·mode별 store count·collected/duplicate/rejected/failed count와 비민감 reason code만 출력한다.
- live는 current Kakao policy·실제 app quota·sanitized selector contract·worker-only secret·expanded-volume acknowledgement가 모두 확인된 뒤 별도 사용자 승인으로만 실행한다.
- GitHub #14는 기존 20건 Feature 4 구현 이력으로 보존한다. 새 issue 생성·수정은 이 계획의 코드·문서 작업에 포함하지 않는다.

---

## File Responsibility Map

### Existing files to modify

| Path | Responsibility |
|---|---|
| `docs/09-decisions/decision-log.md` | DR-036으로 DR-035의 20건 상한만 확장 |
| `docs/superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md` | 후속 확장 설계 링크와 superseded count 경계 표시 |
| `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md` | Feature 4 완료 기준을 backfill·incremental로 갱신 |
| `docs/05-data/data-design.md` | seen fingerprint·sync state·30/400일 retention |
| `docs/06-trust/policy-review.md` | 확장 volume 위험과 수동 gate |
| `docs/06-trust/security-design.md` | 400일 HMAC ledger와 key rotation kill switch |
| `docs/07-experiments/review-collection-experiment.md` | initial·incremental·pause/resume 운영 계약 |
| `docs/08-operations/operating-baselines.md` | quota·run budget·count-only audit |
| `docs/10-delivery/development-readiness-checklist.md` | expanded-volume live gate |
| `docs/10-delivery/local-development.md` | fixture·live·resume 명령 |
| `docs/README.md` | 확장 설계·구현 계획 링크와 상태 |
| `packages/contracts/src/review.ts` | 새 run status와 count-only summary |
| `packages/contracts/src/review.test.ts` | public contract accept/reject tests |
| `packages/raw-db/src/schema/review-runs.ts` | run invariants와 status·mode별 count |
| `packages/raw-db/src/schema/raw-reviews.ts` | ciphertext unique index에 key version 명시 |
| `packages/raw-db/src/schema/index.ts` | sync schema export |
| `packages/raw-db/src/index.ts` | sync schema export |
| `packages/raw-db/src/database.test.ts` | fresh·upgrade migration table 검증 |
| `packages/raw-db/src/schema/reviews.test.ts` | sync schema constraints·retention |
| `drizzle/raw/meta/_journal.json` | raw migration journal |
| `apps/worker/src/reviews/review-dom-contract.ts` | `kakao-review-dom-v2` pagination mode |
| `apps/worker/src/reviews/review-dom-contract.test.ts` | v2 contract validation |
| `apps/worker/src/reviews/extract-review-page.ts` | count cap 제거, cutoff·order·offset result |
| `apps/worker/src/reviews/extract-review-page.test.ts` | 21+·cutoff·order·append/replace extraction |
| `apps/worker/src/reviews/browser-session.ts` | response status provider-stop monitor |
| `apps/worker/src/reviews/browser-session.test.ts` | one page·401/403/429 monitor |
| `apps/worker/src/reviews/collect-store-reviews.ts` | initial·incremental·fallback·budget collector |
| `apps/worker/src/reviews/collect-store-reviews.test.ts` | backfill·anchor·resume·non-disclosure |
| `apps/worker/src/reviews/run-review-batch.ts` | run invariant·pause·mode count orchestration |
| `apps/worker/src/reviews/run-review-batch.test.ts` | mixed store mode·provider stop·resume |
| `apps/worker/src/reviews/purge-expired-review-data.ts` | fingerprint·sync state 400일 purge |
| `apps/worker/src/reviews/purge-expired-review-data.test.ts` | 30/400일 exact boundary |
| `apps/worker/src/commands/collect-reviews.ts` | expanded ack·budget·resume·same-page pagination |
| `apps/worker/src/commands/collect-reviews.test.ts` | CLI gate·pagination·summary redaction |
| `apps/worker/src/index.ts` | new sync exports |
| `apps/worker/package.json` | guarded expanded live script |
| `package.json` | extension targeted test script |
| `.env.example` | 기존 이름 유지, 새 secret 추가 없음 |
| `scripts/check-workspace-boundaries.ts` | sync module·new run args의 web 참조 차단 |
| `scripts/check-workspace-boundaries.test.ts` | 새 boundary rules |

### New files to create

| Path | Responsibility |
|---|---|
| `packages/raw-db/src/schema/review-sync.ts` | `review_seen_fingerprint`·`review_store_sync_state` |
| `drizzle/raw/0002_review_year_sync.sql` | upgrade migration |
| `drizzle/raw/meta/0002_snapshot.json` | Drizzle raw snapshot |
| `apps/worker/src/reviews/review-sync-state.ts` | ledger·anchor load/upsert·expiry persistence |
| `apps/worker/src/reviews/review-sync-state.test.ts` | 30일 이후 dedupe·anchor·key mismatch |
| `apps/worker/src/reviews/__fixtures__/selector-contract-v2.json` | synthetic v2 pagination contract |

---

### Task 1: Synchronize the Approved Source-of-Truth Boundary

**Files:**
- Modify: `docs/09-decisions/decision-log.md`
- Modify: `docs/superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md`
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`
- Modify: `docs/05-data/data-design.md`
- Modify: `docs/06-trust/policy-review.md`
- Modify: `docs/06-trust/security-design.md`
- Modify: `docs/07-experiments/review-collection-experiment.md`
- Modify: `docs/08-operations/operating-baselines.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: approved extension design
- Produces: DR-036 and one non-conflicting 12-month backfill·incremental boundary

- [ ] **Step 1: Add DR-036 after DR-035**

Add:

```markdown
### DR-036 · Kakao review 최근 12개월 전량 backfill·수동 증분 경계

**상태:** `ACTIVE`, DR-035의 review 개수 상한 확장

Feature 3 `catalog_status='published'` 매장의 공개·비로그인 Kakao review는
run의 고정 as-of date에서 최근 12개월 cutoff까지 최초 backfill한다. 매장당
20건 hard cap은 제거한다. 후속 run은 operator가 수동으로 시작하고 이전 성공
fingerprint anchor와 겹치는 page까지 신규 review를 증분 처리한다. anchor가
사라지면 같은 logical run에서 cutoff까지 backfill fallback한다.

Ciphertext와 temporary locator의 30일 경계는 유지한다. 중복 방지용
store-scoped HMAC fingerprint와 store sync state는 body·nickname 없이
worker-only raw.sqlite에서 최대 400일 보존한다. 60분 실행 예산 도달은
PAUSED_BUDGET이며 성공이 아니다.

Active Playwright page 1개, 3초 고정 page-action 간격, operator 수동 실행과
login·CAPTCHA·401·403·429·access denial·외부 redirect·DOM/order 변경의
provider 전체 즉시 중단을 유지한다. 이 확장은 review 수집·저장 권한을
확인했다는 의미가 아니다.
```

- [ ] **Step 2: Replace every normative 20-review boundary**

In responsibility documents, replace “최근 12개월·최대 20개” with:

```markdown
최초 run은 최근 12개월 cutoff 또는 공개 DOM end까지 개수 상한 없이 처리하고,
후속 run은 이전 성공 anchor와 겹치는 page까지 신규 review를 증분 처리한다.
```

Keep historical implementation plan and GitHub #14 references labeled as the previous 20-review boundary rather than rewriting history.

- [ ] **Step 3: Add exact retention and live gate language**

Document:

```markdown
- encrypted body·temporary locator: 최대 30일
- seen HMAC fingerprint·store sync state·run·checkpoint·audit: 최대 400일
- raw.sqlite backup·snapshot·restore: 금지
- current policy·actual app quota·v2 sanitized selector·worker secrets·
  expanded-volume acknowledgement: live 전 필수
```

- [ ] **Step 4: Verify source-of-truth consistency**

Run:

```powershell
rg -n -S "DR-036|PAUSED_BUDGET|review_seen_fingerprint|review_store_sync_state|20건|최대 20" docs
git diff --check
```

Expected: normative documents point to DR-036; “20건” remains only in historical or superseded context.

- [ ] **Step 5: Commit the document boundary**

```powershell
git add docs/09-decisions/decision-log.md docs/superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md docs/05-data/data-design.md docs/06-trust/policy-review.md docs/06-trust/security-design.md docs/07-experiments/review-collection-experiment.md docs/08-operations/operating-baselines.md docs/10-delivery/development-readiness-checklist.md docs/README.md
git commit -m "docs(review): approve year backfill boundary"
```

---

### Task 2: Extend Public Contracts and Raw Schema

**Files:**
- Modify: `packages/contracts/src/review.ts`
- Modify: `packages/contracts/src/review.test.ts`
- Create: `packages/raw-db/src/schema/review-sync.ts`
- Modify: `packages/raw-db/src/schema/review-runs.ts`
- Modify: `packages/raw-db/src/schema/raw-reviews.ts`
- Modify: `packages/raw-db/src/schema/index.ts`
- Modify: `packages/raw-db/src/index.ts`
- Modify: `packages/raw-db/src/database.test.ts`
- Modify: `packages/raw-db/src/schema/reviews.test.ts`
- Create: `drizzle/raw/0002_review_year_sync.sql`
- Create: `drizzle/raw/meta/0002_snapshot.json`
- Modify: `drizzle/raw/meta/_journal.json`

**Interfaces:**
- Consumes: DR-036 statuses and 30/400-day retention
- Produces: extension summary schemas, `reviewSeenFingerprints`, `reviewStoreSyncStates`, upgraded run invariants

- [ ] **Step 1: Write failing public contract tests**

Add tests that accept:

```ts
expect(reviewCollectionSummarySchema.parse({
  runId: "run_1",
  status: "PAUSED_BUDGET",
  storeCount: 3,
  initialBackfillStoreCount: 1,
  incrementalStoreCount: 2,
  backfillFallbackStoreCount: 0,
  collectedCount: 25,
  duplicateCount: 4,
  rejectedPiiCount: 1,
  failedStoreCount: 0
})).toMatchObject({
  status: "PAUSED_BUDGET",
  collectedCount: 25
});
```

Reject `PAUSED`, negative mode counts, and mode counts whose sum differs from `storeCount`.

- [ ] **Step 2: Run contract tests and confirm failure**

Run:

```powershell
corepack pnpm vitest run packages/contracts/src/review.test.ts
```

Expected: FAIL because new statuses and count fields are absent.

- [ ] **Step 3: Implement exact public schemas**

Use:

```ts
export const reviewCollectionRunStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "PAUSED_OPERATOR",
  "PAUSED_BUDGET",
  "SUCCEEDED",
  "PARTIAL",
  "STOPPED_POLICY",
  "STOPPED_ACCESS",
  "FAILED_FINAL"
]);

export const reviewStoreCollectionModeSchema = z.enum([
  "INITIAL_BACKFILL",
  "INCREMENTAL",
  "BACKFILL_FALLBACK"
]);
```

Add `initialBackfillStoreCount`, `incrementalStoreCount`, and `backfillFallbackStoreCount` to `reviewCollectionSummarySchema`, with a refinement that their sum equals `storeCount`.

- [ ] **Step 4: Write failing raw schema tests**

Assert fresh migration creates:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  "review_seen_fingerprint",
  "review_store_sync_state"
]));
```

Add constraint tests for:

```text
fingerprint length != 32 bytes -> reject
expires_at_ms > last_seen_at_ms -> required
provider != KAKAO_MAP -> reject
duplicate store/provider/key-version/fingerprint -> reject
sync anchor null fields are all null or all present
run as_of_date is YYYY-MM-DD
run budget is 1..28,800,000ms
run status PAUSED is rejected
```

- [ ] **Step 5: Implement `review-sync.ts`**

Define:

```ts
export const reviewSeenFingerprints = sqliteTable(
  "review_seen_fingerprint",
  {
    seenId: text("seen_id").primaryKey(),
    storeId: text("store_id").notNull(),
    provider: text("provider").notNull(),
    fingerprintKeyVersion: text("fingerprint_key_version").notNull(),
    fingerprint: blob("fingerprint", { mode: "buffer" }).notNull(),
    publishedDate: text("published_date").notNull(),
    firstSeenAtMs: integer("first_seen_at_ms").notNull(),
    lastSeenAtMs: integer("last_seen_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_seen_store_provider_key_fingerprint_unique").on(
      table.storeId,
      table.provider,
      table.fingerprintKeyVersion,
      table.fingerprint
    ),
    index("review_seen_expiry_idx").on(table.expiresAtMs),
    check("review_seen_provider_allowed",
      sql`${table.provider} = 'KAKAO_MAP'`),
    check("review_seen_fingerprint_length",
      sql`length(${table.fingerprint}) = 32`),
    check("review_seen_date_format",
      sql`${table.publishedDate} glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("review_seen_times_ordered",
      sql`${table.firstSeenAtMs} <= ${table.lastSeenAtMs}
        and ${table.lastSeenAtMs} < ${table.expiresAtMs}`)
  ]
);
```

Define `reviewStoreSyncStates` with unique `(store_id, provider)`, nullable anchor tuple `(fingerprint, key_version, published_date)`, last successful mode/run/as-of date, completion time, and 400-day expiry. Add a check that the three anchor fields are either all null or all non-null.

- [ ] **Step 6: Extend review run invariants**

Add to `review_collection_run`:

```ts
asOfDate: text("as_of_date").notNull(),
fingerprintKeyVersion: text("fingerprint_key_version").notNull(),
runBudgetMs: integer("run_budget_ms").notNull(),
initialBackfillStoreCount: integer("initial_backfill_store_count")
  .notNull(),
incrementalStoreCount: integer("incremental_store_count").notNull(),
backfillFallbackStoreCount: integer(
  "backfill_fallback_store_count"
).notNull()
```

Replace `PAUSED` with `PAUSED_OPERATOR`, `PAUSED_BUDGET`, and `PARTIAL`. Keep all counts nonnegative and require mode-count sum to equal `store_count`.

Change ciphertext uniqueness to `(store_id, provider, key_version, fingerprint)` so a compromised-key reset is explicit and never silently conflicts with a previous version.

- [ ] **Step 7: Generate and inspect migration**

Run:

```powershell
corepack pnpm exec drizzle-kit generate --name=review_year_sync --config=drizzle/raw.config.ts
```

Expected: `drizzle/raw/0002_review_year_sync.sql` and `0002_snapshot.json`.

Inspect generated SQL and ensure existing rows receive safe migration defaults before new `NOT NULL` checks:

```sql
as_of_date = '1970-01-01'
fingerprint_key_version = 'legacy-feature4'
run_budget_ms = 3600000
initial_backfill_store_count = store_count
incremental_store_count = 0
backfill_fallback_store_count = 0
status = CASE WHEN status = 'PAUSED' THEN 'PAUSED_OPERATOR' ELSE status END
```

No migration may copy ciphertext, locator, fingerprint, or secret into another database.

- [ ] **Step 8: Run contract, migration, schema, and type checks**

```powershell
corepack pnpm vitest run packages/contracts/src/review.test.ts packages/raw-db/src/database.test.ts packages/raw-db/src/schema/reviews.test.ts
corepack pnpm db:check:raw
corepack pnpm --filter @bread-map/contracts typecheck
corepack pnpm --filter @bread-map/raw-db typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit contracts and schema**

```powershell
git add packages/contracts/src/review.ts packages/contracts/src/review.test.ts packages/raw-db/src/schema packages/raw-db/src/index.ts packages/raw-db/src/database.test.ts drizzle/raw
git commit -m "feat(raw-db): add review sync ledger"
```

---

### Task 3: Add Versioned Multi-Page DOM Extraction on One Browser Page

**Files:**
- Modify: `apps/worker/src/reviews/review-dom-contract.ts`
- Modify: `apps/worker/src/reviews/review-dom-contract.test.ts`
- Modify: `apps/worker/src/reviews/extract-review-page.ts`
- Modify: `apps/worker/src/reviews/extract-review-page.test.ts`
- Modify: `apps/worker/src/reviews/browser-session.ts`
- Modify: `apps/worker/src/reviews/browser-session.test.ts`
- Delete: `apps/worker/src/reviews/__fixtures__/selector-contract-v1.json`
- Create: `apps/worker/src/reviews/__fixtures__/selector-contract-v2.json`

**Interfaces:**
- Consumes: one Playwright page and sanitized selector contract
- Produces: v2 pagination contract, ordered page slices, provider response-stop monitor

- [ ] **Step 1: Write failing v2 contract tests**

Require:

```ts
{
  version: "kakao-review-dom-v2",
  paginationMode: "append" | "replace",
  reviewItem: string,
  body: string,
  rating: string,
  publishedDate: string,
  nickname: string,
  nextButton: string,
  loginWall: string,
  captcha: string,
  accessDenial: string
}
```

Reject v1 for expanded live mode, unknown pagination mode, empty selector, network URL, `script`, and `iframe`.

- [ ] **Step 2: Write failing extraction tests**

Cover:

```ts
expect(result).toMatchObject({
  status: "OK",
  boundary: "MORE",
  totalItemCount: 25
});
expect(result.status === "OK" && result.reviews).toHaveLength(25);
```

Also assert:

- no `maxReviews` option exists;
- `startIndex` returns only newly appended items;
- a review older than the calendar cutoff returns `boundary: "CUTOFF"`;
- no next control returns `boundary: "DOM_END"`;
- dates increasing within a page or across `previousOldestPublishedDate` return `DOM_CONTRACT_CHANGED`;
- empty new slice with a next control returns `DOM_CONTRACT_CHANGED`.

- [ ] **Step 3: Run extraction and browser tests to confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.test.ts
```

Expected: FAIL against v1 and the 20-review validation.

- [ ] **Step 4: Implement the extraction result**

Use:

```ts
export interface ExtractReviewPageOptions {
  asOfDate: string;
  startIndex: number;
  previousOldestPublishedDate: string | null;
}

export type ReviewPageResult =
  | {
      status: "OK";
      reviews: MemoryOnlyReview[];
      boundary: "MORE" | "CUTOFF" | "DOM_END";
      totalItemCount: number;
      newestPublishedDate: string | null;
      oldestPublishedDate: string | null;
    }
  | {
      status: "STOP_PROVIDER";
      reasonCode:
        | "LOGIN_REQUIRED"
        | "CAPTCHA"
        | "ACCESS_DENIED"
        | "RATE_LIMITED"
        | "EXTERNAL_REDIRECT"
        | "DOM_CONTRACT_CHANGED";
    };

export type ReviewProviderStopReason =
  Extract<ReviewPageResult, { status: "STOP_PROVIDER" }>["reasonCode"];
```

Parse every new DOM item in order. Verify each timestamp is less than or equal to the previous timestamp. Stop before returning an item older than cutoff. Do not serialize `MemoryOnlyReview`.

- [ ] **Step 5: Add browser response monitoring**

Extend `ReviewBrowserSession`:

```ts
export type BrowserProviderStopReason =
  | "ACCESS_DENIED"
  | "RATE_LIMITED";

export interface ReviewBrowserSession {
  page: BrowserPageLike;
  assertSinglePage(): void;
  providerStopReason(): BrowserProviderStopReason | null;
  close(): Promise<void>;
}
```

Listen to page `response` events. Record `RATE_LIMITED` for 429 and `ACCESS_DENIED` for 401/403. Never record URL, response body, headers, or locator. Keep second-page detection and artifact-free non-persistent context.

- [ ] **Step 6: Replace the synthetic contract with v2**

Create `selector-contract-v2.json` with:

```json
{
  "version": "kakao-review-dom-v2",
  "paginationMode": "append"
}
```

Preserve the existing synthetic selectors, delete the v1 filename, and update all fixture/test references to v2. Do not add any live DOM value.

- [ ] **Step 7: Run focused tests and worker typecheck**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.test.ts
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS without network or browser binary.

- [ ] **Step 8: Commit the browser contract**

```powershell
git add apps/worker/src/reviews/review-dom-contract.ts apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.ts apps/worker/src/reviews/browser-session.test.ts apps/worker/src/reviews/__fixtures__/selector-contract-v1.json apps/worker/src/reviews/__fixtures__/selector-contract-v2.json
git commit -m "feat(worker): paginate reviews on one page"
```

---

### Task 4: Implement the 400-Day Seen Ledger and Store Anchor

**Files:**
- Create: `apps/worker/src/reviews/review-sync-state.ts`
- Create: `apps/worker/src/reviews/review-sync-state.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: raw DB handle, store-scoped fingerprint, current key version
- Produces: dedupe lookup/upsert and stable sync anchor operations

- [ ] **Step 1: Write failing ledger tests**

Test:

```ts
expect(findSeenFingerprint({
  rawDatabase,
  storeId,
  fingerprint,
  keyVersion
})).toBe(false);

recordSeenFingerprint({
  rawDatabase,
  storeId,
  fingerprint,
  keyVersion,
  publishedDate,
  nowMs
});

expect(findSeenFingerprint({
  rawDatabase,
  storeId,
  fingerprint,
  keyVersion
})).toBe(true);
```

Assert a second record updates `last_seen_at_ms` and expiry without creating a row. Assert ciphertext deletion at day 30 does not remove the seen row. Assert key-version mismatch does not match and causes `loadStoreSyncState` to return `KEY_VERSION_MISMATCH`.

- [ ] **Step 2: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-sync-state.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact interfaces**

```ts
export interface SeenFingerprintKey {
  storeId: string;
  fingerprint: Buffer;
  keyVersion: string;
}

export type StoreSyncStateResult =
  | { status: "NONE" }
  | { status: "KEY_VERSION_MISMATCH" }
  | {
      status: "READY";
      anchorFingerprint: Buffer;
      anchorPublishedDate: string;
      lastSuccessfulAsOfDate: string;
      lastSuccessfulRunId: string;
    };

export function findSeenFingerprint(
  input: { rawDatabase: RawDatabaseHandle } & SeenFingerprintKey
): boolean;

export function recordSeenFingerprint(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  fingerprint: Buffer;
  keyVersion: string;
  publishedDate: string;
  nowMs: number;
}): "inserted" | "seen";

export function loadStoreSyncState(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  keyVersion: string;
}): StoreSyncStateResult;

export function persistSuccessfulStoreSync(input: {
  rawDatabase: RawDatabaseHandle;
  storeId: string;
  runId: string;
  mode: "INITIAL_BACKFILL" | "INCREMENTAL" | "BACKFILL_FALLBACK";
  asOfDate: string;
  keyVersion: string;
  anchorFingerprint: Buffer;
  anchorPublishedDate: string;
  completedAtMs: number;
}): void;
```

Use prepared SQL only. Generate stable row IDs from non-reversible SHA-256 of store/provider/key version/fingerprint. Never return or log the ID or fingerprint.

- [ ] **Step 4: Verify 400-day expiry and anchor replacement**

Add tests that exact day 399 23:59:59 remains, day 400 expires, a successful later sync replaces the anchor, and a failed/paused sync does not update the anchor.

- [ ] **Step 5: Run tests and typecheck**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-sync-state.test.ts
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit sync persistence**

```powershell
git add apps/worker/src/reviews/review-sync-state.ts apps/worker/src/reviews/review-sync-state.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): persist review sync anchors"
```

---

### Task 5: Replace the 20-Review Collector with Backfill and Incremental Modes

**Files:**
- Modify: `apps/worker/src/reviews/collect-store-reviews.ts`
- Modify: `apps/worker/src/reviews/collect-store-reviews.test.ts`

**Interfaces:**
- Consumes: ordered page results, review secrets, seen ledger, previous store anchor
- Produces: complete·paused·provider-stop store result with collection mode

- [ ] **Step 1: Write failing initial backfill tests**

Use a fake ordered page source with more than 20 recent records and one record outside cutoff. Assert:

```ts
expect(result).toMatchObject({
  status: "COMPLETE",
  mode: "INITIAL_BACKFILL",
  collectedCount: 25,
  duplicateCount: 0
});
expect(source.readCount()).toBe(3);
```

Assert the outside-cutoff record is never encrypted and the final sync anchor is written only after completion.

- [ ] **Step 2: Write failing incremental tests**

Seed a successful anchor and seen ledger. Return two new records followed by the anchor and only already-seen records for the rest of the page. Assert:

```ts
expect(result).toMatchObject({
  status: "COMPLETE",
  mode: "INCREMENTAL",
  collectedCount: 2
});
```

If a new fingerprint appears after the anchor on the same page, continue until cutoff and return `BACKFILL_FALLBACK`. If the anchor is absent, also finish as `BACKFILL_FALLBACK`.

- [ ] **Step 3: Write failing 30-day dedupe and budget tests**

After purging ciphertext but retaining the ledger, rerun the same logical input and assert `collectedCount: 0`, `duplicateCount > 0`, and ciphertext count remains 0.

Inject `shouldPauseBudget` after a committed page. Assert:

```ts
expect(result.status).toBe("PAUSED_BUDGET");
expect(syncStateWasUpdated()).toBe(false);
expect(lastCheckpointPage()).toBe(2);
```

Resume the same run and assert missing encrypted rows 0 and duplicate encrypted rows 0.

- [ ] **Step 4: Run focused tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/collect-store-reviews.test.ts
```

Expected: FAIL because the collector stops at 20 and has no sync mode.

- [ ] **Step 5: Replace collector interfaces**

Use:

```ts
export type StoreReviewCollectionResult =
  | {
      status: "COMPLETE" | "SKIPPED";
      mode: "INITIAL_BACKFILL" | "INCREMENTAL" | "BACKFILL_FALLBACK";
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    }
  | {
      status: "PAUSED_BUDGET";
      mode: "INITIAL_BACKFILL" | "INCREMENTAL" | "BACKFILL_FALLBACK";
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    }
  | {
      status: "STOP_PROVIDER";
      reasonCode: ReviewProviderStopReason;
      mode: "INITIAL_BACKFILL" | "INCREMENTAL" | "BACKFILL_FALLBACK";
      collectedCount: number;
      duplicateCount: number;
      rejectedPiiCount: number;
    };

export interface CollectStoreReviewsOptions {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  asOfDate: string;
  source: ReviewPageSource;
  secrets: ReviewSecrets;
  shouldPauseBudget?: () => boolean;
  now?: () => number;
  afterRawCommit?: () => void;
}
```

Remove `MAX_REVIEWS_PER_STORE` and `processedCount` as completion controls.

- [ ] **Step 6: Enforce sync-state key compatibility**

Call `loadStoreSyncState` before reading a page. Use `INITIAL_BACKFILL` for `NONE`, `INCREMENTAL` for `READY`, and throw a final integrity error for `KEY_VERSION_MISMATCH`. A key mismatch must activate the existing collection kill-switch path; it must not silently start a new backfill.

- [ ] **Step 7: Reorder protection and ledger persistence**

For each accepted record:

```ts
const fingerprint = fingerprintReview(input, secrets.hmacKey);
raw.nickname = "";

if (findSeenFingerprint({ rawDatabase, storeId, fingerprint,
  keyVersion: secrets.keyVersion })) {
  recordSeenFingerprint({ rawDatabase, storeId, fingerprint,
    keyVersion: secrets.keyVersion, publishedDate, nowMs });
  return "duplicate";
}

const insertResult = persistEncryptedReview(...);
recordSeenFingerprint(...);
persistReviewCheckpoint(...);
```

If a crash occurs after ciphertext commit but before ledger insert, rerun must treat ciphertext conflict as duplicate, create the missing ledger row, and then advance the checkpoint.

- [ ] **Step 8: Implement anchor completion**

Capture the first accepted fingerprint as the new stable anchor. During incremental mode:

- mark the previous anchor when seen;
- finish the current page;
- complete incremental only if every accepted record after the anchor was already seen;
- otherwise set mode to `BACKFILL_FALLBACK` and continue to cutoff or DOM end.

Call `persistSuccessfulStoreSync` only after the store reaches a valid completion boundary. Never update sync state for pause, provider stop, or failure.

- [ ] **Step 9: Run collector, crypto, and type checks**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/collect-store-reviews.test.ts apps/worker/src/reviews/review-sync-state.test.ts apps/worker/src/reviews/encrypt-raw-review.test.ts apps/worker/src/reviews/fingerprint-review.test.ts
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit collector behavior**

```powershell
git add apps/worker/src/reviews/collect-store-reviews.ts apps/worker/src/reviews/collect-store-reviews.test.ts
git commit -m "feat(worker): backfill and sync year reviews"
```

---

### Task 6: Add Budgeted Batch Resume and Guarded Live Pagination

**Files:**
- Modify: `apps/worker/src/reviews/run-review-batch.ts`
- Modify: `apps/worker/src/reviews/run-review-batch.test.ts`
- Modify: `apps/worker/src/commands/collect-reviews.ts`
- Modify: `apps/worker/src/commands/collect-reviews.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `package.json`
- Modify: `scripts/check-workspace-boundaries.ts`
- Modify: `scripts/check-workspace-boundaries.test.ts`

**Interfaces:**
- Consumes: mode-aware collector and v2 browser contract
- Produces: run-level budget pause, resume invariants, same-page pagination, count-only CLI

- [ ] **Step 1: Write failing batch invariant tests**

Create a run with:

```ts
{
  asOfDate: "2026-07-29",
  fingerprintKeyVersion: "key-v1",
  runBudgetMs: 3_600_000
}
```

Assert resume rejects changes to discovery run, catalog snapshot, policy snapshot, selector version, as-of date, key version, and run budget with `REVIEW_RUN_CONFLICT`.

Assert `PAUSED_BUDGET` leaves remaining stores pending, clears `active_slot`, and `finished_at_ms` remains null. Assert `PAUSED_OPERATOR` behaves separately. `SUCCEEDED` requires every target store in `COMPLETE` or `NO_REVIEWS`.

- [ ] **Step 2: Write failing mode-count and provider-stop tests**

Process one initial, one incremental, and one fallback store. Assert summary mode counts are `1/1/1`.

For login, CAPTCHA, 401, 403, 429, access denial, external redirect, DOM/order change, assert later store calls are 0 and final status is `STOPPED_ACCESS` or `STOPPED_POLICY`.

If one store ends `FAILED_STORE` and no provider/global failure occurs, process remaining targets and finish the run as `PARTIAL`, never `SUCCEEDED`.

- [ ] **Step 3: Write failing CLI argument tests**

Require live:

```text
--live
--acknowledge-policy-risk
--acknowledge-expanded-volume-risk
--one-page
--run-budget-minutes 60
```

Allow exactly one of:

```text
new run: no --resume-run
resume: --resume-run <existing run_id>
```

Reject:

- missing expanded acknowledgement;
- budget below 1 or above 480 minutes;
- `--pages`;
- simultaneous `--run-id` and `--resume-run`;
- live v1 selector contract;
- any page-count option.

- [ ] **Step 4: Write failing same-page pagination tests**

Use an injected fake live page and delay function. Verify:

- page 1 uses one `goto`;
- later pages click only `nextButton`;
- exactly one browser page exists;
- delay receives 3,000ms between actions;
- append mode extracts only new items;
- replace mode rejects a repeated transient page signature;
- URL origin after every action remains `https://place.map.kakao.com`;
- response monitor 401/403/429 stops before extraction;
- stdout remains one count-only JSON summary.

- [ ] **Step 5: Run batch and command tests to confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/commands/collect-reviews.test.ts scripts/check-workspace-boundaries.test.ts
```

Expected: FAIL against old `PAUSED`, one-review-page command, and missing ack.

- [ ] **Step 6: Extend batch options**

Use:

```ts
export interface RunReviewBatchOptions {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  discoveryRunId: string;
  catalogSnapshotId: string;
  policySnapshotId: string;
  selectorContractVersion: "kakao-review-dom-v2";
  asOfDate: string;
  runBudgetMs: number;
  secrets: ReviewSecrets;
  now?: () => number;
  shouldPauseOperator?: () => boolean;
  pageSourceFactory?: (
    target: ReviewBatchTarget
  ) => ReviewPageSource;
  collectStoreImpl?: (
    target: ReviewBatchTarget
  ) => Promise<StoreReviewCollectionResult>;
}
```

At invocation start, compute `budgetDeadlineMs = now() + runBudgetMs`. Pass `shouldPauseBudget: () => now() >= budgetDeadlineMs` into the collector. Do not schedule an automatic resume.

Before inserting a new run, load every target's sync state with the current key version and initialize the initial/incremental mode counts so their sum equals `store_count`. When a store returns `BACKFILL_FALLBACK`, decrement incremental and increment fallback in the same run update. If all targets finish but `failedStoreCount > 0`, finalize as `PARTIAL`; reserve `SUCCEEDED` for zero failed stores.

- [ ] **Step 7: Implement same-page live pagination**

Extend the live page test interface with:

```ts
url(): string;
locator(selector: string): ReviewLocatorLike & {
  click(): Promise<void>;
};
```

Create a store-scoped pagination state:

```ts
interface LivePaginationState {
  loadedItemCount: number;
  previousOldestPublishedDate: string | null;
  previousPageSignature: string | null;
  openedLocator: boolean;
}
```

For page 1, call `goto(locator)`. For later pages, verify exactly one next control, wait through injected fixed delay, click once, assert one browser page, verify origin, and then extract.

For `append`, use `startIndex = loadedItemCount`. For `replace`, use `startIndex = 0` and compare an in-memory SHA-256 signature of transient page records. Never persist or log that signature.

- [ ] **Step 8: Update live and fixture commands**

Change worker script:

```json
"smoke:kakao:live": "tsx src/commands/collect-reviews.ts --live --acknowledge-policy-risk --acknowledge-expanded-volume-risk --one-page --run-budget-minutes 60"
```

Keep fixture command network-free. Add root:

```json
"test:reviews:year-sync": "vitest run packages/contracts/src/review.test.ts packages/raw-db/src/schema/reviews.test.ts apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.test.ts apps/worker/src/reviews/review-sync-state.test.ts apps/worker/src/reviews/collect-store-reviews.test.ts apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/reviews/purge-expired-review-data.test.ts apps/worker/src/commands/collect-reviews.test.ts"
```

Update `collect:reviews:fixture` to pass `selector-contract-v2.json`.

- [ ] **Step 9: Extend web boundary checks**

Reject web references to:

```ts
"review_seen_fingerprint",
"review_store_sync_state",
"review-sync-state",
"acknowledge-expanded-volume-risk",
"resume-run"
```

Keep all existing raw path, key, locator, collector, and ciphertext rules.

- [ ] **Step 10: Run command, boundary, and fixture checks**

```powershell
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
corepack pnpm check:boundaries
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS; fixture emits status and counts only.

- [ ] **Step 11: Commit batch and CLI gates**

```powershell
git add apps/worker/src/reviews/run-review-batch.ts apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/commands/collect-reviews.ts apps/worker/src/commands/collect-reviews.test.ts apps/worker/package.json package.json scripts/check-workspace-boundaries.ts scripts/check-workspace-boundaries.test.ts
git commit -m "feat(worker): guard incremental review runs"
```

---

### Task 7: Extend Retention, Delivery Guidance, and Full Verification

**Files:**
- Modify: `apps/worker/src/reviews/purge-expired-review-data.ts`
- Modify: `apps/worker/src/reviews/purge-expired-review-data.test.ts`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/specs/2026-07-29-kakao-review-year-backfill-incremental-design.md`

**Interfaces:**
- Consumes: completed extension implementation
- Produces: exact 30/400-day purge, reproducible fixture gate, live limitation report

- [ ] **Step 1: Write failing exact retention tests**

At fixed time, assert:

```text
29d 23:59:59 ciphertext remains
30d ciphertext is deleted
399d 23:59:59 seen fingerprint and sync state remain
400d seen fingerprint and sync state are deleted
delete audit contains only counts/status/timestamps
deletion failure activates RAW_DELETE_FAILED kill switch
```

Ensure sync-state deletion does not cascade to or restore ciphertext.

- [ ] **Step 2: Run purge tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/purge-expired-review-data.test.ts
```

Expected: FAIL because new tables are not counted or deleted.

- [ ] **Step 3: Extend purge transaction**

Count and delete in this order:

```text
1. expired raw_review_ciphertext
2. expired kakao_place_locator
3. expired review_seen_fingerprint
4. expired review_store_sync_state
5. expired deidentification_failure
6. expired review_checkpoint
7. expired observations with no retained child
```

Keep one raw transaction and existing count-only audit behavior.

- [ ] **Step 4: Document exact fixture and live commands**

Add:

```powershell
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
```

Document the guarded live command without values:

```powershell
corepack pnpm --filter @bread-map/worker smoke:kakao:live
```

Document resume syntax by environment-free argument names only:

```powershell
corepack pnpm --filter @bread-map/worker exec tsx src/commands/collect-reviews.ts --live --acknowledge-policy-risk --acknowledge-expanded-volume-risk --one-page --run-budget-minutes 60 --resume-run <run_id>
```

State that this command remains blocked until current policy, actual app quota, sanitized v2 selector contract, worker-only secrets, and explicit operator approval are confirmed.

- [ ] **Step 5: Mark implementation status accurately**

Update the extension design status to:

```markdown
**상태:** 구현·fixture 검증 완료, live operator gate 미실행
```

Do not mark current policy, actual quota, live selector, credentials, or live success complete unless separately verified.

- [ ] **Step 6: Run targeted and full verification**

```powershell
corepack pnpm test:reviews:feature4
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
corepack pnpm db:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Expected: all commands exit 0 with no live network.

- [ ] **Step 7: Verify non-disclosure and repository cleanliness**

Run the tracked-file assignment scan:

```powershell
$tracked = git ls-files
$tracked | Select-String -Pattern '(^|/)\.env($|\.)' -SimpleMatch
rg -n -S "^(KAKAO_REST_API_KEY|REVIEW_ENCRYPTION_KEY_BASE64|REVIEW_HMAC_KEY_BASE64)=.+$" --glob "!.env.example" --glob "!pnpm-lock.yaml" .
git status --short
git diff --check
```

Expected: no populated secret assignment, no runtime SQLite/browser artifact, and only planned files changed.

Do not print environment values, raw DB rows, review text, nickname, locator, fingerprint, ciphertext, or absolute runtime DB paths while verifying.

- [ ] **Step 8: Commit retention and delivery documentation**

```powershell
git add apps/worker/src/reviews/purge-expired-review-data.ts apps/worker/src/reviews/purge-expired-review-data.test.ts docs/10-delivery/local-development.md docs/10-delivery/development-readiness-checklist.md docs/10-delivery/directory-structure.md docs/README.md docs/superpowers/specs/2026-07-29-kakao-review-year-backfill-incremental-design.md
git commit -m "docs(delivery): verify year review sync"
```

- [ ] **Step 9: Record the live limitation**

Completion report must contain only:

```text
Automated year-backfill and incremental fixtures: status and counts.
Provider run: not started, paused, stopped, or succeeded.
Database scope: worker raw DB only; no raw backup.
Live gate: policy/quota/selector/secret/approval readiness by item name.
Remaining risk: review DOM collection permission remains unconfirmed unless
official API, written permission, or licensed data is supplied.
```

No live success claim is allowed before an actual successful provider run.

---

## Final Verification Matrix

| Requirement | Proving task/check |
|---|---|
| 20건 hard cap 제거 | Task 3 extraction tests, Task 5 collector tests |
| 최근 12개월 calendar cutoff | Task 3 cutoff tests |
| initial full backfill | Task 5 multi-page fixture |
| manual incremental anchor | Task 4 ledger, Task 5 incremental fixture |
| missing anchor fallback | Task 5 fallback fixture |
| 60분 pause·same-run resume | Task 5 collector, Task 6 batch |
| ciphertext purge 뒤 중복 0 | Task 4 ledger, Task 5 dedupe |
| 30/400일 retention | Task 2 schema, Task 7 purge |
| active browser page 1개 | Task 3 browser, Task 6 live adapter |
| 3초 fixed action interval | Task 6 injected-delay test |
| 401·403·429 global stop | Task 3 response monitor, Task 6 batch |
| external redirect·DOM/order stop | Task 3 extraction, Task 6 command |
| published store only | existing Feature 4 target query + Task 6 regression |
| nickname·body·locator·secret non-disclosure | Task 5 DB checks, Task 6 CLI, Task 7 scan |
| web/raw boundary | Task 6 boundary tests |
| CI/live network 0 | Task 6 fixture, Task 7 full suite |
| live readiness separated | Task 1 docs, Task 7 delivery report |
