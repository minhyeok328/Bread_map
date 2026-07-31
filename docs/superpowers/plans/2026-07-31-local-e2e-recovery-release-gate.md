# Local E2E, Recovery, and Release Gate Implementation Plan

> **Required skills:** use test-driven-development for implementation,
> verification-before-completion before claiming success, and commit-workflow
> to split and push the completed Feature.

**Goal:** Make every automatable local MVP completion condition reproducible
through `pnpm verify:local-mvp`, with a redacted JSON report and explicit live
smoke statuses.

**Architecture:** A typed TypeScript orchestrator owns an isolated run
directory and composes deterministic database/recovery functions with real
production build and Playwright subprocess gates. Production code receives no
test authentication bypass and no external network or paid-service path.

**Tech stack:** Node.js 24, pnpm 11, TypeScript, better-sqlite3/Drizzle, Vitest,
Next.js 16 production server, Auth.js encrypted JWT, Playwright system Chrome.

## Global constraints

- Never use the developer's default SQLite files during verification.
- Never back up or restore `raw.sqlite`.
- Never call live Kakao, LOCALDATA, OpenAI, or any paid endpoint.
- Never serialize secrets, provider identity, nicknames, raw review bodies,
  fingerprints, exact origin, or absolute SQLite paths into the report.
- Restore only to a nonexisting file and never swap it automatically.
- Keep `AUTH_URL` fixed to `http://127.0.0.1:3000`.
- Keep the Feature uncommitted until all gates pass, then use commit-workflow
  and push directly to `origin/main` as authorized by the user.

### Task 1: Implement app-database recovery

**Files:**
- Create: `apps/worker/src/recovery/restore-app-database.ts`
- Create: `apps/worker/src/recovery/restore-app-database.test.ts`

- [x] Write failing tests for URL/missing/equal/existing paths and corrupt
      input.
- [x] Write a migrated, seeded snapshot restore test.
- [x] Implement online backup to a new file and forward migration.
- [x] Verify integrity, foreign keys, migration history, table/row/FTS counts,
      stable checksum, representative search, and hidden-store exclusion.
- [x] Return only redacted recovery evidence and close every database handle.

### Task 2: Add file-backed checkpoint recovery evidence

**Files:**
- Create: `apps/worker/src/recovery/verify-review-resume.ts`
- Create: `apps/worker/src/recovery/verify-review-resume.test.ts`

- [x] Write a failing fixture test that commits pages, closes the DB, reopens
      it, and resumes the same run.
- [x] Reuse existing collection interfaces at the committed checkpoint.
- [x] Assert final unique rows equal input rows and duplicate count is zero.
- [x] Return counts/status only; never include raw review or nickname data.

### Task 3: Export a real search-quality runner

**Files:**
- Create: `packages/retrieval/src/search-quality-report.ts`
- Modify: `packages/retrieval/src/index.ts`
- Create: `scripts/search-quality-report.ts`
- Create: `scripts/search-quality-report.test.ts`
- Refactor: `packages/retrieval/src/search-evaluation.test.ts`

- [x] Reuse the existing 30-store/50-menu/20-scenario Feature 6 evaluation
      without duplicating its seed or assertions.
- [x] Write a failing test for the structured report and redaction contract.
- [x] Run all 20 scenarios through real SQLite retrieval, including a truthful
      injected FTS failure.
- [x] Emit Hit Rate@5, exclusions, 100-run determinism, and p95 metrics.
- [x] Keep the existing Feature 6 test assertions behaviorally unchanged.

### Task 4: Implement forbidden and local-security audits

**Files:**
- Create: `scripts/audit-local-mvp-release.ts`
- Create: `scripts/audit-local-mvp-release.test.ts`

- [x] Write failing fixture-tree tests for OpenAI, `/api/chat`, `/api/routes`,
      and active chat-submit detection in source and build output.
- [x] Scan only relevant text assets and return file-relative findings.
- [x] Verify loopback package scripts and fixed Auth.js origin.
- [x] Verify representative database, backup, WAL/SHM, dotenv, and report
      artifacts with `git check-ignore` semantics.
- [x] Prove injected secret/nickname/raw-review/token/path sentinels fail the
      captured-output audit while clean output passes.

### Task 5: Add production cross-feature browser E2E

**Files:**
- Create: `apps/web/playwright.local-mvp.config.ts`
- Create: `apps/web/e2e/fixtures/local-mvp-network.ts`
- Create: `apps/web/e2e/fixtures/local-mvp-session.ts`
- Create: `apps/web/e2e/search-and-detail.spec.ts`
- Create: `apps/web/e2e/favorites-isolation.spec.ts`
- Create: `apps/web/e2e/chat-shell.spec.ts`
- Modify as required: OAuth error presentation components/tests

- [x] Write browser tests first and observe missing fixture/config failures.
- [x] Generate two short-lived encrypted cookies backed by registry rows in
      the isolated database, without runtime bypass code.
- [x] Let store/favorite/history requests reach real Next.js handlers.
- [x] Mock only the Kakao Map SDK and block unexpected external requests.
- [x] Prove real search/detail snapshot consistency, map failure, sparse review,
      FTS fallback, two-account isolation, OAuth safe failure copy, disabled
      chat, focus return, and zero forbidden requests.
- [x] Run against production `next start` on `127.0.0.1:3000`.

### Task 6: Build the one-command verifier

**Files:**
- Create: `scripts/prepare-local-mvp-fixture.ts`
- Create: `scripts/prepare-local-mvp-fixture.test.ts`
- Create: `scripts/verify-local-mvp.ts`
- Create: `scripts/verify-local-mvp.test.ts`
- Modify: `package.json`

- [x] Write failing bootstrap and orchestration tests for gate order,
      fail-closed behavior,
      atomic report writing, redaction, and cleanup.
- [x] Create and migrate explicit isolated app/raw databases.
- [x] Seed deterministic app/search/auth data and run representative search.
- [x] Compose checkpoint, backup/restore, quality, audit, build, and browser
      gates without a live network call.
- [x] Write schema-versioned `test-results/local-mvp/report.json`.
- [x] Add `verify:local-mvp` and a focused Feature 10 unit-test command.

### Task 7: Synchronize delivery documentation

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/10-delivery/README.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`

- [x] Document the one-command gate, report fields, recovery restrictions, and
      safe failure behavior.
- [x] Map all thirteen Section 14 conditions without inventing a fourteenth.
- [x] Record live Kakao Login/Map as `NOT_RUN_CREDENTIALS_REQUIRED` and review
      collection as the existing policy/selector stop state.
- [x] Mark only gates actually executed.

### Task 8: Verify, review, split commits, and push

- [x] Run the focused Feature 10 unit suite.
- [x] Run `pnpm verify:local-mvp`.
- [x] Run workspace typecheck, lint/boundary, full Vitest, production build,
      and `git diff --check`.
- [x] Perform one full-scope review and reverify only changed areas after any
      fixes.
- [ ] Use commit-workflow to inspect every changed file and split detailed
      conventional commits by logical dependency.
- [ ] Fast-forward the Feature commits to `origin/main` and push.
- [ ] Record the push and final verification in delivery documentation, commit
      that record, and push it.
- [ ] Confirm clean worktree and `HEAD == origin/main`.

### Pre-commit verification record — 2026-07-31

- Runtime: Node `24.15.0`, pnpm `11.16.0`.
- Focused Feature 10 suite: 7 files, 14 tests passed.
- Workspace: typecheck, lint/boundary and production build exited 0; full
  Vitest passed 84 files and 562 tests.
- `verify:local-mvp`: fresh app migrations 6, raw migrations 3, catalog
  rows read/inserted/rejected 4/3/1, checkpoint resume page 3, duplicates 0,
  restore integrity `ok`, foreign-key violations 0, search Hit Rate@5
  8,888bp, 100-run determinism, p95 5ms, browser E2E passed, forbidden
  references/leaks 0, OpenAI cost `$0`, external network calls 0.
- Credential/policy-dependent live items remain recorded separately and were
  not treated as automated passes.
