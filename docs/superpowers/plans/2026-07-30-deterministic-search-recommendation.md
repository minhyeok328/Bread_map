# Deterministic Search and Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task.
> Every behavior change follows strict RED-GREEN-REFACTOR.

**Goal:** Deliver a version-checked, deterministic SQLite search and
recommendation service that applies verified hard filters before review
evidence and returns stable public reasons without an external model or
paid service.

**Architecture:** The app database owns the active catalog pointer and
verified search facts. Retrieval loads a version-consistent candidate
snapshot and optional Feature 5 FTS evidence. Recommendation remains a
pure package that normalizes, derives, filters, ranks, and explains
candidate facts.

**Tech Stack:** Node.js 24.15.0, pnpm 11.16.0, TypeScript 6.0.3,
better-sqlite3 12.11.1, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10,
SQLite FTS5, Zod 4.4.3, Vitest 4.1.10

## Global Constraints

- Follow
  `docs/superpowers/specs/2026-07-30-deterministic-search-recommendation-design.md`.
- The active catalog version comes only from
  `catalog_publish_state`; never infer it from wall-clock publish order.
- `dataSnapshotVersion` is an opaque hash over the active catalog
  identity and canonical candidate facts, active verified-evidence
  batch, and consistent active review/FTS corpus.
- Source freshness uses the source snapshot basis date in Asia/Seoul,
  not the catalog row update timestamp.
- Request origin exists only in validated process memory and must not
  appear in results, errors, reports, or logs.
- Hard exclusions execute before ranking and cannot be restored by
  FTS, review counts, completeness, or ratings.
- No numeric relevance score, FTS rank, adjusted rating, or request
  origin may enter the public contract.
- Missing or inconsistent FTS returns a truthful partial result and no
  fabricated evidence.
- Candidate, verified-evidence, review aggregate, and FTS reads run in
  one SQLite read transaction.
- Exact distance is process-local. Public results expose only a
  250-meter upper-bound bucket.
- Fixture evaluation proves deterministic implementation behavior only;
  it does not claim live-source or independent-human quality.
- No external API, OpenAI call, browser session, Docker, or paid service
  is required.
- After the full Feature gate passes, use `commit-workflow` to inspect
  every changed file, create detailed logical conventional commits,
  and push the verified series directly to `origin/main`.

## File Map

### Create

- `packages/contracts/src/search.ts`
- `packages/contracts/src/search.test.ts`
- `packages/app-db/src/schema/search-evidence.ts`
- `packages/app-db/src/schema/search-evidence.test.ts`
- `apps/worker/src/search-evidence/publish-search-evidence.ts`
- `apps/worker/src/search-evidence/publish-search-evidence.test.ts`
- `apps/worker/src/commands/publish-search-evidence.ts`
- `drizzle/app/0004_search_evidence.sql`
- `drizzle/app/meta/0004_snapshot.json`
- `packages/recommendation/src/search-types.ts`
- `packages/recommendation/src/normalize-query.ts`
- `packages/recommendation/src/normalize-query.test.ts`
- `packages/recommendation/src/derive-candidate.ts`
- `packages/recommendation/src/derive-candidate.test.ts`
- `packages/recommendation/src/filter-candidates.ts`
- `packages/recommendation/src/filter-candidates.test.ts`
- `packages/recommendation/src/rank-candidates.ts`
- `packages/recommendation/src/rank-candidates.test.ts`
- `packages/recommendation/src/explain-result.ts`
- `packages/recommendation/src/explain-result.test.ts`
- `packages/retrieval/src/store-search-repository.ts`
- `packages/retrieval/src/sqlite-store-search-repository.ts`
- `packages/retrieval/src/sqlite-store-search-repository.test.ts`
- `packages/retrieval/src/execute-store-search.ts`
- `packages/retrieval/src/execute-store-search.test.ts`
- `packages/testkit/src/search-scenarios.ts`
- `packages/retrieval/src/search-evaluation.ts`
- `packages/retrieval/src/search-evaluation.test.ts`

### Modify

- `packages/contracts/src/index.ts`
- `packages/app-db/src/schema/index.ts`
- `drizzle/app/meta/_journal.json`
- `apps/worker/src/catalog/publish-catalog.ts`
- `apps/worker/src/catalog/publish-catalog.test.ts`
- `packages/recommendation/src/index.ts`
- `packages/retrieval/package.json`
- `packages/retrieval/src/review-repository.ts`
- `packages/retrieval/src/sqlite-review-repository.ts`
- `packages/retrieval/src/sqlite-review-repository.test.ts`
- `packages/retrieval/src/index.ts`
- `packages/testkit/src/index.ts`
- `package.json`
- `scripts/check-workspace-boundaries.ts`
- `scripts/check-workspace-boundaries.test.ts`
- authoritative product, recommendation, architecture, data, decision,
  and delivery documents affected by Feature 6

---

### Task 1: Strict structured-search contract

**Produces:**

- version constants for contract, recommendation, aliases, evidence,
  rating prior, and composite search data
- closed enums for menu categories, filters, sorting, public reasons,
  warnings, relaxation options, and safe errors
- `structuredSearchInputSchema`
- `structuredSearchResultSchema`
- `parseStructuredSearchInput`

- [x] **Step 1: Write failing contract tests**

Cover one valid full request plus unknown keys, blank/overlong text,
duplicate/conflicting categories, distance without origin, distance
sort without origin, invalid E7 coordinates, unsafe version strings,
wrong recommendation version, and accidental internal result fields.

- [x] **Step 2: Run the focused test and confirm RED**

```powershell
pnpm exec vitest run packages/contracts/src/search.test.ts
```

Expected: import or assertion failure because `search.ts` does not
exist.

- [x] **Step 3: Implement schemas and public types**

Use strict Zod objects and cross-field `superRefine`. Result metadata
must include safe component version IDs and `sourceBasisDate`; items
must expose `distanceUpperBoundM`, and reject `origin`, `distanceM`,
`internalRank`, `completeness`, `adjustedRating`, and `score`.

- [x] **Step 4: Run the focused test and confirm GREEN**

---

### Task 2: Verified search schema and active catalog state

**Produces:**

- `searchEvidencePublishes`, `menus`, `storeAliases`, `menuAliases`,
  `storeBusinessHours`
- `catalogPublishStates`
- database checks and indexes from the approved design
- a fresh/install migration and deterministic existing-data backfill
- stale catalog replay protection

- [x] **Step 1: Write failing real-database migration tests**

Assert the six new tables, unique/index/check constraints, restrictive
foreign keys, fixed active slots, valid minute ranges, immutable
evidence/source requirements, active-publish-scoped menu uniqueness,
and migration backfill from existing successful publishes.

- [x] **Step 2: Write failing publisher tests**

Prove:

1. first successful publish creates the singleton state;
2. a newer `(basis date, download time, snapshot ID)` tuple advances it
   transactionally;
3. an older total-order tuple throws `CATALOG_SOURCE_STALE` before
   store mutations;
4. replaying the same snapshot/version is idempotent;
5. a failed transaction preserves the prior active state;
6. a store absent from the new snapshot is demoted, excluded from
   active membership, and has public reviews purged;
7. evidence tied to the prior catalog is superseded.

- [x] **Step 3: Run both focused tests and confirm RED**

```powershell
pnpm exec vitest run packages/app-db/src/schema/search-evidence.test.ts apps/worker/src/catalog/publish-catalog.test.ts
```

- [x] **Step 4: Implement schema, generate migration, and review SQL**

Run:

```powershell
pnpm exec drizzle-kit generate --name=search_evidence --config=drizzle/app.config.ts
```

Add an idempotent backfill statement after generated DDL. Select the
winning successful publish by source basis date descending, source
download time descending, snapshot ID descending, publish time
descending, then publish ID ascending.

- [x] **Step 5: Update publisher transaction**

Load and validate the incoming source basis date, download time, and
snapshot ID; compare the total-order tuple to the active state before
calculating/persisting changes. Demote stores outside the incoming
snapshot, clean up bakery state, supersede evidence for the old
catalog, and upsert the singleton after `data_publish` inside the same
transaction.

- [x] **Step 6: Write failing strict local evidence-publisher tests**

Cover unknown JSON keys, wrong active catalog, missing/non-member store,
duplicate normalized menu/alias, bad evidence/source/category,
overlapping hours including overnight carry, canonical checksum and
ID, atomic active-slot swap, immutable replay, and rollback.

- [x] **Step 7: Implement local evidence publication and command**

The command accepts one explicitly named JSON path, prints only safe
counts/version IDs, and performs no network access. Evidence rows carry
their immutable publish ID and repository reads join only the active
batch targeting the active catalog.

- [x] **Step 8: Run focused tests and `pnpm db:check`; confirm GREEN**

---

### Task 3: Pure normalization and candidate derivation

**Produces:**

- stable NFKC/Korean-lowercase/space/compact normalization
- field-scoped approved synonym expansion
- KST opening state including prior-day overnight intervals
- rounded Haversine distance
- review status, completeness, and Bayesian rating helpers

- [x] **Step 1: Write normalization table tests and confirm RED**

Test Korean/Latin variants, punctuation/control removal, stable
deduplication, all approved synonym groups, unknown terms, and
field-scoped aliases.

- [x] **Step 2: Implement normalization and confirm GREEN**

- [x] **Step 3: Write derivation tests and confirm RED**

Use fixed timestamps for all seven weekdays, exact open/close
boundaries, overnight carry, unknown hours, overlap rejection, E7
distance rounding, public 250-meter upper-bound bucketing, review
counts `0/1/2/3`, completeness weights, no-rating prior, and Bayesian
rounding.

- [x] **Step 4: Implement derivation and confirm GREEN**

No function in this task opens a database, reads the clock, or mutates
its input.

---

### Task 4: Hard filters, deterministic ranking, and explanations

**Produces:**

- one-pass primary filter reason accounting
- verified menu/alias/category matching
- both exact comparator tuples ending in store ID
- stable representative menu selection
- public reason/warning/relaxation generation

- [x] **Step 1: Write hard-filter tests and confirm RED**

Cover region, store, excluded category precedence, included category,
open-now unknown/closed, rounded distance boundary, review status, and
menu fallback with available/unavailable FTS. Assert a removed store is
never present after later ranking.

- [x] **Step 2: Implement hard filters and confirm GREEN**

- [x] **Step 3: Write ranking and explanation tests and confirm RED**

Cover every comparator position and null behavior for both sort modes,
rating-only non-inversion, insufficient-review FTS non-use, final ID
tie, at-most-three menus, real evidence IDs, partial warnings, and
stable relaxation order.

- [x] **Step 4: Implement ranking/explanation and confirm GREEN**

- [x] **Step 5: Run all recommendation tests**

```powershell
pnpm exec vitest run packages/recommendation/src
```

---

### Task 5: Version-consistent SQLite repositories

**Produces:**

- `StoreSearchRepository.inspectCurrentSnapshot`
- `StoreSearchRepository.loadSnapshot`
- `ReviewRepository.searchStoreEvidence`
- strict active-catalog/source-age failures
- an opaque composite version covering catalog, verified evidence, and
  active review corpus
- stable candidate/child row ordering
- one best real FTS hit per store without a public rank

- [x] **Step 1: Write failing store repository integration tests**

On a migrated real SQLite file, seed a versioned catalog and search
facts. Assert:

- exact composite data version is required;
- changing only evidence or only the review corpus changes the
  composite version and rejects the old expected version;
- no state, mismatched version, future basis date, and age `>30` days
  map to their safe codes;
- exactly 30 days is accepted;
- unpublished/inactive/incomplete stores are absent;
- stores not joined to the active source snapshot are absent;
- menus, aliases, hours, and review aggregates use the exact active
  component versions only;
- overlapping or otherwise inconsistent hours fail closed;
- rows are returned in deterministic ID order;
- database errors do not expose paths or SQL.

- [x] **Step 2: Run the focused test and confirm RED**

- [x] **Step 3: Implement the SQLite store repository**

Use bound parameters only. Compute the opaque SHA-256 version from
canonical component IDs and checksums. Convert the request timestamp to
a `YYYY-MM-DD` in `Asia/Seoul`; compare calendar dates, not
milliseconds. Return safe component IDs and source basis date with
candidate facts.

- [x] **Step 4: Write failing FTS evidence tests**

Assert approved terms are queried in stable priority order, the best
hit per store follows `(termPriority, bm25, date, reviewId)`, no
arbitrary candidate limit truncates stores, and all Feature 5
consistency failures return one unavailable state.

- [x] **Step 5: Extend the review repository and confirm GREEN**

The new method may expose `internalRank` only to server-internal
recommendation types. Existing public review-search behavior must remain
unchanged.

---

### Task 6: Search orchestration and partial fallback

**Produces:**

- `executeStoreSearch`
- safe `StoreSearchError`
- consistent metadata/filter summary
- FTS partial-result behavior

- [x] **Step 1: Write orchestration tests and confirm RED**

Assert validation occurs before repositories, version/source failures
throw safe codes, FTS failure yields `PARTIAL`, no snippet/text reason
survives fallback, structured filters still apply, empty results
include stable relaxation options, exact distance never enters the
public result, and the result passes its public schema. Prove a
menu-null query does not call FTS and remains `COMPLETE`.

- [x] **Step 2: Implement the service**

The exact sequence is:

1. validate input and request time;
2. open one SQLite read transaction;
3. normalize terms;
4. inspect and validate the composite data version;
5. load the exact candidate/evidence/review snapshot;
6. request bounded FTS evidence only for explicit menu text;
7. derive candidates;
8. apply hard filters;
9. rank;
10. build bucketed public items and metadata;
11. parse the final public contract before returning.

- [x] **Step 3: Run retrieval and recommendation tests; confirm GREEN**

---

### Task 7: Fixed 30-store/50-menu/20-scenario evaluation

**Produces:**

- non-sensitive deterministic database fixture
- exactly 20 search-only cases
- machine-readable evaluation result
- Hit Rate@5, hard-exclusion, determinism, fallback, inversion, and
  in-process p95 assertions

- [x] **Step 1: Write fixture-shape and evaluator tests; confirm RED**

Assert at least 30 distinct stores, at least 50 active menus, exact
scenario count 20, no origin/review body/snippet/rank/rating score in
the report, and deterministic fixture IDs.

- [x] **Step 2: Implement fixtures and evaluator**

Use the exact 20 IDs and groups in the approved design. Set
`countsTowardHitRate=true` for the 18 successful searches and `false`
for `version-mismatch` and `stale-source`. Score expected errors
separately. Map rendering and account isolation are reserved for later
cross-feature E2E and excluded from this denominator.

- [x] **Step 3: Prove quality and performance gates**

Assert:

- Hit Rate@5 is at least `0.85`;
- hard-exclusion count is `0`;
- 100 repeats have identical public order/evidence IDs;
- rating-only inversion count is `0`;
- FTS degradation is truthful;
- p95 after ten warm-ups and 100 measured runs is `<1500ms`.

Use integer monotonic durations and do not write a report file during
ordinary tests.

---

### Task 8: Boundary, documentation, and complete Feature gate

- [x] **Step 1: Add boundary regression tests**

Prevent web/client code from importing SQLite repositories or internal
recommendation ranking types, and prevent public contracts from adding
the banned score/origin keys.

- [x] **Step 2: Synchronize authoritative documentation**

Remove the superseded per-store 20-review cap in the PRD,
recommendation spec, local-first design, and worker design; use the
correct inclusion status contract; add DR-037 to decision indexes; make
the evaluation-plan denominator exactly 20 search-only cases; document
the active catalog pointer, source-basis freshness, commands, and honest
fixture/live-quality boundary.

- [x] **Step 3: Add the root gate**

Add:

```json
"test:search:feature6": "vitest run packages/contracts/src/search.test.ts packages/app-db/src/schema/search-evidence.test.ts apps/worker/src/catalog/publish-catalog.test.ts packages/recommendation/src packages/retrieval/src/sqlite-review-repository.test.ts packages/retrieval/src/sqlite-store-search-repository.test.ts packages/retrieval/src/execute-store-search.test.ts packages/retrieval/src/search-evaluation.test.ts scripts/check-workspace-boundaries.test.ts"
```

- [x] **Step 4: Run focused verification**

```powershell
pnpm test:search:feature6
pnpm db:check
pnpm typecheck
pnpm lint
```

- [x] **Step 5: Run full regression and production build**

```powershell
pnpm test
pnpm build
```

- [x] **Step 6: Perform one independent review**

Review only the final Feature 6 delta for correctness, privacy,
determinism, stale-data handling, and acceptance-criteria coverage.
Address findings and rerun the smallest affected gate plus the full
Feature 6 gate.

- [x] **Step 7: Use `commit-workflow` and push**

Inspect `git status`, every changed file, `git diff --check`, and the
complete diff. Stage each logical scope deliberately, verify
`git diff --cached`, create detailed conventional commits, rerun the
required final verification if staging changed nothing executable, and
push:

```powershell
git push origin HEAD:main
```

Do not begin Feature 7 until the push succeeds.
