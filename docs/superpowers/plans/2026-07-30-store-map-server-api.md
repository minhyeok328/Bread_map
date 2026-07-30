# Store and Map Server API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:test-driven-development for implementation and
> superpowers:verification-before-completion before claiming completion.

**Goal:** Expose authenticated deterministic store search and
snapshot-consistent store detail APIs while preserving the complete map/list
candidate set, exact-location privacy, partial review behavior, and a
cost-free map failure fallback.

**Architecture:** Versioned Zod API contracts wrap the existing Feature 6
search contract. The web server imports only safe retrieval facades and reads
public app-database tables in bounded transactions. Handler factories make
authentication, Origin, error mapping, and fixture integration independently
testable without external services.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod 4, Drizzle/better-sqlite3,
Vitest, existing `@bread-map/contracts`, `@bread-map/retrieval`, and
`@bread-map/recommendation`.

## Global Constraints

- Store search returns the complete Feature 6 `items` array without candidate
  pagination or arbitrary truncation.
- Detail reviews use only `reviewPage=1..1000` and `reviewLimit=1..20`.
- Exact origin appears only in the POST body and process memory.
- Exact origin and exact distance never enter a response, error, URL, log,
  history row, or database write.
- Only active published stores in the selected active catalog snapshot are
  public.
- Web imports no raw database, worker package, worker key, FTS repository, or
  ranking internals.
- Kakao Route and `/api/routes` are deferred; no external call or paid service
  is added.
- Per the user's workflow, implementation remains uncommitted until the whole
  Feature passes; `commit-workflow` then splits it into logical commits and
  pushes `origin/main`.

---

### Task 1: Add strict API contracts

**Files:**
- Create: `packages/contracts/src/api/store-search.ts`
- Create: `packages/contracts/src/api/store-search.test.ts`
- Create: `packages/contracts/src/api/store-detail.ts`
- Create: `packages/contracts/src/api/store-detail.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `StoreSearchRequest`, `StoreDetailQuery`,
  `StoreDetailResponse`, `StoreMapState`

- [x] Write failing tests for valid requests and exact unknown-field
  rejection.
- [x] Prove Feature 6 cross-field validation survives the API wrapper.
- [x] Prove detail page/limit defaults and maximum caps.
- [x] Define section availability, freshness, rating, review, and traceability
  schemas.
- [x] Define `READY | MAP_UNAVAILABLE` without adding route-time fields.
- [x] Implement parsers and response consistency refinements.

### Task 2: Add the safe snapshot bootstrap facade

**Files:**
- Modify: `packages/retrieval/src/execute-store-search.ts`
- Modify: `packages/retrieval/src/execute-store-search.test.ts`

**Interfaces:**
- Produces:
  `resolveCurrentSqliteSearchDataVersion({ appDatabase, requestTimeMs })`

- [x] Write a failing migrated-fixture test for current opaque version
  resolution.
- [x] Implement the facade without exposing repository or ranking facts.
- [x] Prove invalid time and unavailable/stale data use existing safe errors.

### Task 3: Implement authenticated store search

**Files:**
- Create: `apps/web/src/server/search-service.ts`
- Create: `apps/web/src/server/search-service.test.ts`
- Create: `apps/web/src/app/api/stores/route.ts`
- Create: `apps/web/src/app/api/stores/route.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: revocable principal, strict request, app database, Feature 6 facade
- Produces: `POST /api/stores -> StructuredSearchResult`

- [x] Write failing tests for Origin, authentication, JSON, body, version
  bootstrap, mismatch, stale data, and database failures.
- [x] Add the retrieval workspace dependency without raw/worker access.
- [x] Implement a pure handler factory and a production-only route wrapper.
- [x] Map known search failures to the documented HTTP table.
- [x] Assert the sentinel exact origin is absent from response/error text.

### Task 4: Implement snapshot-consistent store detail

**Files:**
- Create: `apps/web/src/server/store-detail-service.ts`
- Create: `apps/web/src/server/store-detail-service.test.ts`
- Create: `apps/web/src/app/api/stores/[storeId]/route.ts`
- Create: `apps/web/src/app/api/stores/[storeId]/route.test.ts`

**Interfaces:**
- Consumes: selected `storeId`, search data version, review page/limit, app DB
- Produces: public store detail with independent evidence/review states

- [x] Write a migrated fixture with available, insufficient, unavailable, and
  hidden-store controls.
- [x] Write failing tests for ID consistency, all verified menus/hours,
  opening state, rating, deidentified reviews, ordering, and pagination.
- [x] Prove evidence source/time and publish versions are traceable without
  exposing evidence refs.
- [x] Prove missing, hidden, and out-of-snapshot stores share one 404.
- [x] Implement one bounded read transaction with snapshot validation.
- [x] Convert SQLite failures to `SEARCH_DATABASE_UNAVAILABLE`.

### Task 5: Lock the map/list/fallback boundary

**Files:**
- Modify: `scripts/check-workspace-boundaries.ts`
- Modify: `scripts/check-workspace-boundaries.test.ts`
- Create: `apps/web/src/server/store-api.integration.test.ts`

**Interfaces:**
- Produces: one API result set shared by map/list and a no-route map fallback

- [x] Extend the boundary test to allow only the safe retrieval facade in web
  while continuing to reject repository/FTS/ranking internals.
- [x] Prove map and list consumer IDs are derived from the same complete
  `items` array.
- [x] Prove `MAP_UNAVAILABLE` preserves that same array and all fallback
  fields.
- [x] Prove the selected detail ID and snapshot equal the originating search
  item and metadata.
- [x] Prove no `/api/routes`, Kakao REST route key, fake travel time, OpenAI
  client, or external request exists.

### Task 6: Synchronize Feature 8 documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`
- Modify: `docs/README.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/09-decisions/decision-log.md`

- [x] Correct the stale `/api/routes` and Kakao Route checklist entries.
- [x] Record that Route travel time remains a later Feature.
- [x] Record exact search/detail contracts and review pagination bounds.
- [x] Mark only automated fixture gates actually run.
- [x] Keep Kakao Map key/live smoke explicitly credential-dependent and
  unrun when no owner key is present.

### Task 7: Verify, split commits, and push

- [x] Run `pnpm test:map:feature8`.
- [x] Run `pnpm db:check`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm lint`.
- [x] Run the complete test suite.
- [x] Run the production build.
- [x] Run `pnpm audit --prod`.
- [x] Run `git diff --check`.
- [x] Use `commit-workflow` to split contracts, retrieval/server behavior,
  tests/boundaries, and documentation into detailed conventional commits.
- [x] Push the resulting Feature 8 commits directly to `origin/main`.
- [x] Verify local `HEAD`, `origin/main`, and a clean worktree before Feature
  9 begins.

**Delivery record (2026-07-30):** Feature 8 implementation commits
`3d7baf1..78990cb` were pushed by fast-forward to `origin/main`.
`test:map:feature8` passed 133 tests, the full suite passed 508 tests, and
database check, typecheck, lint/boundary, production build, and production
dependency audit passed. Live Kakao Map smoke remains
`NOT_RUN_CREDENTIALS_REQUIRED`.
