# Kakao Authentication and Account Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kakao login, revocable protected sessions, isolated favorites and
history, and irreversible local account withdrawal to the local Next.js MVP.

**Architecture:** Auth.js v5 owns OAuth and an encrypted JWT cookie while the
official Drizzle adapter is wrapped to persist only internal user and Kakao
provider identity. A hashed session registry provides revocation, and pure
route-handler factories enforce session ownership and exact-origin CSRF checks
against a real temporary SQLite database in tests.

**Tech Stack:** Next.js 16 App Router, React 19, Auth.js
`5.0.0-beta.32`, Auth.js core `0.41.3`, Auth.js Drizzle adapter `1.11.3`,
Drizzle ORM `0.45.2`, better-sqlite3 `12.11.1`, Zod `4.4.3`, Vitest `4.1.10`.

## Global Constraints

- Local auth origin is exactly `http://127.0.0.1:3000`; request host and
  forwarded headers never define callback URLs.
- Persist Kakao provider account ID only; do not persist OAuth tokens, email,
  phone, birthday, gender, nickname, image, exact user location, raw search
  text, medical expressions, or review text.
- Every user-data query includes the authenticated internal `user_id`.
- Missing and foreign owned resources have the same `404` response.
- Every mutation requires the exact allowed `Origin`.
- Withdrawal commits local deletion before Kakao unlink and never rolls it
  back.
- Schema source and generated migration are delivered together.
- Per the user's workflow, implementation remains uncommitted until the whole
  Feature passes; `commit-workflow` then splits it into logical commits and
  pushes `origin/main`.

---

### Task 1: Pin the aligned Auth.js dependency set

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: repository Node/Next/React/Drizzle exact pins
- Produces: one aligned Auth.js core, Next.js integration, and Drizzle adapter
  dependency graph

- [x] **Step 1: Update catalog and web manifest**

Set the catalog entries to:

```yaml
"@auth/core": 0.41.3
"@auth/drizzle-adapter": 1.11.3
next-auth: 5.0.0-beta.32
```

Add `"@auth/drizzle-adapter": "catalog:"` to web dependencies.
Add exact workspace overrides:

```yaml
overrides:
  postcss: 8.5.18
  sharp: 0.35.3
```

These remediate the production advisories inherited through Next.js. The
production build in Task 10 proves the override remains compatible with Next's
CSS and image paths.

- [x] **Step 2: Install exactly from the lockfile-aware workspace**

Run:

```powershell
pnpm install --no-frozen-lockfile
```

Expected: the lockfile contains the three exact versions with no peer warning
for Next 16 or React 19.

- [x] **Step 3: Verify the resolved graph and audit**

Run:

```powershell
pnpm --filter @bread-map/web list next-auth @auth/core @auth/drizzle-adapter --depth 1
pnpm audit --prod
```

Expected: one aligned Auth.js core line and no known production vulnerability.

### Task 2: Add account and user-data schema

**Files:**
- Create: `packages/app-db/src/schema/auth.ts`
- Create: `packages/app-db/src/schema/auth.test.ts`
- Create: `packages/app-db/src/schema/user-data.ts`
- Create: `packages/app-db/src/schema/user-data.test.ts`
- Modify: `packages/app-db/src/schema/index.ts`
- Create: `drizzle/app/0005_auth_user_data.sql`
- Modify: `drizzle/app/meta/_journal.json`
- Create: `drizzle/app/meta/0005_snapshot.json`

**Interfaces:**
- Consumes: `stores.storeId`, `openAppDatabase()`, `migrateAppDatabase()`
- Produces: `users`, `accounts`, `sessions`, `favorites`,
  `searchHistories`, and `selectionHistories`

- [x] **Step 1: Write failing migration and privacy tests**

The tests migrate a fresh temporary database and assert:

```ts
expect(tableNames).toEqual(
  expect.arrayContaining([
    "user",
    "account",
    "session",
    "favorite",
    "search_history",
    "selection_history"
  ])
);
expect(accountColumns).toEqual([
  "account_id",
  "user_id",
  "type",
  "provider",
  "provider_account_id",
  "created_at_ms"
]);
expect(userColumns).not.toEqual(
  expect.arrayContaining(["email", "phone", "birthday", "gender", "image"])
);
```

Also assert user/store cascade deletion, provider identity uniqueness,
user/store favorite uniqueness, 64-hex session hashes, allowed surfaces, valid
JSON, and nonnegative result counts.

- [x] **Step 2: Run the focused tests and observe missing tables**

Run:

```powershell
pnpm exec vitest run packages/app-db/src/schema/auth.test.ts packages/app-db/src/schema/user-data.test.ts
```

Expected: FAIL because the schema and migration do not exist.

- [x] **Step 3: Implement focused Drizzle schemas**

Define physical columns exactly as the design specifies. Use checks such as:

```ts
check(
  "session_token_hash_format",
  sql`${table.sessionToken} glob replace(hex(zeroblob(32)), '0', '[0-9a-f]')`
)
```

Implement the equivalent reliable SQLite check as
`length(session_token_hash) = 64` plus lowercase-hex `GLOB` rejection, and add
the ownership indexes and cascade foreign keys.

- [x] **Step 4: Generate and review migration**

Run:

```powershell
pnpm exec drizzle-kit generate --name=auth_user_data --config=drizzle/app.config.ts
```

Expected: one new migration and snapshot; inspect the SQL to confirm it has no
forbidden profile, OAuth token, or exact-location columns.

- [x] **Step 5: Run schema tests and drift check**

Run:

```powershell
pnpm exec vitest run packages/app-db/src/schema/auth.test.ts packages/app-db/src/schema/user-data.test.ts
pnpm db:check:app
```

Expected: PASS.

### Task 3: Define strict user-data contracts

**Files:**
- Create: `packages/contracts/src/user-data.ts`
- Create: `packages/contracts/src/user-data.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: menu/category and search enum values from
  `packages/contracts/src/search.ts`
- Produces: `favoriteMutationSchema`, `historyQuerySchema`,
  `historyMutationSchema`, `historyDeleteSchema`, and
  `accountWithdrawalSchema`

- [x] **Step 1: Write failing contract tests**

Use literal fixtures to prove:

```ts
expect(() =>
  parseHistoryMutation({
    kind: "search",
    filters: {
      schemaVersion: "search-history-filters-v1",
      latitudeE7: 375634614
    }
  })
).toThrow();
expect(() =>
  parseHistoryMutation({
    kind: "search",
    rawQuery: "allergy free bread"
  })
).toThrow();
```

Test valid normalized filters, valid selection surfaces, maximum list limits,
opaque IDs, and exact withdrawal confirmation.

- [x] **Step 2: Run the contract test and observe missing exports**

Run:

```powershell
pnpm exec vitest run packages/contracts/src/user-data.test.ts
```

Expected: FAIL because the contracts do not exist.

- [x] **Step 3: Implement strict Zod schemas**

Use `z.strictObject()` throughout. The normalized search filter object exposes
only:

```ts
{
  schemaVersion: "search-history-filters-v1";
  areaLabel: string | null;
  categories: CategoryFilter[];
  openNow: boolean;
  maxDistanceBucketM: number | null;
  reviewEvidenceStatus: ReviewEvidenceStatus;
  sortMode: SearchSortMode;
}
```

- [x] **Step 4: Run the focused contract tests**

Run:

```powershell
pnpm exec vitest run packages/contracts/src/user-data.test.ts
```

Expected: PASS.

### Task 4: Implement the minimized Auth.js adapter and session registry

**Files:**
- Create: `apps/web/src/server/auth-adapter.ts`
- Create: `apps/web/src/server/auth-adapter.test.ts`
- Create: `apps/web/src/server/session-registry.ts`
- Create: `apps/web/src/server/session-registry.test.ts`
- Create: `apps/web/src/server/app-database.ts`

**Interfaces:**
- Consumes: official `DrizzleAdapter`, app Drizzle tables, Node crypto
- Produces: `createMinimalAuthAdapter(db)`, `hashSessionId(sessionId)`,
  `registerSession()`, `resolveSession()`, and `revokeSession()`

- [x] **Step 1: Write failing adapter characterization tests**

Pass a complete OAuth account fixture containing access, refresh, and ID tokens
to `linkAccount`, then query SQLite directly:

```ts
expect(accountRows).toEqual([
  {
    provider: "kakao",
    provider_account_id: "provider-a",
    user_id: expect.any(String)
  }
]);
expect(JSON.stringify(accountRows)).not.toContain("access-token");
```

Register session ID `plain-session-id`, then assert SQLite contains only the
known SHA-256 literal and never the plaintext.

- [x] **Step 2: Run tests and observe missing adapter**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/auth-adapter.test.ts apps/web/src/server/session-registry.test.ts
```

Expected: FAIL because the modules do not exist.

- [x] **Step 3: Wrap the official Drizzle adapter**

Construct `DrizzleAdapter(db, customTables)` lazily and override:

```ts
async linkAccount(account) {
  return base.linkAccount!({
    userId: account.userId,
    type: "oauth",
    provider: "kakao",
    providerAccountId: account.providerAccountId
  });
}
```

Map adapter users to `{ id, name: null, email: null, image: null,
emailVerified: null }` and make `getUserByEmail()` return `null`.

- [x] **Step 4: Implement hashed session registry**

Hash with Node `createHash("sha256")`, compare only normalized lowercase hex,
and resolve a session only when its user is `ACTIVE` and its expiry is later
than the injected clock.

- [x] **Step 5: Run the focused adapter/session tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/auth-adapter.test.ts apps/web/src/server/session-registry.test.ts
```

Expected: PASS.

### Task 5: Configure Kakao Auth.js and exact callback origin

**Files:**
- Create: `apps/web/src/auth.ts`
- Create: `apps/web/src/auth.test.ts`
- Create: `apps/web/src/types/next-auth.d.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: minimal adapter and session registry
- Produces: Auth.js `handlers`, `auth`, `signIn`, `signOut`, protected JWT
  claims, and exact-origin route delegates

- [x] **Step 1: Write failing configuration tests**

Assert the Kakao profile and account mappers:

```ts
expect(mapKakaoProfile(fullKakaoFixture)).toEqual({
  id: "123456789",
  name: null,
  email: null,
  image: null
});
expect(mapKakaoAccount(fullTokenFixture)).toEqual({});
```

Assert an auth request for `http://localhost:3000` or a forged forwarded host
returns `400`, while the exact `127.0.0.1` origin delegates.

- [x] **Step 2: Run tests and observe missing auth configuration**

Run:

```powershell
pnpm exec vitest run apps/web/src/auth.test.ts 'apps/web/src/app/api/auth/[...nextauth]/route.test.ts'
```

Expected: FAIL because the configuration and route do not exist.

- [x] **Step 3: Implement Auth.js configuration**

Use six-hour JWT sessions. On sign-in, the JWT callback registers a random
session ID and stores only these encrypted claims:

```ts
{
  internalUserId,
  sessionId,
  authenticatedAtMs,
  expiresAtMs,
  kakaoAccessToken
}
```

On later calls, reject a missing, expired, revoked, or deleting session. The
session callback returns only internal user ID, expiry, and authentication
time.

- [x] **Step 4: Implement exact-origin route wrapper**

Before `handlers.GET/POST`, compare `new URL(request.url).origin` with the
constant parsed from `AUTH_URL`. Do not inspect forwarded headers.

- [x] **Step 5: Run auth tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/auth.test.ts 'apps/web/src/app/api/auth/[...nextauth]/route.test.ts'
```

Expected: PASS without live Kakao credentials.

### Task 6: Implement the ownership-scoped repository

**Files:**
- Create: `apps/web/src/server/user-repository.ts`
- Create: `apps/web/src/server/user-repository.test.ts`

**Interfaces:**
- Consumes: app database schema and strict contracts
- Produces: `createUserRepository(db, clock)` with favorite, history, session,
  and withdrawal operations that always require a session user ID

- [x] **Step 1: Write a two-user failing IDOR matrix**

Seed users A/B, stores, favorites, search histories, and selection histories.
Prove user A cannot read or delete any user B record and that deleting the same
opaque missing/foreign ID returns `false`.

- [x] **Step 2: Run the repository test and observe missing repository**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/user-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [x] **Step 3: Implement ownership in every SQL predicate**

For example:

```ts
db.delete(favorites).where(
  and(
    eq(favorites.userId, authenticatedUserId),
    eq(favorites.storeId, storeId)
  )
);
```

Reject mutation when the user status is not `ACTIVE`. Serialize normalized
history JSON only after contract parsing.

- [x] **Step 4: Implement transactional local withdrawal**

Within one better-sqlite3 transaction, update the user to `DELETING`, delete
all sessions and user data, then delete account and user. Return only the
provider name and provider account ID to the in-memory caller for the immediate
unlink call; never log or persist it after commit.

- [x] **Step 5: Run repository tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/user-repository.test.ts
```

Expected: PASS.

### Task 7: Implement authenticated favorites and history APIs

**Files:**
- Create: `apps/web/src/server/authenticated-request.ts`
- Create: `apps/web/src/server/api-response.ts`
- Create: `apps/web/src/server/favorite-route.ts`
- Create: `apps/web/src/server/history-route.ts`
- Create: `apps/web/src/app/api/favorites/route.ts`
- Create: `apps/web/src/app/api/favorites/route.test.ts`
- Create: `apps/web/src/app/api/history/route.ts`
- Create: `apps/web/src/app/api/history/route.test.ts`

**Interfaces:**
- Consumes: protected JWT decoding, session registry, contracts, repository
- Produces: favorites/history `GET`, `POST`, and `DELETE` route handlers

- [x] **Step 1: Write failing route behavior tests**

Against a real temporary database, cover `401`, exact-origin `403`, invalid
`400`, missing/foreign `404`, idempotent favorite creation, and user-scoped
lists for both users.

- [x] **Step 2: Run route tests and observe missing handlers**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/api/favorites/route.test.ts apps/web/src/app/api/history/route.test.ts
```

Expected: FAIL because the routes do not exist.

- [x] **Step 3: Implement request principal and response helpers**

The principal resolver decodes the Auth.js cookie server-side, verifies the
hashed registry row, and returns only:

```ts
{
  userId: string;
  sessionId: string;
  authenticatedAtMs: number;
  kakaoAccessToken: string;
}
```

No public response includes the latter three fields.

- [x] **Step 4: Implement route factories and production handlers**

Each testable server module exports a factory accepting principal/repository
dependencies for real integration tests. Next.js `route.ts` files export only
the supported HTTP handlers and use lazy app database access. Every mutation
calls the same exact-origin guard before JSON parsing.

- [x] **Step 5: Run route tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/api/favorites/route.test.ts apps/web/src/app/api/history/route.test.ts
```

Expected: PASS.

### Task 8: Implement withdrawal and Kakao unlink

**Files:**
- Create: `apps/web/src/server/kakao-unlink.ts`
- Create: `apps/web/src/server/kakao-unlink.test.ts`
- Create: `apps/web/src/server/account-route.ts`
- Create: `apps/web/src/app/api/account/route.ts`
- Create: `apps/web/src/app/api/account/route.test.ts`

**Interfaces:**
- Consumes: authenticated principal, repository withdrawal transaction,
  current protected Kakao access token
- Produces: account `DELETE`, provider unlink result, and cleared auth cookie

- [x] **Step 1: Write failing success and failure tests**

Assert recent-auth and confirmation checks. In the provider-failure test, make
the unlink boundary return failure and then query all six user-owned tables:

```ts
expect(remainingOwnedRows).toEqual({
  user: 0,
  account: 0,
  session: 0,
  favorite: 0,
  searchHistory: 0,
  selectionHistory: 0
});
expect(response.status).toBe(202);
```

- [x] **Step 2: Run tests and observe missing withdrawal handler**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/kakao-unlink.test.ts apps/web/src/app/api/account/route.test.ts
```

Expected: FAIL because unlink and withdrawal do not exist.

- [x] **Step 3: Implement the provider boundary**

POST to Kakao's unlink endpoint with the access token only in the
`Authorization` header. Use an abort timeout, consume no provider response
fields beyond success/failure, and return a non-sensitive result code.

- [x] **Step 4: Implement local-first withdrawal**

Require authentication age at most ten minutes, run local deletion, then call
unlink. Return `200` with `UNLINKED` or `202` with `PENDING_MANUAL`. Clear local
and secure Auth.js session cookie names in both cases.

- [x] **Step 5: Run withdrawal tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/server/kakao-unlink.test.ts apps/web/src/app/api/account/route.test.ts
```

Expected: PASS.

### Task 9: Synchronize owner and delivery documents

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md`
- Modify: `docs/05-data/data-design.md`
- Modify: `docs/06-trust/security-design.md`
- Modify: `docs/09-decisions/decision-log.md`
- Modify: `docs/10-delivery/technology-stack.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/README.md`

**Interfaces:**
- Consumes: verified implementation and actual version/schema/API names
- Produces: one non-conflicting operational source of truth and live smoke
  instructions

- [x] **Step 1: Record the dependency and security decision**

Add a decision-log entry for the aligned beta set, official adapter wrapper,
token-minimized JWT, hashed revocation registry, and exact `127.0.0.1`
callback.

- [x] **Step 2: Correct stale callback and target-table wording**

Replace only the Feature 7 stale `localhost` callback. Mark the implemented
tables as current rather than targets and document the deliberate absence of
profile/OAuth-token columns.

- [x] **Step 3: Document local setup without secrets**

Document generation of `AUTH_SECRET`, Kakao console callback registration, DB
migration, and the live login/unlink smoke. Never include credential values,
provider IDs, or tokens.

- [x] **Step 4: Check Markdown links and drift**

Run the repository's existing Markdown link check if present, then:

```powershell
git diff --check -- docs
```

Expected: no broken relative link or whitespace error.

### Task 10: Run Feature 7 verification and delivery workflow

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-07-30-kakao-auth-account-data.md`

**Interfaces:**
- Consumes: all Feature 7 implementation and tests
- Produces: a repeatable Feature 7 gate, verified commits, and pushed
  `origin/main`

- [x] **Step 1: Add the focused Feature gate**

Add `test:auth:feature7` listing the Feature 7 contract, schema, adapter,
repository, route, and withdrawal tests explicitly.

- [x] **Step 2: Run the focused and integration gates**

Run:

```powershell
pnpm test:auth:feature7
pnpm db:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all commands pass.

- [x] **Step 3: Review the full Feature diff once**

Check:

```powershell
git diff --check
git status --short
git diff --stat
```

Review authentication, deletion, privacy, and migration changes against the
design's ten automated gates.

- [x] **Step 4: Run the explicit commit workflow**

Use the `commit-workflow` skill to inspect the complete diff, split schema,
contracts, auth adapter/configuration, user APIs, withdrawal, dependency lock,
and documentation into logical English Conventional Commits, stage only the
intended files, and verify every staged diff.

- [x] **Step 5: Push Feature 7 before starting Feature 8**

Rebase or integrate safely if `origin/main` advanced, re-run affected gates,
then push the Feature commits directly to `origin/main` as explicitly
authorized by the user.

- [x] **Step 6: Record live-smoke status**

If real Kakao credentials are available, run login, list-without-location,
logout, re-login, and withdrawal/unlink smoke at the exact callback and record
date/result/runner. If credentials are absent, record the external blocker
without secrets and stop before Feature 8 only if that unverified external
boundary is judged release-critical.
