# Map-First UI and Disabled Chat Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:test-driven-development for each behavior,
> superpowers:subagent-driven-development when delegating an independent
> task, and superpowers:verification-before-completion before claiming
> completion.

**Goal:** Deliver the approved responsive map-first search, shared
map/list selection, snapshot-consistent store detail, and mutually exclusive
빵빵이 FAB/disabled chat shell as a browser-verified local MVP interface.

**Architecture:** A pure reducer drives a client `MapShell`; thin API clients
validate Feature 8 responses; map, drawer, and chat components receive public
typed props and share exactly one selected store ID. Kakao JavaScript SDK
loading is isolated behind `BakeryMap`, and every failure preserves the same
list and detail data.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod contracts,
CSS custom properties, Kakao Maps JavaScript SDK, Vitest, Playwright.

## Global Constraints

- Use the complete `StructuredSearchResult.items` array for both map and list.
- Keep exact origin only in the active request's local variable.
- Do not persist search text, selection, exact location, or chat state.
- Do not add Kakao Route, a REST key, OpenAI, `/api/chat`, message storage, or
  an enabled chat submission path.
- Never fabricate map markers, routes, reviews, or AI output after failure.
- Preserve all unrelated user work.
- Keep implementation uncommitted until Feature 9 passes; then invoke
  `commit-workflow`, split the work into logical conventional commits, and
  push those commits directly to `origin/main` as authorized by the user.

---

### Task 1: Lock the UI state machine

**Files:**
- Create: `apps/web/src/components/layout/map-shell-state.ts`
- Create: `apps/web/src/components/layout/map-shell-state.test.ts`

**Interfaces:**
- Produces: `MapShellState`, `MapShellAction`, `initialMapShellState`,
  `mapShellReducer`

- [x] Write failing tests for initial list-first state and closed chat.
- [x] Write failing tests for search loading/success/partial/empty/error.
- [x] Write failing tests proving a new search clears stale selection/detail.
- [x] Write failing tests proving both selection sources set the same ID and
  detail view.
- [x] Write failing tests for back, collapse preservation, mobile surface,
  map status, and mutually exclusive chat state.
- [x] Implement the smallest exhaustive reducer and invariant helpers.
- [x] Run the focused state-machine test until green.

### Task 2: Add strict browser API clients

**Files:**
- Create: `apps/web/src/components/store/store-api-client.ts`
- Create: `apps/web/src/components/store/store-api-client.test.ts`

**Interfaces:**
- Produces: `searchStores(request, options)`,
  `readStoreDetail(storeId, snapshotVersion, options)`,
  `PublicApiError`

- [x] Write failing tests for the exact POST body and encoded detail query.
- [x] Write failing tests for search/detail contract validation.
- [x] Write failing tests for authentication, input, stale-data, unavailable,
  not-found, invalid-response, and abort handling.
- [x] Implement injected-fetch clients with no logging or reflected payload.
- [x] Run focused client tests until green.

### Task 3: Build the approved token system and app frame

**Files:**
- Create: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/public/brand/bbangbbang.svg`

**Interfaces:**
- Produces: CSS tokens, responsive app root, server-to-client public map-key
  handoff, original mascot asset

- [x] Add every approved color, typography, spacing, radius, shadow, focus,
  motion, and breakpoint token once.
- [x] Add baseline reset, semantic element defaults, screen-reader utility,
  and reduced-motion rules.
- [x] Import global CSS once from the root layout and add Korean metadata.
- [x] Keep `page.tsx` as a server component passing only a serializable public
  map key to `MapShell`.
- [x] Draw the original bread mascot SVG with repository-owned shapes and
  approved palette only.
- [x] Run typecheck to expose missing component contracts before proceeding.

### Task 4: Implement search, list, and detail presentation

**Files:**
- Create: `apps/web/src/components/store/store-search-form.tsx`
- Create: `apps/web/src/components/store/store-list.tsx`
- Create: `apps/web/src/components/store/store-detail.tsx`
- Create: `apps/web/src/components/store/store-drawer.tsx`
- Create: `apps/web/src/components/store/store-presenters.ts`
- Create: `apps/web/src/components/store/store-presenters.test.ts`

**Interfaces:**
- Search form emits strict `StoreSearchRequest` plus an ephemeral location
  resolver.
- List and detail consume Feature 8 public contracts only.

- [x] Write failing presenter tests for opening, distance bucket, review
  evidence, categories, dates, and safe public error copy.
- [x] Implement controlled structured fields and unique category chips.
- [x] Add explicit location explanation and request-only geolocation.
- [x] Implement accessible loading, partial, empty, stale, and error states.
- [x] Render all result IDs in deterministic order with no public score.
- [x] Render independent detail evidence sections and review-poor copy.
- [x] Implement back/collapse/mobile-toggle controls without losing query or
  selection.
- [x] Run focused presenter and state tests until green.

### Task 5: Implement Kakao map loading and shared selection

**Files:**
- Create: `apps/web/src/components/map/kakao-maps.ts`
- Create: `apps/web/src/components/map/kakao-maps.test.ts`
- Create: `apps/web/src/components/map/bakery-map.tsx`
- Create: `apps/web/src/types/kakao-maps.d.ts`

**Interfaces:**
- Produces: `renderKakaoBakeryMap(options) -> cleanup`
- `BakeryMap` consumes `items`, `selectedStoreId`, `onSelect`,
  `onStatusChange`, and `retryNonce`

- [x] Write failing SDK-double tests proving one marker per shared item.
- [x] Write failing tests proving marker events return the original store ID,
  update selected marker state, fit bounds, and dispose all listeners.
- [x] Implement the imperative adapter without reading search or detail APIs.
- [x] Load the SDK with `next/script` only when a public app key exists.
- [x] Map missing key, script failure, invalid global, and construction
  failure to `MAP_UNAVAILABLE`.
- [x] Keep the list/address/detail surface mounted in every map state.
- [x] Run focused map tests until green.

### Task 6: Implement chat shell and orchestration

**Files:**
- Create: `apps/web/src/components/chat/bbangbbang-fab.tsx`
- Create: `apps/web/src/components/chat/chat-shell.tsx`
- Create: `apps/web/src/components/layout/map-shell.tsx`

**Interfaces:**
- `MapShell` owns request cancellation, request IDs, reducer dispatch, and the
  single `handleStoreSelection(storeId)` command.

- [x] Connect the search request and clear ephemeral exact origin in `finally`.
- [x] Reject stale search/detail responses by request ID.
- [x] Connect both map and list to the same selection command.
- [x] Pass only public store name/address into chat context.
- [x] Render FAB and chat mutually exclusively.
- [x] Close chat by button and Escape, then restore focus to the rendered FAB.
- [x] Keep composer and suggestions disabled with no form or submit handler.
- [x] Run typecheck and focused tests until green.

### Task 7: Add browser E2E for the Feature 9 acceptance criteria

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/fixtures/store-api.ts`
- Create: `apps/web/e2e/fixtures/kakao-sdk.ts`
- Create: `apps/web/e2e/map-first-ui.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm test:ui:feature9`
- Uses only intercepted local responses; no Kakao, OpenAI, or other network
  call leaves the test process.

- [x] First run an E2E spec against the incomplete UI and record the expected
  red failure.
- [x] Mock authenticated search/detail HTTP responses at the browser boundary.
- [x] Intercept the Kakao SDK with a deterministic marker-capable local double.
- [x] Prove list and marker open the same store detail and snapshot.
- [x] Prove map SDK failure preserves list, address, and detail navigation.
- [x] Prove FAB/chat exclusivity, Escape/button close, focus return, disabled
  controls, and zero chatbot requests.
- [x] Prove keyboard-only search/detail flow.
- [x] Verify 1440x900, 768x1024, 360x800, 200% zoom-equivalent effective
  viewport, and reduced motion with
  no horizontal document overflow.
- [x] Run the Feature 9 browser gate until green.

### Task 8: Review, document, verify, commit, and push

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Verification:**
- `pnpm test:ui:feature9`
- focused Feature 9 Vitest files
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- source audit for forbidden chat/OpenAI/persistence behavior

- [x] Integrate the bounded requirements audit once.
- [x] Apply the React/Next review to the complete TSX diff once.
- [x] Use `superpowers:verification-before-completion` and run every listed
  gate from a clean command invocation.
- [x] Record the real Kakao smoke as `NOT_RUN_CREDENTIALS_REQUIRED` when no
  user-owned key is present; do not claim it passed.
- [x] Mark only verified Feature 9 checklist items complete.
- [ ] Read and invoke `commit-workflow`; create detailed logical conventional
  commits without unrelated changes.
- [ ] Push the completed Feature 9 commit sequence directly to `origin/main`.
