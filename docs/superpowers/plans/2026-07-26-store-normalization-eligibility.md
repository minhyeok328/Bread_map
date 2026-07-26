# Store Normalization and Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Project `AGENTS.md` makes inline main-agent execution the default; do not dispatch Subagents unless the user explicitly requests delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feature 2의 서울 LOCALDATA staging row를 보수적으로 정규화·중복 판정하고, 검수 근거가 완결된 단일 독립점과 서울 2–5개 직영 브랜드만 고유 `store_id`와 판정 근거를 가진 app catalog로 멱등 게시한다.

**Architecture:** Worker는 `localdata_bakery_record`를 읽어 순수 정규화 함수와 versioned 중복 matcher를 적용한다. FTC·공식 운영 주체·관리자 검수 근거는 명시적 입력 계약으로 받아 eligibility를 판정하고, `admin_review` 결과는 검수 table에 남기되 `PUBLISHED` catalog에는 포함하지 않는다. 후보·match 근거·판정·publish version은 모두 `app.sqlite`의 독립 app migration으로 저장하며 같은 Feature 2 snapshot과 rule version 재실행은 stable ID와 unique constraint/upsert로 row 수를 늘리지 않는다.

**Tech Stack:** Node.js 24.15+ / target 24.18.0, pnpm 11.16.0, TypeScript 6.0.3, Zod 4.4.3, SQLite, better-sqlite3 12.11.1, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, Vitest 4.1.10, `proj4` 2.20.9

## Global Constraints

- 기준은 `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md` Feature 3, DR-002·DR-006·DR-032·DR-033·DR-034와 `docs/README.md`가 지정한 PRD·worker·data·security owner 문서다.
- 단일 독립점과 서울 영업점 2–5개를 모두 직영하는 검수 완료 소규모 브랜드만 적격이다.
- 서울 영업점 6개 이상, franchise 근거, 폐업·휴업·상태 불명, 서울 밖 좌표, CRS·중복·운영 주체 판정 불확실성은 자동 게시하지 않는다.
- FTC 검색 미일치만으로 독립성을 확정하지 않는다. 공식 운영 주체/독립성 근거와 관리자 승인이 없으면 `admin_review`다.
- 주소·좌표·전화·상호 match signal을 모두 구조화해 기록한다. 값이 없을 때도 `available: false`를 기록한다.
- source 원문을 덮어쓰지 않고 normalization, matcher, eligibility version을 판정과 publish row에 기록한다.
- 공개 매장 좌표만 저장한다. 정확한 사용자 위치, 외부 API key, owner name, raw review와 OpenAI 항목은 이 Feature에 들어오지 않는다.
- 자동 test와 CI는 고정 fixture만 사용하고 외부 API key, Docker, live FTC/LOCALDATA 호출을 요구하지 않는다.
- 리뷰 row나 review count는 eligibility/publish의 선행 조건이 아니다.
- Feature 4 Kakao review 원문·암호화, Feature 5 비식별·FTS5, Feature 6 검색·추천은 구현하지 않는다.
- 구현 단계에서는 별도 요청 전 commit과 push를 수행하지 않는다.

## File Map

| 파일 | 책임 |
|---|---|
| `packages/contracts/src/store.ts` | 정규화 후보, match 근거, eligibility 입력·결정, publish summary의 공유 Zod 계약 |
| `packages/contracts/src/store.test.ts` | 허용 enum, 근거 필수성, publish summary 계약 |
| `packages/app-db/src/schema/stores.ts` | bakery/store/source link/match/eligibility/manual review/data publish Drizzle schema |
| `packages/app-db/src/schema/stores.test.ts` | fresh/repeat migration, table/index/CHECK/unique capability |
| `apps/worker/src/catalog/normalize-store.ts` | 주소·전화·상호·EPSG:5174→WGS84 정규화와 서울 좌표 gate |
| `apps/worker/src/catalog/normalize-store.test.ts` | 실패 우선 table-driven 정규화 검증 |
| `apps/worker/src/catalog/deduplicate-stores.ts` | versioned pair signal·score, 자동 병합·검수·분리 |
| `apps/worker/src/catalog/deduplicate-stores.test.ts` | fixture 정답표와 모든 signal 기록 검증 |
| `apps/worker/src/catalog/classify-eligibility.ts` | 단일점/2·5·6 경계, FTC·운영 주체·관리자 검수 판정 |
| `apps/worker/src/catalog/classify-eligibility.test.ts` | eligibility matrix와 FTC 미일치 단독 확정 금지 |
| `apps/worker/src/catalog/publish-catalog.ts` | Feature 2 staging 조회, normalize→dedupe→eligibility→app DB 멱등 게시 |
| `apps/worker/src/catalog/publish-catalog.test.ts` | 같은 staging 재처리, 0-review 게시, admin 차단, 근거·좌표·ID 검증 |
| `packages/testkit/src/store-fixtures.ts` | hand-checked normalization/match/eligibility 정답 fixture |
| `drizzle/app/0002_store_catalog.sql` | app DB 전용 generated migration |
| `docs/10-delivery/*.md` | Feature 3 구현 상태·fixture 검증·live 미검증 경계 |

---

### Task 1: Shared Store Contracts and Fixed Answer Fixtures

**Files:**
- Create: `packages/contracts/src/store.ts`
- Create: `packages/contracts/src/store.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/testkit/src/store-fixtures.ts`
- Modify: `packages/testkit/src/index.ts`
- Modify: `packages/testkit/package.json`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Produces:
  - `NormalizedStoreCandidate`
  - `StoreMatchEvidence`, `StoreMatchCandidate`
  - `CanonicalStoreCandidate`, `DeduplicationResult`
  - `BrandEligibilityEvidence`, `EligibilityDecision`
  - `CatalogPublishSummary`
  - `storeNormalizationCases`, `storeDeduplicationFixture`, `storeEligibilityCases`

- [ ] **Step 1: Write failing contract tests**

Create tests that parse a complete decision and reject incomplete evidence:

```ts
expect(
  eligibilityDecisionSchema.parse({
    bakeryId: "bakery_fixture",
    storeIds: ["store_fixture"],
    classification: "INDEPENDENT_SINGLE",
    status: "eligible",
    reasons: [
      {
        code: "ADMIN_APPROVED",
        evidenceRefs: ["fixture://admin/independent-single"]
      }
    ],
    ruleVersion: "eligibility-v1"
  })
).toMatchObject({ status: "eligible" });

expect(() =>
  storeMatchCandidateSchema.parse({
    leftCandidateId: "left",
    rightCandidateId: "right",
    scoreBasisPoints: 10000,
    status: "auto_merge",
    matcherVersion: "matcher-v1",
    evidence: {
      address: { available: true, matched: true, conflict: false },
      coordinate: { available: true, matched: true, distanceMeters: 0 },
      phone: { available: true, matched: true },
      name: { available: true, matched: true, similarityBasisPoints: 10000 }
    }
  })
).not.toThrow();
```

The production mutation these tests catch is removal of required decision reasons or any of the four match signals.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
corepack pnpm test packages/contracts/src/store.test.ts
```

Expected: FAIL because `./store.js` and the schemas do not exist.

- [ ] **Step 3: Implement the minimal Zod contracts and exports**

Use exact persisted values:

```ts
export const eligibilityClassifications = [
  "INDEPENDENT_SINGLE",
  "DIRECT_ONLY_SMALL_CHAIN",
  "FRANCHISE",
  "CHAIN_TOO_LARGE",
  "UNCERTAIN_REVIEW_REQUIRED"
] as const;

export const eligibilityDecisionStatuses = [
  "eligible",
  "excluded",
  "admin_review"
] as const;

export const matchStatuses = [
  "auto_merge",
  "admin_review",
  "separate"
] as const;
```

Coordinates are signed E7 integers with `crs: "EPSG:4326"`. Match evidence must always contain `address`, `coordinate`, `phone`, and `name`. Eligibility reasons must contain a stable code and at least one non-secret evidence reference when the reason depends on external/operator review. Asserted FTC states except `unavailable` require an FTC evidence ref, and resolved admin states require an admin evidence ref.

- [ ] **Step 4: Add literal fixture answer tables**

The fixture module must contain:

- address aliases/spacing/punctuation and invalid empty input;
- Seoul/local/international phone formats and placeholder rejection;
- legal suffix/branch label name cases;
- EPSG:5174 coordinates with hand-checked WGS84 E7 expected values and missing/invalid pairs;
- auto merge, admin review, separate match rows with literal expected signal values;
- single, 2, 5, 6, FTC-positive, missing-operator-proof, pending-admin and rejected-admin eligibility cases.

Do not calculate expected values by calling production helpers.

- [ ] **Step 5: Run the focused contract test and testkit typecheck**

Run:

```powershell
corepack pnpm test packages/contracts/src/store.test.ts
corepack pnpm --filter @bread-map/testkit typecheck
```

Expected: PASS.

---

### Task 2: Address, Phone, Name and Coordinate Normalization

**Files:**
- Create: `apps/worker/src/catalog/normalize-store.ts`
- Create: `apps/worker/src/catalog/normalize-store.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `LocaldataStagingRow`-equivalent staging values and `NormalizedStoreCandidate`
- Produces:

```ts
normalizeAddress(value: string | null): NormalizedAddress | null
normalizePhone(value: string | null): string | null
normalizeStoreName(value: string): NormalizedStoreName
normalizeCoordinates(x: string | null, y: string | null): NormalizedCoordinates | null
normalizeStore(input: StoreNormalizationInput): StoreNormalizationResult
```

- [ ] **Step 1: Add `proj4@2.20.9` as an exact worker dependency**

Use `pnpm add --filter @bread-map/worker --save-exact proj4@2.20.9`. Do not add `@types/proj4`; the package includes its own declarations. Keep the dependency server/worker-only.

- [ ] **Step 2: Write the mandatory failing table test**

```ts
it.each(storeNormalizationCases.address)(
  "$name",
  ({ input, expected }) => {
    expect(normalizeAddress(input)).toEqual(expected);
  }
);

it.each(storeNormalizationCases.phone)(
  "$name",
  ({ input, expected }) => {
    expect(normalizePhone(input)).toBe(expected);
  }
);

it.each(storeNormalizationCases.name)(
  "$name",
  ({ input, expected }) => {
    expect(normalizeStoreName(input)).toEqual(expected);
  }
);

it.each(storeNormalizationCases.coordinates)(
  "$name",
  ({ x, y, expected }) => {
    expect(normalizeCoordinates(x, y)).toEqual(expected);
  }
);
```

The production mutations caught are wrong Seoul alias handling, dropped phone trunk prefix, branch suffix over-removal and CRS axis/datum mistakes.

- [ ] **Step 3: Run the table test and confirm RED**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/normalize-store.test.ts
```

Expected: FAIL because `normalize-store.ts` does not exist.

- [ ] **Step 4: Implement conservative text normalization**

- Apply Unicode NFKC, trim and collapse whitespace.
- Canonicalize only leading `서울`, `서울시` to `서울특별시`.
- Normalize hyphen variants but do not guess missing address components.
- Normalize Korean phone digits and `+82` trunk prefix; reject invalid length, repeated/placeholder numbers and fixture-redacted values.
- Remove legal entity markers from comparison names and split only explicit whitespace-delimited branch labels such as `본점`, `강남점`; do not strip lexical names such as `제과점` or `빵집`.

- [ ] **Step 5: Implement EPSG:5174 conversion and publish gate**

Register the exact source definition:

```text
+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1
+x_0=200000 +y_0=500000 +ellps=bessel
+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342
+units=m +no_defs
```

Call `proj4(sourceDefinition, "EPSG:4326", [x, y])`, round longitude/latitude to E7 integers, and reject non-finite, partial, or non-Seoul bounding-box output. `normalizeStore` returns `admin_review` reason codes instead of inventing a coordinate.

- [ ] **Step 6: Run RED→GREEN verification**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/normalize-store.test.ts
```

Expected: PASS.

---

### Task 3: Versioned Store Deduplication with Complete Evidence

**Files:**
- Create: `apps/worker/src/catalog/deduplicate-stores.ts`
- Create: `apps/worker/src/catalog/deduplicate-stores.test.ts`

**Interfaces:**
- Consumes: `NormalizedStoreCandidate[]`
- Produces:

```ts
deduplicateStores(
  candidates: readonly NormalizedStoreCandidate[],
  options?: { matcherVersion?: string }
): DeduplicationResult
```

- [ ] **Step 1: Write the failing fixture-answer test**

Assert literal expected pairs and groups:

```ts
const result = deduplicateStores(storeDeduplicationFixture.candidates);

expect(result.matches).toEqual(
  storeDeduplicationFixture.expectedMatches
);
expect(result.stores.map((store) => store.sourceCandidateIds)).toEqual(
  storeDeduplicationFixture.expectedGroups
);
for (const match of result.matches) {
  expect(Object.keys(match.evidence).sort()).toEqual([
    "address",
    "coordinate",
    "name",
    "phone"
  ]);
}
```

The production mutations caught are dropping a signal, changing a threshold, auto-merging on conflicting addresses, treating distant same-brand branches as duplicates, or producing order-dependent groups. Focused cases pin 0.75/0.92 score boundaries, the 50m evidence boundary, the 100m candidate boundary and an address conflict.

- [ ] **Step 2: Run and confirm RED**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/deduplicate-stores.test.ts
```

Expected: FAIL because the matcher does not exist.

- [ ] **Step 3: Implement deterministic evidence and score**

Use integer basis points:

- normalized address exact match: 4,000
- WGS84 distance within 50m: 2,500
- valid normalized phone exact match: 2,000
- normalized name similarity: up to 1,500

Every candidate pair that shares an address, is within 100m, shares a phone, or has name similarity at least 7,500 is recorded. Both present but unequal normalized addresses set `conflict: true`.

Decision:

- score `>= 9,200` and no address/phone conflict: `auto_merge`
- score `>= 7,500` and `< 9,200`, or a conflict plus an exact address/phone or within-50m coordinate signal: `admin_review`
- otherwise: `separate`

Use haversine distance and deterministic source candidate ordering. Only `auto_merge` edges participate in union-find grouping; `admin_review` never merges.

- [ ] **Step 4: Run focused and normalization tests**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/deduplicate-stores.test.ts apps/worker/src/catalog/normalize-store.test.ts
```

Expected: PASS.

---

### Task 4: Eligibility Classification Boundaries

**Files:**
- Create: `apps/worker/src/catalog/classify-eligibility.ts`
- Create: `apps/worker/src/catalog/classify-eligibility.test.ts`

**Interfaces:**
- Consumes:

```ts
interface BrandEligibilityInput {
  bakeryId: string;
  stores: readonly CanonicalStoreCandidate[];
  evidence: BrandEligibilityEvidence;
}
```

- Produces:

```ts
classifyEligibility(input: BrandEligibilityInput): EligibilityDecision
```

- [ ] **Step 1: Write the failing eligibility matrix**

```ts
it.each(storeEligibilityCases)(
  "$name",
  ({ input, expected }) => {
    expect(classifyEligibility(input)).toEqual(expected);
  }
);
```

The literal cases must cover:

- one active Seoul store with independence proof + admin approval → `INDEPENDENT_SINGLE`, `eligible`;
- 2 and 5 stores, no FTC franchise evidence, same-operator proof + admin approval → `DIRECT_ONLY_SMALL_CHAIN`, `eligible`;
- 6 stores → `CHAIN_TOO_LARGE`, `excluded`;
- FTC positive evidence → `FRANCHISE`, `excluded`;
- FTC `not_found` without positive independence/operator proof → `admin_review`;
- FTC unavailable/stale, missing coordinate, unresolved duplicate or pending admin → `admin_review`;
- admin rejection and non-operating store → `excluded`.

- [ ] **Step 2: Run and confirm RED**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/classify-eligibility.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement rule order and complete reasons**

Rule order:

1. confirmed non-operating/out-of-Seoul/admin-rejected exclusion;
2. confirmed FTC franchise exclusion;
3. Seoul store count 6+ exclusion;
4. missing/invalid coordinate, unresolved match, unavailable/stale FTC or pending admin → `admin_review`;
5. single store requires positive independence evidence and admin approval;
6. 2–5 stores require no FTC franchise evidence, same-operator evidence and admin approval;
7. all remaining states → `admin_review`.

Always include count, FTC, operator/independence and admin reason codes. Never turn `ftcStatus: "not_found"` into eligible without the positive/admin reasons.

- [ ] **Step 4: Run focused classifier tests**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/classify-eligibility.test.ts
```

Expected: PASS.

---

### Task 5: App DB Catalog Schema and Independent Migration

**Files:**
- Create: `packages/app-db/src/schema/stores.ts`
- Create: `packages/app-db/src/schema/stores.test.ts`
- Modify: `packages/app-db/src/schema/index.ts`
- Generate: `drizzle/app/0002_store_catalog.sql`
- Generate: `drizzle/app/meta/0002_snapshot.json`
- Modify: `drizzle/app/meta/_journal.json`

**Interfaces:**
- Produces Drizzle exports:
  - `bakeries`
  - `stores`
  - `storeSourceLinks`
  - `matchCandidates`
  - `eligibilityDecisions`
  - `manualReviews`
  - `dataPublishes`

- [ ] **Step 1: Write the failing fresh/repeat migration test**

After applying `drizzle/app` twice, assert the seven table names and these database constraints:

```ts
expect(indexNames).toEqual(
  expect.arrayContaining([
    "store_source_link_source_record_unique",
    "match_candidate_pair_version_unique",
    "eligibility_decision_store_rule_unique",
    "manual_review_target_type_version_unique",
    "data_publish_snapshot_versions_unique"
  ])
);
```

Insert invalid `catalog_status`, invalid latitude E7, duplicate source link and duplicate publish version, and expect SQLite constraint failures. The production mutations caught are missing idempotency uniqueness, invalid coordinates and admin rows accidentally marked published.

- [ ] **Step 2: Run and confirm RED**

Run:

```powershell
corepack pnpm test packages/app-db/src/schema/stores.test.ts
```

Expected: FAIL because the migration lacks store catalog tables.

- [ ] **Step 3: Implement the minimal Drizzle schema**

Persist stable text IDs and UTC epoch millisecond integers. `store` includes public display/normalized fields, nullable E7 coordinates for review candidates, business status and `catalog_status` in `candidate|published|excluded|admin_review`. A CHECK requires coordinates for `published`.

Persist match signals and eligibility reasons as canonical versioned JSON only after contract validation. Keep source links relational and unique. Do not add review, FTS, account, conversation, OpenAI or raw DB fields.

- [ ] **Step 4: Generate only the app migration**

Run:

```powershell
corepack pnpm exec drizzle-kit generate --name=store_catalog --config=drizzle/app.config.ts
```

Confirm no raw migration changes.

- [ ] **Step 5: Run schema and existing app DB tests**

Run:

```powershell
corepack pnpm test packages/app-db/src/schema/stores.test.ts packages/app-db/src/schema/catalog.test.ts packages/app-db/src/database.test.ts
```

Expected: PASS.

---

### Task 6: Idempotent Catalog Publication

**Files:**
- Create: `apps/worker/src/catalog/publish-catalog.ts`
- Create: `apps/worker/src/catalog/publish-catalog.test.ts`

**Interfaces:**
- Consumes:

```ts
interface PublishCatalogOptions {
  appDatabase: AppDatabaseHandle;
  snapshotId: string;
  brandEvidence: readonly BrandEligibilityEvidence[];
  now?: () => number;
}
```

- Produces:

```ts
publishCatalog(options: PublishCatalogOptions): CatalogPublishSummary
```

- [ ] **Step 1: Write the failing Feature 2→Feature 3 integration test**

Use the existing `localdata-seoul.json` client and `runLocaldataIngestion` to create the exact Feature 2 staging input. Then call `publishCatalog` twice with the same snapshot/evidence/version.

Assert:

```ts
expect(second).toEqual(first);
expect(rowCounts).toEqual({
  store: expectedStoreCount,
  sourceLink: expectedSourceLinkCount,
  match: expectedMatchCount,
  decision: expectedDecisionCount,
  manualReview: expectedManualReviewCount,
  publish: 1
});
expect(publishedStores.every(hasUniqueIdSeoulCoordinatesAndDecision)).toBe(
  true
);
expect(adminReviewStoreIds).not.toEqual(
  expect.arrayContaining(publishedStoreIds)
);
```

Do not create review rows. The eligible store assertion therefore proves that review count 0 does not block publication.

The production mutations caught are duplicate rows on replay, missing reasons, unstable IDs, missing coordinates, partial 5-of-6 brand evidence, non-atomic writes, or automatic publication of ambiguous rows. A second changed snapshot with the same management lineage must reuse existing application `store_id` values, and an injected persistence failure must leave every Feature 3 table unchanged.

- [ ] **Step 2: Run and confirm RED**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/publish-catalog.test.ts
```

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement staging read and pure pipeline**

- Read only the requested successful Feature 2 snapshot.
- Convert rows to normalization input without recovering allowlist-rejected `SITE_TEL` or owner fields.
- Apply normalize, deduplicate and classify using explicit brand evidence.
- Generate application IDs with a versioned SHA-256 namespace over canonical internal inputs. On later changed snapshots, reconcile management lineage through existing source links and reuse the enduring application `store_id`; one-to-many or many-to-one identity conflicts go to `admin_review`.
- Expand submitted membership to exact normalized-brand peers before classification so a five-row evidence subset cannot publish five of six apparent Seoul stores.
- Sort all rows by stable ID before persistence.

- [ ] **Step 4: Implement one short app DB transaction with upserts**

- Upsert bakery/store/source link/match/decision/manual review.
- `eligible` sets `catalog_status='published'`.
- `admin_review` sets `catalog_status='admin_review'` and creates/updates an open manual review.
- `excluded` sets `catalog_status='excluded'`.
- Upsert one `data_publish` row for snapshot + normalization + matcher + eligibility versions.
- Return a Zod-validated summary with inserted/published/excluded/admin counts.
- Never query review tables or require a review count.

- [ ] **Step 5: Run the integration and direct unit suite**

Run:

```powershell
corepack pnpm test apps/worker/src/catalog/publish-catalog.test.ts apps/worker/src/catalog/normalize-store.test.ts apps/worker/src/catalog/deduplicate-stores.test.ts apps/worker/src/catalog/classify-eligibility.test.ts
```

Expected: PASS.

---

### Task 7: Package and Delivery Synchronization

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/10-delivery/README.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/technology-stack.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Interfaces:**
- Consumes: implemented Feature 3 files and verification commands
- Produces: current-state docs that distinguish fixture automation from unrun FTC live validation

- [ ] **Step 1: Update current implementation status**

Record Feature 3 normalization, dedupe evidence, eligibility and app publish as implemented. Link this detailed plan from the delivery index and document `proj4@2.20.9` as a worker-only coordinate dependency.

- [ ] **Step 2: Document fixture verification**

Document focused commands:

```powershell
corepack pnpm test apps/worker/src/catalog/normalize-store.test.ts
corepack pnpm test apps/worker/src/catalog/deduplicate-stores.test.ts
corepack pnpm test apps/worker/src/catalog/classify-eligibility.test.ts
corepack pnpm test apps/worker/src/catalog/publish-catalog.test.ts
```

State that the publish integration test ingests the same Feature 2 fixture twice and requires no FTC/LOCALDATA key or Docker.

- [ ] **Step 3: Preserve live-validation honesty**

Mark real FTC brand/cancellation/franchise/direct-store access and real operator/admin evidence as optional, not executed by automated completion. Do not claim live brand coverage or production-ready manual review UI.

- [ ] **Step 4: Run document and diff checks**

Run:

```powershell
rg -n "Feature 3|proj4|admin_review|FTC" docs/README.md docs/10-delivery
git diff --check
```

Expected: no whitespace errors and no scope claim that Feature 4–6 is complete.

---

### Task 8: Final Verification and One Full-Scope Review

**Files:**
- Review all Feature 3 changes

- [ ] **Step 1: Run frozen install and all repository gates**

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm db:check
```

- [ ] **Step 2: Run migration and idempotency-specific gates**

```powershell
corepack pnpm test packages/app-db/src/schema/stores.test.ts
corepack pnpm test apps/worker/src/catalog/publish-catalog.test.ts
```

Confirm `drizzle/raw` has no Feature 3 change and `git diff --check` passes.

- [ ] **Step 3: Review acceptance criteria once**

Inspect the final diff and map each requested gate to a test/query:

- normalization tables;
- all four merge evidence signals and fixture answer table;
- single/2/5 eligible, 6 excluded;
- FTC absence-alone admin review;
- ambiguous not published;
- zero-review eligible publish;
- unique ID, Seoul coordinate and reasons;
- repeat input has no duplicate store/decision/publish row;
- no live key/Docker/OpenAI/Feature 4–6 scope.

- [ ] **Step 4: Report without committing**

Report changed behavior, exact verification results, unrun FTC/LOCALDATA live validation and any remaining data-quality risk. Do not commit or push.

## Plan Self-Review

- **Spec coverage:** Tasks 2–6 cover every Feature 3 master gate; Task 6 directly covers the user’s additional same-staging idempotency and publish-evidence requirements; Task 7 covers package/delivery synchronization.
- **Placeholder scan:** no `TBD`, deferred implementation step, unspecified error handling or “similar to” instruction remains.
- **Type consistency:** normalization produces `NormalizedStoreCandidate`; dedupe produces `CanonicalStoreCandidate`; classification consumes canonical stores and explicit `BrandEligibilityEvidence`; publish persists those exact outputs and returns `CatalogPublishSummary`.
- **Scope check:** review collection/raw encryption, review deidentification/FTS and search/recommendation remain outside this plan.
- **User override:** skill-default commit steps are intentionally omitted because the user explicitly prohibited commit/push without a separate request.
