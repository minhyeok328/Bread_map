# Kakao Bakery Discovery and Review Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 카카오맵 `빵집` 검색 결과 중 `제과,베이커리` 후보를 완전성 상태와 함께 관측하고, Feature 3 적격 매장의 최근 리뷰를 안전하게 비식별·암호화하여 재개 가능한 `raw.sqlite` batch로 저장한다.

**Architecture:** 장소 발견은 Kakao 공식 keyword search API와 서울 tile subdivision으로 수행하고, 동적 리뷰 화면만 worker 전용 Playwright adapter가 읽는다. 모든 외부 응답은 allowlist projection을 거치며, 리뷰는 비식별 → HMAC fingerprint → AES-256-GCM → raw commit → checkpoint 순으로 처리한다. `apps/web`은 raw schema, locator, secret와 collector를 import하지 않는다.

**Tech Stack:** Node.js 24.15.x, TypeScript 6, pnpm 11.16, Zod 4, Drizzle ORM 0.45, better-sqlite3 12.11, Vitest 4, Playwright 1.61

## Global Constraints

- Node.js는 `>=24.15.0 <25`, pnpm은 `11.16.0`을 사용한다.
- 지역은 서울 전역, discovery query는 `빵집`, 정규화 category tag는 정확히 `제과,베이커리`다.
- tag 일치 후보 관측에는 franchise를 포함하지만 review 수집과 서비스 게시 대상은 Feature 3 `catalog_status='published'` 매장뿐이다.
- 장소 발견은 Kakao 공식 keyword search API, 리뷰 수집은 TypeScript Playwright active page 1개만 사용한다.
- review 범위는 매장별 최근 12개월·최대 20개다.
- nickname은 HMAC fingerprint 계산 직후 폐기하고 DB·log·fixture·error에 저장하지 않는다.
- review body는 비식별 성공 뒤에만 AES-256-GCM으로 저장한다.
- raw review와 temporary locator 보존은 최대 30일, allowlist place observation audit 보존은 400일이다.
- active discovery run 1개, active review run 1개, active browser page 1개다.
- login·CAPTCHA·401·403·429·access denial·DOM contract 변경은 provider run 전체를 즉시 중단하며 자동 retry하거나 우회하지 않는다.
- live network smoke는 CI에서 실행하지 않으며 operator가 명시적으로 승인할 때만 한 page로 실행한다.
- `apps/web`은 `@bread-map/raw-db`, `RAW_SQLITE_PATH`, review secret와 collector를 import하거나 참조하지 않는다.
- OpenAI, LangChain, Python, BeautifulSoup과 Selenium dependency를 추가하지 않는다.
- 구현 기준 설계는 `docs/superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md`다.

---

## File Responsibility Map

### Existing files to modify

| Path | Responsibility |
|---|---|
| `docs/09-decisions/decision-log.md` | DR-035로 Kakao allowlist observation과 temporary locator 경계 승인 |
| `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md` | Feature 4/5 구현 경계 동기화 |
| `docs/05-data/data-design.md` | discovery·observation·locator·raw review schema와 retention |
| `docs/06-trust/policy-review.md` | official place API와 browser review 위험 경계 분리 |
| `docs/06-trust/security-design.md` | worker-only Kakao key·locator·nickname non-storage |
| `docs/10-delivery/directory-structure.md` | Feature 4 소유 파일과 import boundary |
| `docs/10-delivery/development-readiness-checklist.md` | live selector contract·secret·one-page gate |
| `docs/10-delivery/local-development.md` | fixture command와 operator-only live command |
| `packages/contracts/src/index.ts` | review contract exports |
| `packages/raw-db/src/schema/index.ts` | discovery·review raw schema exports |
| `packages/raw-db/src/index.ts` | raw schema/repository public exports |
| `packages/raw-db/src/database.test.ts` | raw migration integration coverage |
| `apps/worker/src/index.ts` | discovery·review command/service exports |
| `apps/worker/package.json` | Playwright runtime과 fixture/live scripts |
| `package.json` | Feature 4 targeted test scripts |
| `pnpm-workspace.yaml` | `playwright` catalog version |
| `pnpm-lock.yaml` | resolved worker Playwright dependency |
| `.env.example` | empty worker-only Kakao/review secret names |
| `scripts/check-workspace-boundaries.ts` | web의 review secret·collector 참조 차단 |
| `scripts/check-workspace-boundaries.test.ts` | 새 boundary 규칙 검증 |
| `docs/README.md` | implementation plan과 Feature 4 완료 상태 링크 |

### New files to create

| Path | Responsibility |
|---|---|
| `packages/contracts/src/review.ts` | discovery/review public status·summary Zod schemas |
| `packages/contracts/src/review.test.ts` | contract accept/reject tests |
| `packages/raw-db/src/schema/kakao-discovery.ts` | discovery run·observation·temporary locator tables |
| `packages/raw-db/src/schema/review-runs.ts` | review run·checkpoint·failure·delete audit tables |
| `packages/raw-db/src/schema/raw-reviews.ts` | encrypted review row와 duplicate/crypto checks |
| `packages/raw-db/src/schema/reviews.test.ts` | raw schema constraints·retention integration tests |
| `drizzle/raw/0001_review_collection.sql` | generated raw migration |
| `drizzle/raw/meta/0001_snapshot.json` | generated Drizzle snapshot |
| `apps/worker/src/reviews/kakao-place-client.ts` | official keyword search API adapter |
| `apps/worker/src/reviews/kakao-place-client.test.ts` | auth·response·pagination error tests |
| `apps/worker/src/reviews/normalize-kakao-category.ts` | exact category normalization |
| `apps/worker/src/reviews/normalize-kakao-category.test.ts` | category table tests |
| `apps/worker/src/reviews/seoul-discovery-tiles.ts` | Seoul bounds·subdivision·saturation handling |
| `apps/worker/src/reviews/seoul-discovery-tiles.test.ts` | tile coverage tests |
| `apps/worker/src/reviews/run-kakao-discovery.ts` | API page loop·projection·raw persistence |
| `apps/worker/src/reviews/run-kakao-discovery.test.ts` | complete/partial/idempotent discovery tests |
| `apps/worker/src/reviews/match-kakao-place.ts` | observation→Feature 3 store conservative match |
| `apps/worker/src/reviews/match-kakao-place.test.ts` | eligible/excluded/ambiguous/unmatched tests |
| `apps/worker/src/reviews/deidentify-review.ts` | fail-closed text scrubber |
| `apps/worker/src/reviews/deidentify-review.test.ts` | PII table tests |
| `apps/worker/src/reviews/review-secrets.ts` | base64 key loading·length validation |
| `apps/worker/src/reviews/review-secrets.test.ts` | missing/invalid/valid key tests |
| `apps/worker/src/reviews/fingerprint-review.ts` | store-scoped HMAC canonicalization |
| `apps/worker/src/reviews/fingerprint-review.test.ts` | determinism·store scope tests |
| `apps/worker/src/reviews/encrypt-raw-review.ts` | AES-256-GCM payload encryption/decryption |
| `apps/worker/src/reviews/encrypt-raw-review.test.ts` | nonce·AAD·tamper tests |
| `apps/worker/src/reviews/review-dom-contract.ts` | versioned selector contract loader·validator |
| `apps/worker/src/reviews/review-dom-contract.test.ts` | missing/mismatch contract tests |
| `apps/worker/src/reviews/extract-review-page.ts` | Playwright page→memory-only review records |
| `apps/worker/src/reviews/extract-review-page.test.ts` | synthetic DOM extraction·stop tests |
| `apps/worker/src/reviews/browser-session.ts` | single-page context with artifact capture disabled |
| `apps/worker/src/reviews/browser-session.test.ts` | context option·one-page enforcement tests |
| `apps/worker/src/reviews/__fixtures__/review-page-v1.html` | synthetic non-sensitive review DOM |
| `apps/worker/src/reviews/__fixtures__/selector-contract-v1.json` | synthetic fixture selector contract |
| `apps/worker/src/reviews/collect-store-reviews.ts` | per-store review preparation·raw commit |
| `apps/worker/src/reviews/collect-store-reviews.test.ts` | limit·PII rejection·duplicate tests |
| `apps/worker/src/reviews/run-review-batch.ts` | active run·resume·provider stop orchestration |
| `apps/worker/src/reviews/run-review-batch.test.ts` | crash resume·failed-store·global-stop tests |
| `apps/worker/src/reviews/purge-expired-review-data.ts` | 30/400-day hard delete and audit |
| `apps/worker/src/reviews/purge-expired-review-data.test.ts` | retention boundary tests |
| `apps/worker/src/commands/discover-kakao-bakeries.ts` | fixture/live discovery CLI |
| `apps/worker/src/commands/discover-kakao-bakeries.test.ts` | CLI mode·secret·output tests |
| `apps/worker/src/commands/collect-reviews.ts` | fixture/live review CLI and acknowledgement gate |
| `apps/worker/src/commands/collect-reviews.test.ts` | risk acknowledgement·live isolation tests |
| `apps/worker/src/reviews/__fixtures__/kakao-place-pages.json` | synthetic official API pages |

---

### Task 1: Synchronize Feature 4 Source-of-Truth Documents

**Files:**
- Modify: `docs/09-decisions/decision-log.md`
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`
- Modify: `docs/05-data/data-design.md`
- Modify: `docs/06-trust/policy-review.md`
- Modify: `docs/06-trust/security-design.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md`
- Produces: one non-conflicting Feature 4 boundary used by every later task

- [ ] **Step 1: Add the approved decision**

Add this decision after DR-034:

```markdown
### DR-035 · Kakao 빵집 발견과 review 수집 경계

**상태:** `ACTIVE`, DR-007·DR-027·DR-034 확장

서울 Kakao keyword search의 `빵집` 결과 중 마지막 category segment가
정규화 후 정확히 `제과,베이커리`인 장소를 franchise 포함 후보 관측으로
수집한다. Kakao place ID와 locator는 worker-only `raw.sqlite`에서 review
navigation·resume에 필요한 동안만 보존하며 permanent catalog identity로
사용하지 않는다. 장소 관측 allowlist는 400일, locator와 encrypted review는
최대 30일 보존한다.

Review 수집은 Feature 3 `catalog_status='published'` 매장에만 수행하고 최근
12개월·최대 20개로 제한한다. Nickname은 HMAC fingerprint 계산 직후
폐기한다. 장소 발견은 공식 API, 동적 review는 local Playwright 1 page로
수행하며 login·CAPTCHA·401·403·429·access denial·DOM 변경을 우회하지 않는다.
```

- [ ] **Step 2: Update Feature 4 and Feature 5 ownership**

In the local MVP master plan, add discovery and minimum deidentification/HMAC to Feature 4. Change Feature 5 so it starts at `app.sqlite` review publish and FTS5:

```markdown
Feature 4 완료 기준: 서울 discovery coverage가 COMPLETE이고, 적격 매장 review
batch를 재개해도 encrypted raw duplicate가 0이며 nickname·평문 저장이 0이다.

Feature 5 입력: Feature 4의 decrypt 가능한 비식별 payload·store_id·rating·date.
Feature 5 책임: app review publish, FTS5, review version과 삭제·검색 일관성.
```

- [ ] **Step 3: Update data and security tables**

Add exact raw tables and retention:

```markdown
| `kakao_discovery_run` | query·region·category·coverage·count | 400일 |
| `kakao_place_observation` | allowlist 장소 field·match state | 400일 |
| `kakao_place_locator` | temporary place ID/URL locator | run 완료 또는 30일 |
| `review_collection_run` | policy·snapshot·status·count | 400일 |
| `review_checkpoint` | store·page·last fingerprint·state | 400일 |
| `raw_review_ciphertext` | ciphertext·nonce·tag·fingerprint | 30일 |
```

State that `KAKAO_REST_API_KEY`, locator, nickname, ciphertext and fingerprint are forbidden in web/log output.

- [ ] **Step 4: Update directory and readiness checklists**

List the files from this plan’s File Responsibility Map and require:

```markdown
- [ ] current Kakao REST quota·response contract 확인
- [ ] `KAKAO_REST_API_KEY` worker-only 주입
- [ ] encryption·HMAC 32-byte key 분리 주입
- [ ] sanitized selector contract version 확인
- [ ] one-page operator live acknowledgement
```

- [ ] **Step 5: Verify document consistency**

Run:

```powershell
rg -n -S "Feature 4|DR-035|KAKAO_REST_API_KEY|제과,베이커리|nickname" docs
git diff --check
```

Expected: DR-035 and Feature 4/5 boundaries agree; no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git add docs/09-decisions/decision-log.md docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md docs/05-data/data-design.md docs/06-trust/policy-review.md docs/06-trust/security-design.md docs/10-delivery/directory-structure.md docs/10-delivery/development-readiness-checklist.md
git commit -m "docs(feature4): align Kakao collection boundaries"
```

---

### Task 2: Define Public Discovery and Review Contracts

**Files:**
- Create: `packages/contracts/src/review.ts`
- Create: `packages/contracts/src/review.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: DR-035 statuses and limits
- Produces: `kakaoDiscoverySummarySchema`, `reviewCollectionSummarySchema`, `KakaoDiscoverySummary`, `ReviewCollectionSummary`

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  kakaoDiscoverySummarySchema,
  reviewCollectionSummarySchema
} from "./review.js";

describe("Feature 4 contracts", () => {
  it("accepts non-sensitive summaries", () => {
    expect(kakaoDiscoverySummarySchema.parse({
      runId: "discovery_1",
      status: "COMPLETE",
      observedCount: 10,
      matchedEligibleCount: 4,
      matchedExcludedCount: 3,
      unmatchedCount: 2,
      ambiguousCount: 1
    })).toMatchObject({ status: "COMPLETE", observedCount: 10 });

    expect(reviewCollectionSummarySchema.parse({
      runId: "reviews_1",
      status: "SUCCEEDED",
      storeCount: 4,
      collectedCount: 20,
      duplicateCount: 2,
      rejectedPiiCount: 1,
      failedStoreCount: 0
    })).toMatchObject({ collectedCount: 20 });
  });

  it("rejects negative counts and unknown states", () => {
    expect(() => kakaoDiscoverySummarySchema.parse({
      runId: "x",
      status: "DONE",
      observedCount: -1,
      matchedEligibleCount: 0,
      matchedExcludedCount: 0,
      unmatchedCount: 0,
      ambiguousCount: 0
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```powershell
corepack pnpm vitest run packages/contracts/src/review.test.ts
```

Expected: FAIL because `review.ts` does not exist.

- [ ] **Step 3: Implement exact status and summary schemas**

```ts
import { z } from "zod";

const countSchema = z.number().int().nonnegative();

export const kakaoDiscoveryRunStatusSchema = z.enum([
  "READY", "RUNNING", "COMPLETE", "PARTIAL",
  "STOPPED_POLICY", "STOPPED_ACCESS", "FAILED_FINAL"
]);

export const kakaoPlaceObservationStatusSchema = z.enum([
  "MATCHED_ELIGIBLE", "MATCHED_EXCLUDED", "UNMATCHED",
  "AMBIGUOUS", "CATEGORY_REJECTED"
]);

export const reviewCollectionRunStatusSchema = z.enum([
  "READY", "RUNNING", "PAUSED", "SUCCEEDED",
  "STOPPED_POLICY", "STOPPED_ACCESS", "FAILED_FINAL"
]);

export const kakaoDiscoverySummarySchema = z.object({
  runId: z.string().min(1),
  status: kakaoDiscoveryRunStatusSchema,
  observedCount: countSchema,
  matchedEligibleCount: countSchema,
  matchedExcludedCount: countSchema,
  unmatchedCount: countSchema,
  ambiguousCount: countSchema
});

export const reviewCollectionSummarySchema = z.object({
  runId: z.string().min(1),
  status: reviewCollectionRunStatusSchema,
  storeCount: countSchema,
  collectedCount: countSchema,
  duplicateCount: countSchema,
  rejectedPiiCount: countSchema,
  failedStoreCount: countSchema
});

export type KakaoDiscoverySummary =
  z.infer<typeof kakaoDiscoverySummarySchema>;
export type ReviewCollectionSummary =
  z.infer<typeof reviewCollectionSummarySchema>;
```

Export the new module from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contract tests and typecheck**

```powershell
corepack pnpm vitest run packages/contracts/src/review.test.ts
corepack pnpm --filter @bread-map/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/review.ts packages/contracts/src/review.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add review collection contracts"
```

---

### Task 3: Add Raw Discovery and Encrypted Review Schema

**Files:**
- Create: `packages/raw-db/src/schema/kakao-discovery.ts`
- Create: `packages/raw-db/src/schema/review-runs.ts`
- Create: `packages/raw-db/src/schema/raw-reviews.ts`
- Create: `packages/raw-db/src/schema/reviews.test.ts`
- Modify: `packages/raw-db/src/schema/index.ts`
- Modify: `packages/raw-db/src/index.ts`
- Modify: `packages/raw-db/src/database.test.ts`
- Create: `drizzle/raw/0001_review_collection.sql`
- Create: `drizzle/raw/meta/0001_snapshot.json`
- Modify: `drizzle/raw/meta/_journal.json`

**Interfaces:**
- Consumes: status strings from Task 2
- Produces: `kakaoDiscoveryRuns`, `kakaoPlaceObservations`, `kakaoPlaceLocators`, `reviewCollectionRuns`, `reviewCheckpoints`, `rawReviewCiphertexts`, `deidentificationFailures`, `rawDeleteAudits`

- [ ] **Step 1: Write failing schema integration tests**

Create a migrated temporary raw DB and assert:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  "kakao_discovery_run",
  "kakao_place_observation",
  "kakao_place_locator",
  "review_collection_run",
  "review_checkpoint",
  "raw_review_ciphertext",
  "deidentification_failure",
  "raw_delete_audit"
]));
```

Add constraint tests:

```ts
expect(() => insertSecondActiveDiscoveryRun()).toThrow();
expect(() => insertNonceWithElevenBytes()).toThrow();
expect(() => insertTagWithFifteenBytes()).toThrow();
expect(() => insertFingerprintWithThirtyOneBytes()).toThrow();
expect(() => insertDuplicateStoreFingerprint()).toThrow();
```

- [ ] **Step 2: Run the schema test and confirm failure**

```powershell
corepack pnpm vitest run packages/raw-db/src/schema/reviews.test.ts
```

Expected: FAIL because Feature 4 tables do not exist.

- [ ] **Step 3: Implement discovery tables**

Use an `active_slot` nullable integer with a unique index; application code sets it to `1` only while status is `RUNNING`.

```ts
export const kakaoDiscoveryRuns = sqliteTable(
  "kakao_discovery_run",
  {
    runId: text("run_id").primaryKey(),
    query: text("query").notNull(),
    regionCode: text("region_code").notNull(),
    categoryTag: text("category_tag").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
    expiresAtMs: integer("expires_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("kakao_discovery_active_slot_unique").on(table.activeSlot),
    check("kakao_discovery_active_slot_allowed",
      sql`${table.activeSlot} is null or ${table.activeSlot} = 1`)
  ]
);
```

`kakao_place_observation` stores `observation_key BLOB(32)`, allowlist place fields, match status, nullable `matched_store_id`, valid JSON signals, observed time and 400-day expiry. `kakao_place_locator` stores one locator per observation with a delete deadline no later than 30 days.

- [ ] **Step 4: Implement review run and encrypted row tables**

`raw_review_ciphertext` must include:

```ts
{
  reviewId: text("review_id").primaryKey(),
  runId: text("run_id").notNull(),
  observationId: text("observation_id").notNull(),
  storeId: text("store_id").notNull(),
  provider: text("provider").notNull(),
  ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
  nonce: blob("nonce", { mode: "buffer" }).notNull(),
  authTag: blob("auth_tag", { mode: "buffer" }).notNull(),
  keyVersion: text("key_version").notNull(),
  aadVersion: text("aad_version").notNull(),
  fingerprint: blob("fingerprint", { mode: "buffer" }).notNull(),
  collectedAtMs: integer("collected_at_ms").notNull(),
  retentionUntilMs: integer("retention_until_ms").notNull()
}
```

Add checks for nonce 12 bytes, tag 16 bytes, fingerprint 32 bytes, positive retention, and unique `(store_id, provider, fingerprint)`.

- [ ] **Step 5: Export schemas and generate migration**

```powershell
corepack pnpm exec drizzle-kit generate --name=review_collection --config=drizzle/raw.config.ts
```

Expected: `drizzle/raw/0001_review_collection.sql` and matching metadata are generated.

- [ ] **Step 6: Run schema and migration checks**

```powershell
corepack pnpm vitest run packages/raw-db/src/database.test.ts packages/raw-db/src/schema/reviews.test.ts
corepack pnpm db:check:raw
corepack pnpm --filter @bread-map/raw-db typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/raw-db/src packages/raw-db/src/schema drizzle/raw
git commit -m "feat(raw-db): add review collection schema"
```

---

### Task 4: Implement Kakao Place Discovery Primitives

**Files:**
- Create: `apps/worker/src/reviews/kakao-place-client.ts`
- Create: `apps/worker/src/reviews/kakao-place-client.test.ts`
- Create: `apps/worker/src/reviews/normalize-kakao-category.ts`
- Create: `apps/worker/src/reviews/normalize-kakao-category.test.ts`
- Create: `apps/worker/src/reviews/seoul-discovery-tiles.ts`
- Create: `apps/worker/src/reviews/seoul-discovery-tiles.test.ts`
- Create: `apps/worker/src/reviews/__fixtures__/kakao-place-pages.json`

**Interfaces:**
- Consumes: Kakao REST API key through constructor injection
- Produces: `KakaoPlaceClient.searchPage()`, `normalizeKakaoCategoryTag()`, `createSeoulRootTile()`, `splitDiscoveryTile()`

- [ ] **Step 1: Write category table tests**

```ts
it.each([
  ["음식점 > 간식 > 제과,베이커리", "제과,베이커리"],
  ["음식점>간식>제과, 베이커리", "제과,베이커리"],
  ["카페 > 디저트카페", "디저트카페"]
])("normalizes the last category segment", (input, expected) => {
  expect(normalizeKakaoCategoryTag(input)).toBe(expected);
});

expect(isApprovedBakeryTag("제과,베이커리")).toBe(true);
expect(isApprovedBakeryTag("제과,베이커리,카페")).toBe(false);
```

- [ ] **Step 2: Write API client failure tests**

Use injected `fetchImpl` and verify:

```ts
expect(request.headers.get("Authorization"))
  .toBe("KakaoAK fixture-rest-key");
expect(request.url).toContain("query=%EB%B9%B5%EC%A7%91");
expect(request.url).toContain("page=1");
expect(request.url).toContain("size=15");
```

Reject non-2xx, invalid JSON, documents over size 15, mismatched page metadata and response bodies with unknown required field types using non-sensitive error codes.

- [ ] **Step 3: Write tile subdivision tests**

Use exact root bounds consistent with current store constraints:

```ts
export const SEOUL_DISCOVERY_BOUNDS = {
  minLongitude: 126.7,
  minLatitude: 37.4,
  maxLongitude: 127.3,
  maxLatitude: 37.75
} as const;
```

Assert four child tiles cover the parent without gaps and depth 8 saturation returns `DISCOVERY_TILE_SATURATED` instead of recursing forever.

- [ ] **Step 4: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/normalize-kakao-category.test.ts apps/worker/src/reviews/kakao-place-client.test.ts apps/worker/src/reviews/seoul-discovery-tiles.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement the typed API adapter**

```ts
export interface DiscoveryRect {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
}

export interface KakaoPlaceDocument {
  id: string;
  place_name: string;
  category_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
}

export interface KakaoPlacePage {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: KakaoPlaceDocument[];
}

export interface CreateKakaoPlaceClientOptions {
  restApiKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface KakaoPlaceClient {
  searchPage(input: {
    query: "빵집";
    rect: DiscoveryRect;
    page: number;
    size: 15;
  }): Promise<KakaoPlacePage>;
}

export function createKakaoPlaceClient({
  restApiKey,
  fetchImpl = fetch,
  endpoint = "https://dapi.kakao.com/v2/local/search/keyword.json"
}: CreateKakaoPlaceClientOptions): KakaoPlaceClient;
```

Keep Kakao `id` and `place_url` in the worker-internal page type. Do not include them in log event or public summary types.

- [ ] **Step 6: Implement category and tile functions**

```ts
export function normalizeKakaoCategoryTag(value: string): string {
  const last = value.normalize("NFKC").split(">").at(-1) ?? "";
  return last.trim().replace(/\s*,\s*/g, ",");
}

export function isApprovedBakeryTag(value: string): boolean {
  return normalizeKakaoCategoryTag(value) === "제과,베이커리";
}
```

Split saturated tiles at longitude/latitude midpoints. Stop at depth 8 with a typed final error.

- [ ] **Step 7: Run targeted tests**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/normalize-kakao-category.test.ts apps/worker/src/reviews/kakao-place-client.test.ts apps/worker/src/reviews/seoul-discovery-tiles.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/worker/src/reviews/kakao-place-client.ts apps/worker/src/reviews/kakao-place-client.test.ts apps/worker/src/reviews/normalize-kakao-category.ts apps/worker/src/reviews/normalize-kakao-category.test.ts apps/worker/src/reviews/seoul-discovery-tiles.ts apps/worker/src/reviews/seoul-discovery-tiles.test.ts apps/worker/src/reviews/__fixtures__/kakao-place-pages.json
git commit -m "feat(worker): add Kakao bakery discovery primitives"
```

---

### Task 5: Persist Discovery Coverage and Match Feature 3 Stores

**Files:**
- Create: `apps/worker/src/reviews/run-kakao-discovery.ts`
- Create: `apps/worker/src/reviews/run-kakao-discovery.test.ts`
- Create: `apps/worker/src/reviews/match-kakao-place.ts`
- Create: `apps/worker/src/reviews/match-kakao-place.test.ts`

**Interfaces:**
- Consumes: Task 3 raw tables, Task 4 `KakaoPlaceClient`, existing Feature 3 `store` rows
- Produces: `runKakaoDiscovery(options): Promise<KakaoDiscoverySummary>`, `matchKakaoObservation(observation, stores): KakaoPlaceMatch`

- [ ] **Step 1: Write conservative matching tests**

Auto-match only a unique candidate satisfying:

```ts
const addressExact =
  observation.normalizedAddress === store.normalizedAddress;
const nameExact =
  observation.normalizedName === store.normalizedName;
const phoneExact =
  observation.normalizedPhone !== null &&
  observation.normalizedPhone === store.normalizedPhone;
const coordinateClose =
  distanceMetersE7(observation, store) <= 75;

const autoMatch =
  addressExact && nameExact && (phoneExact || coordinateClose);
```

Implement `distanceMetersE7()` with the Haversine formula:

```ts
export function distanceMetersE7(
  left: { latitudeE7: number; longitudeE7: number },
  right: { latitudeE7: number; longitudeE7: number }
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = left.latitudeE7 / 10_000_000;
  const rightLat = right.latitudeE7 / 10_000_000;
  const deltaLat = toRadians(rightLat - leftLat);
  const deltaLon = toRadians(
    right.longitudeE7 / 10_000_000 -
    left.longitudeE7 / 10_000_000
  );
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(leftLat)) *
    Math.cos(toRadians(rightLat)) *
    Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

Return one of these exact shapes:

```ts
export type KakaoPlaceMatch =
  | {
      status: "MATCHED_ELIGIBLE" | "MATCHED_EXCLUDED";
      storeId: string;
      signals: {
        addressExact: true;
        nameExact: true;
        phoneExact: boolean;
        coordinateDistanceMeters: number;
      };
    }
  | {
      status: "AMBIGUOUS" | "UNMATCHED";
      storeId: null;
      signals: {
        candidateCount: number;
        reasonCode:
          | "MULTIPLE_STRONG_MATCHES"
          | "PHONE_CONFLICT"
          | "INSUFFICIENT_SIGNALS";
      };
    };
```

Tests must cover:

- unique published match → `MATCHED_ELIGIBLE`
- unique excluded match → `MATCHED_EXCLUDED`
- two qualifying matches → `AMBIGUOUS`
- partial signals only → `UNMATCHED`
- phone conflict despite close coordinates → `AMBIGUOUS`

- [ ] **Step 2: Write discovery integration tests**

Seed an app DB with one published and one excluded store. Use synthetic API pages with duplicate Kakao IDs across overlapping tiles. Assert:

```ts
expect(summary).toMatchObject({
  status: "COMPLETE",
  observedCount: 4,
  matchedEligibleCount: 1,
  matchedExcludedCount: 1,
  unmatchedCount: 1,
  ambiguousCount: 1
});
```

Verify:

- duplicate transient Kakao IDs create one observation
- `observation_key` is derived from normalized allowlist fields, not raw response JSON
- full response JSON and API key are absent from DB and log events
- saturated depth-8 tile finishes `PARTIAL`
- rerunning the same run input does not duplicate observations

- [ ] **Step 3: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/match-kakao-place.test.ts apps/worker/src/reviews/run-kakao-discovery.test.ts
```

Expected: FAIL because match and discovery runners do not exist.

- [ ] **Step 4: Implement observation projection**

Use:

```ts
export interface ProjectedKakaoObservation {
  observationKey: Buffer;
  displayName: string;
  normalizedName: string;
  categoryName: string;
  categoryTag: "제과,베이커리";
  roadAddress: string | null;
  lotAddress: string | null;
  normalizedAddress: string;
  phone: string | null;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
  locator: string;
}
```

Build `observationKey` as SHA-256 over canonical normalized name, address, phone and E7 coordinates. Store `locator` only in `kakao_place_locator`.

- [ ] **Step 5: Implement page loop and coverage finalization**

Persist a discovery run with `active_slot=1`, process leaf tiles sequentially, and set:

- `COMPLETE` only when every leaf reaches `is_end=true`
- `PARTIAL` on saturation or recoverable incomplete coverage
- `STOPPED_ACCESS` on 401/403/429
- `FAILED_FINAL` on schema or SQLite integrity errors

Always clear `active_slot` when leaving `RUNNING`.

- [ ] **Step 6: Run targeted tests**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/match-kakao-place.test.ts apps/worker/src/reviews/run-kakao-discovery.test.ts
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/worker/src/reviews/run-kakao-discovery.ts apps/worker/src/reviews/run-kakao-discovery.test.ts apps/worker/src/reviews/match-kakao-place.ts apps/worker/src/reviews/match-kakao-place.test.ts
git commit -m "feat(worker): persist Kakao bakery discovery"
```

---

### Task 6: Implement Fail-Closed Deidentification, HMAC, and AES-GCM

**Files:**
- Create: `apps/worker/src/reviews/deidentify-review.ts`
- Create: `apps/worker/src/reviews/deidentify-review.test.ts`
- Create: `apps/worker/src/reviews/review-secrets.ts`
- Create: `apps/worker/src/reviews/review-secrets.test.ts`
- Create: `apps/worker/src/reviews/fingerprint-review.ts`
- Create: `apps/worker/src/reviews/fingerprint-review.test.ts`
- Create: `apps/worker/src/reviews/encrypt-raw-review.ts`
- Create: `apps/worker/src/reviews/encrypt-raw-review.test.ts`

**Interfaces:**
- Consumes: memory-only raw review fields
- Produces: `deidentifyReview()`, `loadReviewSecrets()`, `fingerprintReview()`, `encryptRawReview()`, `decryptRawReview()`

- [ ] **Step 1: Write deidentification table tests**

```ts
it.each([
  ["문의는 test@example.com", "문의는 [redacted]"],
  ["전화 010-1234-5678", "전화 [redacted]"],
  ["https://example.com 방문", "[redacted] 방문"],
  ["인스타 @bakery_user", "인스타 [redacted]"]
])("redacts direct identifiers", (input, expected) => {
  expect(deidentifyReview(input)).toEqual({
    accepted: true,
    text: expected
  });
});

it.each([
  "직원 김민수님이 제 병원 진단을 이야기했어요",
  "계좌번호와 카드번호가 그대로 적혀 있어요",
  "사장 박지영씨와 고소 분쟁 중입니다"
])("rejects sensitive or unsafe identity context", (input) => {
  expect(deidentifyReview(input)).toEqual({
    accepted: false,
    reasonCode: "REJECTED_PII"
  });
});
```

- [ ] **Step 2: Write secret, HMAC, and encryption tests**

Assert:

- missing or non-base64 keys throw `REVIEW_SECRET_INVALID`
- decoded keys not exactly 32 bytes throw
- same canonical input/key produces same 32-byte fingerprint
- changing `storeId` changes fingerprint
- encrypting the same payload twice produces different 12-byte nonces
- tampering ciphertext, tag, AAD or key throws `REVIEW_DECRYPT_FAILED`
- encrypted result contains no `nickname` or plaintext field

- [ ] **Step 3: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/deidentify-review.test.ts apps/worker/src/reviews/review-secrets.test.ts apps/worker/src/reviews/fingerprint-review.test.ts apps/worker/src/reviews/encrypt-raw-review.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement fail-closed scrubber**

Normalize NFKC and whitespace, then apply explicit URL, email, Korean/international phone, account handle and long identifier patterns. Reject when the remaining text contains a named-person pattern with sensitive context:

```ts
const namedPersonPattern =
  /(?:사장|직원|알바|손님)\s*[가-힣]{2,4}(?:씨|님)/u;
const sensitiveContextPattern =
  /주민등록|계좌번호|카드번호|병원|진단|약물|성폭력|고소|분쟁|신고/u;
```

Return only accepted deidentified text or a non-sensitive reason code.

```ts
export type DeidentifiedReview =
  | { accepted: true; text: string }
  | { accepted: false; reasonCode: "REJECTED_PII" | "REJECTED_EMPTY" };

export function deidentifyReview(body: string): DeidentifiedReview;
```

- [ ] **Step 5: Implement exact key loading**

```ts
export interface ReviewSecrets {
  encryptionKey: Buffer;
  hmacKey: Buffer;
  keyVersion: string;
}

export function loadReviewSecrets(
  env: Record<string, string | undefined>
): ReviewSecrets;
```

Read `REVIEW_ENCRYPTION_KEY_BASE64`, `REVIEW_HMAC_KEY_BASE64`, and `REVIEW_KEY_VERSION`. Reject equal key material.

- [ ] **Step 6: Implement HMAC and AES-GCM**

Use Node `createHmac`, `createCipheriv`, `createDecipheriv` and `randomBytes`. The encrypted JSON payload is:

```ts
export interface FingerprintReviewInput {
  provider: "KAKAO_MAP";
  storeId: string;
  normalizedNickname: string;
  publishedDate: string;
  normalizedDeidentifiedText: string;
}

export function fingerprintReview(
  input: FingerprintReviewInput,
  hmacKey: Buffer
): Buffer;

export interface EncryptedReviewPayloadV1 {
  schemaVersion: 1;
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  provider: "KAKAO_MAP";
}

export interface ReviewAadV1 {
  reviewId: string;
  storeId: string;
  provider: "KAKAO_MAP";
  schemaVersion: 1;
}

export interface EncryptedRawReview {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
  aadVersion: "review-aad-v1";
}

export function normalizeNickname(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function encryptRawReview(
  payload: EncryptedReviewPayloadV1,
  aad: ReviewAadV1,
  encryptionKey: Buffer,
  keyVersion: string
): EncryptedRawReview;

export function decryptRawReview(
  encrypted: EncryptedRawReview,
  aad: ReviewAadV1,
  encryptionKey: Buffer
): EncryptedReviewPayloadV1;

export function createReviewId(
  storeId: string,
  fingerprint: Buffer
): string {
  return `review_${createHash("sha256")
    .update(storeId)
    .update(fingerprint)
    .digest("hex")
    .slice(0, 24)}`;
}
```

AAD canonical JSON contains `reviewId`, `storeId`, `provider`, `schemaVersion`.

- [ ] **Step 7: Run targeted tests**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/deidentify-review.test.ts apps/worker/src/reviews/review-secrets.test.ts apps/worker/src/reviews/fingerprint-review.test.ts apps/worker/src/reviews/encrypt-raw-review.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/worker/src/reviews/deidentify-review.ts apps/worker/src/reviews/deidentify-review.test.ts apps/worker/src/reviews/review-secrets.ts apps/worker/src/reviews/review-secrets.test.ts apps/worker/src/reviews/fingerprint-review.ts apps/worker/src/reviews/fingerprint-review.test.ts apps/worker/src/reviews/encrypt-raw-review.ts apps/worker/src/reviews/encrypt-raw-review.test.ts
git commit -m "feat(worker): protect collected review data"
```

---

### Task 7: Add Versioned Review DOM Contract and One-Page Browser Adapter

**Files:**
- Create: `apps/worker/src/reviews/review-dom-contract.ts`
- Create: `apps/worker/src/reviews/review-dom-contract.test.ts`
- Create: `apps/worker/src/reviews/extract-review-page.ts`
- Create: `apps/worker/src/reviews/extract-review-page.test.ts`
- Create: `apps/worker/src/reviews/browser-session.ts`
- Create: `apps/worker/src/reviews/browser-session.test.ts`
- Create: `apps/worker/src/reviews/__fixtures__/review-page-v1.html`
- Create: `apps/worker/src/reviews/__fixtures__/selector-contract-v1.json`

**Interfaces:**
- Consumes: worker-only place locator and a validated selector contract
- Produces: `loadReviewDomContract()`, `extractReviewPage()`, `openReviewBrowserSession()`

- [ ] **Step 1: Define and test the selector contract schema**

The JSON contract has no live data:

```json
{
  "version": "kakao-review-dom-v1",
  "reviewItem": "[data-bread-map-review-item]",
  "body": "[data-bread-map-review-body]",
  "rating": "[data-bread-map-review-rating]",
  "publishedDate": "[data-bread-map-review-date]",
  "nickname": "[data-bread-map-review-nickname]",
  "nextButton": "[data-bread-map-review-next]",
  "loginWall": "[data-bread-map-login-wall]",
  "captcha": "[data-bread-map-captcha]",
  "accessDenial": "[data-bread-map-access-denial]"
}
```

Tests reject missing selectors, empty strings, unknown version and selectors containing `script`, `iframe` or network URL text.

- [ ] **Step 2: Write synthetic browser extraction tests**

The synthetic fixture contains 21 reviews with fictional text, ratings, ISO dates and nicknames. Assert:

- extracted memory records contain body/rating/date/nickname
- result stops at 20 accepted records
- a 13-month-old review stops the store
- login wall, CAPTCHA and access-denial fixtures return provider stop codes
- missing review item/body/date returns `DOM_CONTRACT_CHANGED`
- no screenshot, trace, video or HAR path is created

- [ ] **Step 3: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.test.ts
```

Expected: FAIL because browser modules do not exist.

- [ ] **Step 4: Implement contract loading**

```ts
export interface ReviewDomContract {
  version: "kakao-review-dom-v1";
  reviewItem: string;
  body: string;
  rating: string;
  publishedDate: string;
  nickname: string;
  nextButton: string;
  loginWall: string;
  captcha: string;
  accessDenial: string;
}

export function loadReviewDomContract(path: string): Promise<ReviewDomContract>;
```

The live command requires `KAKAO_REVIEW_SELECTOR_CONTRACT_PATH`; fixture mode uses the repository synthetic contract. A contract mismatch stops before collecting or storing a review.

- [ ] **Step 5: Implement a single-page browser session**

```ts
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
```

Expose only one `page`, reject a second page event with `BROWSER_PAGE_LIMIT_EXCEEDED`, and close context/browser in `finally`. Do not enable trace, screenshot, persistent context, stealth plugin, proxy or custom user-agent rotation.

- [ ] **Step 6: Implement page extraction**

Return:

```ts
export interface MemoryOnlyReview {
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  nickname: string;
}

export type ReviewPageResult =
  | { status: "OK"; reviews: MemoryOnlyReview[]; hasNext: boolean }
  | { status: "STOP_PROVIDER"; reasonCode:
      "LOGIN_REQUIRED" | "CAPTCHA" | "ACCESS_DENIED" | "DOM_CONTRACT_CHANGED" };
```

Do not export `MemoryOnlyReview` from `packages/contracts` or serialize it in command output.

- [ ] **Step 7: Run browser fixture tests**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.test.ts
```

Expected: PASS without network access.

- [ ] **Step 8: Commit**

```powershell
git add apps/worker/src/reviews/review-dom-contract.ts apps/worker/src/reviews/review-dom-contract.test.ts apps/worker/src/reviews/extract-review-page.ts apps/worker/src/reviews/extract-review-page.test.ts apps/worker/src/reviews/browser-session.ts apps/worker/src/reviews/browser-session.test.ts apps/worker/src/reviews/__fixtures__/review-page-v1.html apps/worker/src/reviews/__fixtures__/selector-contract-v1.json
git commit -m "feat(worker): add safe review browser adapter"
```

---

### Task 8: Implement Idempotent Store Collection, Batch Resume, and Purge

**Files:**
- Create: `apps/worker/src/reviews/collect-store-reviews.ts`
- Create: `apps/worker/src/reviews/collect-store-reviews.test.ts`
- Create: `apps/worker/src/reviews/run-review-batch.ts`
- Create: `apps/worker/src/reviews/run-review-batch.test.ts`
- Create: `apps/worker/src/reviews/purge-expired-review-data.ts`
- Create: `apps/worker/src/reviews/purge-expired-review-data.test.ts`

**Interfaces:**
- Consumes: `MATCHED_ELIGIBLE` observations, memory review source, Task 6 crypto, Task 3 raw tables
- Produces: `collectStoreReviews()`, `runReviewBatch()`, `purgeExpiredReviewData()`

- [ ] **Step 1: Write per-store pipeline tests**

Use a fake page source and fixed clock. Assert:

```ts
expect(result).toEqual({
  status: "COMPLETE",
  collectedCount: 2,
  duplicateCount: 1,
  rejectedPiiCount: 1
});
```

Verify raw rows contain ciphertext only, nickname does not appear in any SQLite text/blob interpreted as UTF-8, rejected PII body creates only a reason-code row, and review 21 is never requested after 20 accepted rows.

- [ ] **Step 2: Write crash and resume tests**

Inject a failure after raw insert but before checkpoint. Rerun the same run and assert:

- duplicate fingerprint row remains 1
- checkpoint advances exactly once
- missing review count is 0
- completed store is skipped
- `FAILED_STORE` parse failure continues to next store
- `CAPTCHA` or `ACCESS_DENIED` stops the entire run and leaves later stores pending

- [ ] **Step 3: Write retention tests**

At exact boundaries:

- 29 days 23:59:59 review/locator remain
- 30 days review/locator are deleted
- 399 days 23:59:59 observation remains
- 400 days observation is deleted
- delete audit stores counts/status only
- deletion failure returns `FAILED_FINAL` and activates kill-switch state

- [ ] **Step 4: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/collect-store-reviews.test.ts apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/reviews/purge-expired-review-data.test.ts
```

Expected: FAIL because orchestration modules do not exist.

- [ ] **Step 5: Implement store collection**

For each memory review:

```ts
const deidentified = deidentifyReview(raw.body);
if (!deidentified.accepted) {
  persistDeidentificationFailure({
    rawDatabase,
    runId,
    observationId,
    storeId,
    reasonCode: deidentified.reasonCode,
    occurredAtMs: nowMs
  });
  continue;
}
const fingerprint = fingerprintReview({
  provider: "KAKAO_MAP",
  storeId,
  normalizedNickname: normalizeNickname(raw.nickname),
  publishedDate: raw.publishedDate,
  normalizedDeidentifiedText: deidentified.text
}, secrets.hmacKey);
raw.nickname = "";
const reviewId = createReviewId(storeId, fingerprint);
const payload: EncryptedReviewPayloadV1 = {
  schemaVersion: 1,
  body: deidentified.text,
  ratingBasisPoints: raw.ratingBasisPoints,
  publishedDate: raw.publishedDate,
  provider: "KAKAO_MAP"
};
const aad: ReviewAadV1 = {
  reviewId,
  storeId,
  provider: "KAKAO_MAP",
  schemaVersion: 1
};
const encrypted = encryptRawReview(
  payload,
  aad,
  secrets.encryptionKey,
  secrets.keyVersion
);
const insertResult = persistEncryptedReview({
  rawDatabase,
  reviewId,
  runId,
  observationId,
  storeId,
  encrypted,
  fingerprint,
  collectedAtMs: nowMs,
  retentionUntilMs: nowMs + 30 * 24 * 60 * 60 * 1000
});
afterRawCommit?.();
persistReviewCheckpoint({
  rawDatabase,
  runId,
  observationId,
  storeId,
  pageCursor,
  fingerprint,
  insertResult,
  committedAtMs: nowMs
});
```

Never include `raw` or nickname in thrown errors or logger events.

Use these repository return values:

```ts
type EncryptedReviewInsertResult = "inserted" | "duplicate";

interface PersistEncryptedReviewInput {
  rawDatabase: RawDatabaseHandle;
  reviewId: string;
  runId: string;
  observationId: string;
  storeId: string;
  encrypted: EncryptedRawReview;
  fingerprint: Buffer;
  collectedAtMs: number;
  retentionUntilMs: number;
}

interface PersistDeidentificationFailureInput {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  reasonCode: "REJECTED_PII" | "REJECTED_EMPTY";
  occurredAtMs: number;
}

interface PersistReviewCheckpointInput {
  rawDatabase: RawDatabaseHandle;
  runId: string;
  observationId: string;
  storeId: string;
  pageCursor: string;
  fingerprint: Buffer;
  insertResult: EncryptedReviewInsertResult;
  committedAtMs: number;
}

function persistEncryptedReview(
  input: PersistEncryptedReviewInput
): EncryptedReviewInsertResult;

function persistDeidentificationFailure(
  input: PersistDeidentificationFailureInput
): void;

function persistReviewCheckpoint(
  input: PersistReviewCheckpointInput
): void;
```

`persistEncryptedReview` commits before `persistReviewCheckpoint`. The optional
test-only `afterRawCommit` hook simulates a crash between those commits and is
never wired by production commands.

- [ ] **Step 6: Implement batch state machine**

Start one `review_collection_run` with `active_slot=1`. Process only observations with `MATCHED_ELIGIBLE`. Apply:

- store parse/data error → `FAILED_STORE`, continue
- provider stop → run `STOPPED_ACCESS` or `STOPPED_POLICY`, stop
- raw/crypto integrity error → `FAILED_FINAL`, stop
- operator pause → `PAUSED`, clear active slot
- all targets final → `SUCCEEDED`, clear active slot

- [ ] **Step 7: Implement purge in one raw transaction**

Delete expired ciphertext and locators first, then expired observations with no retained child. Write `raw_delete_audit` with attempted/deleted/failed counts and no row content.

- [ ] **Step 8: Run targeted integration tests**

```powershell
corepack pnpm vitest run apps/worker/src/reviews/collect-store-reviews.test.ts apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/reviews/purge-expired-review-data.test.ts
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add apps/worker/src/reviews/collect-store-reviews.ts apps/worker/src/reviews/collect-store-reviews.test.ts apps/worker/src/reviews/run-review-batch.ts apps/worker/src/reviews/run-review-batch.test.ts apps/worker/src/reviews/purge-expired-review-data.ts apps/worker/src/reviews/purge-expired-review-data.test.ts
git commit -m "feat(worker): orchestrate encrypted review batches"
```

---

### Task 9: Add Fixture/Live Commands, Dependencies, and Boundary Gates

**Files:**
- Create: `apps/worker/src/commands/discover-kakao-bakeries.ts`
- Create: `apps/worker/src/commands/discover-kakao-bakeries.test.ts`
- Create: `apps/worker/src/commands/collect-reviews.ts`
- Create: `apps/worker/src/commands/collect-reviews.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/package.json`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `scripts/check-workspace-boundaries.ts`
- Modify: `scripts/check-workspace-boundaries.test.ts`

**Interfaces:**
- Consumes: all Feature 4 services
- Produces: deterministic fixture commands and explicit operator-only live commands

- [ ] **Step 1: Write CLI mode tests**

Discovery command rules:

```text
--fixture apps/worker/src/reviews/__fixtures__/kakao-place-pages.json  XOR  --live
--live requires KAKAO_REST_API_KEY and REVIEW_POLICY_SNAPSHOT_ID
```

Review command rules:

```text
--fixture apps/worker/src/reviews/__fixtures__/review-page-v1.html
  --selector-contract apps/worker/src/reviews/__fixtures__/selector-contract-v1.json
OR
--live --acknowledge-policy-risk --one-page
```

Reject `--live` without exact acknowledgement, multiple modes, missing selector contract, or attempts to set page count over 1 for smoke. Assert stdout contains summary JSON only and never environment values, locator, nickname or review body.

- [ ] **Step 2: Write boundary tests**

Extend forbidden web runtime references:

```ts
const forbiddenWebRuntimeReferences = [
  "RAW_SQLITE_PATH",
  "raw.sqlite",
  "KAKAO_REST_API_KEY",
  "REVIEW_ENCRYPTION_KEY_BASE64",
  "REVIEW_HMAC_KEY_BASE64",
  "collect-reviews",
  "run-review-batch"
] as const;
```

Assert web source containing any one value is rejected.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
corepack pnpm vitest run apps/worker/src/commands/discover-kakao-bakeries.test.ts apps/worker/src/commands/collect-reviews.test.ts scripts/check-workspace-boundaries.test.ts
```

Expected: FAIL because commands and new boundary entries do not exist.

- [ ] **Step 4: Add the direct Playwright runtime dependency**

Add to `pnpm-workspace.yaml` catalog:

```yaml
playwright: 1.61.1
```

Add to `apps/worker/package.json` dependencies:

```json
"playwright": "catalog:"
```

Run:

```powershell
corepack pnpm install
```

Expected: lockfile records worker’s direct `playwright` dependency without adding Selenium or Python packages.

- [ ] **Step 5: Implement commands and scripts**

Add worker scripts:

```json
"discover:kakao:fixture": "tsx src/commands/discover-kakao-bakeries.ts --fixture src/reviews/__fixtures__/kakao-place-pages.json",
"collect:reviews:fixture": "tsx src/commands/collect-reviews.ts --fixture src/reviews/__fixtures__/review-page-v1.html --selector-contract src/reviews/__fixtures__/selector-contract-v1.json",
"smoke:kakao:live": "tsx src/commands/collect-reviews.ts --live --acknowledge-policy-risk --one-page"
```

Add root targeted script:

```json
"test:reviews:feature4": "vitest run packages/contracts/src/review.test.ts packages/raw-db/src/schema/reviews.test.ts apps/worker/src/reviews apps/worker/src/commands/discover-kakao-bakeries.test.ts apps/worker/src/commands/collect-reviews.test.ts"
```

- [ ] **Step 6: Add empty environment names**

```dotenv
# Worker-only Kakao discovery and review collection
KAKAO_REST_API_KEY=
REVIEW_POLICY_SNAPSHOT_ID=
REVIEW_ENCRYPTION_KEY_BASE64=
REVIEW_HMAC_KEY_BASE64=
REVIEW_KEY_VERSION=
KAKAO_REVIEW_SELECTOR_CONTRACT_PATH=
```

Do not generate or write secret values.

- [ ] **Step 7: Run command and boundary tests**

```powershell
corepack pnpm vitest run apps/worker/src/commands/discover-kakao-bakeries.test.ts apps/worker/src/commands/collect-reviews.test.ts scripts/check-workspace-boundaries.test.ts
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
corepack pnpm check:boundaries
```

Expected: PASS; fixture command emits only counts/status.

- [ ] **Step 8: Commit**

```powershell
git add apps/worker/src/commands apps/worker/src/index.ts apps/worker/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml .env.example scripts/check-workspace-boundaries.ts scripts/check-workspace-boundaries.test.ts
git commit -m "feat(worker): add guarded review collection commands"
```

---

### Task 10: Run Full Verification and Publish Delivery Documentation

**Files:**
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: all Feature 4 implementation and tests
- Produces: verified fixture workflow, documented live gate, final Feature 4 status

- [ ] **Step 1: Run the targeted Feature 4 suite**

```powershell
corepack pnpm test:reviews:feature4
```

Expected: all contract, raw schema, discovery, matching, privacy, browser fixture, resume, purge and CLI tests pass.

- [ ] **Step 2: Run migration and package verification**

```powershell
corepack pnpm db:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the complete regression suite**

```powershell
corepack pnpm test
```

Expected: Feature 1–4 tests pass with no live network call.

- [ ] **Step 4: Verify fixture commands and non-disclosure**

```powershell
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
```

Expected: summary JSON contains status and counts only.

Search generated output and tracked files:

```powershell
rg -n -S "REVIEW_ENCRYPTION_KEY_BASE64=.+|REVIEW_HMAC_KEY_BASE64=.+|KAKAO_REST_API_KEY=.+" . --glob "!pnpm-lock.yaml" --glob "!.env.example"
```

Expected: no matches.

- [ ] **Step 5: Document exact fixture and live commands**

In `local-development.md`, separate:

```markdown
### 자동 fixture 검증

corepack pnpm test:reviews:feature4
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture

### 사용자 승인 one-page live smoke

필수 secret와 sanitized selector contract를 local environment에 주입한 뒤:

corepack pnpm --filter @bread-map/worker smoke:kakao:live

이 명령은 CI·일반 web·cron에서 실행하지 않는다.
```

- [ ] **Step 6: Update readiness and completion status**

Mark automated Feature 4 gates complete only for checks actually run. Leave current policy review, live selector contract and one-page operator smoke unchecked unless the operator completed them. Update `docs/README.md` application progress to:

```markdown
Feature 1 SQLite foundation, Feature 2 서울 source 적재, Feature 3 catalog,
Feature 4 Kakao 장소 발견·암호화 review fixture pipeline 구현 완료.
Live Kakao smoke는 operator gate로 별도 관리.
```

- [ ] **Step 7: Inspect the complete Feature 4 diff**

```powershell
git status --short
git diff --check
git diff --stat HEAD~9..HEAD
git log --oneline -10
```

Expected: only Feature 4 files and documentation changed; no runtime SQLite, browser artifact, `.env`, review body or nickname is tracked.

- [ ] **Step 8: Commit delivery documentation**

```powershell
git add docs/10-delivery/local-development.md docs/10-delivery/development-readiness-checklist.md docs/10-delivery/directory-structure.md docs/README.md
git commit -m "docs(delivery): document Feature 4 verification"
```

- [ ] **Step 9: Record the live-smoke limitation**

If the operator did not provide local keys and a verified selector contract, completion reporting must say:

```text
Automated fixture, migration, typecheck, lint, build and regression checks pass.
Live Kakao one-page smoke was not run because operator-only credentials and the
current sanitized DOM selector contract were not supplied. No live-access claim
is made.
```

Do not treat this unrun external check as an automated test failure.

---

## Final Verification Matrix

| Requirement | Proving task/check |
|---|---|
| 서울 `빵집` + exact `제과,베이커리` | Task 4 category/tile tests, Task 5 discovery integration |
| franchise 포함 후보 관측 | Task 5 summary counts |
| Feature 3 published only review collection | Task 5 match tests, Task 8 batch target query |
| 최근 12개월·20개 | Task 7 extraction, Task 8 store pipeline |
| nickname non-storage | Task 6 result shape, Task 8 DB/log scan |
| PII fail-closed | Task 6 table tests, Task 8 rejection persistence |
| AES-256-GCM·unique nonce·AAD | Task 6 crypto tests, Task 3 DB checks |
| duplicate 0·resume | Task 3 unique index, Task 8 crash test |
| one page·no artifacts | Task 7 browser tests |
| access/policy global stop | Task 7 stop detection, Task 8 batch tests |
| 30/400-day retention | Task 8 purge tests |
| web/raw boundary | Task 9 boundary tests |
| CI network 0 | Task 9 fixture commands, Task 10 full suite |
| responsibility docs aligned | Task 1 |
