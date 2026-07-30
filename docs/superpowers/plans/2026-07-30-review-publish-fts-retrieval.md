# Review Publish and FTS Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Feature 4's encrypted deidentified reviews into a
versioned public corpus and provide safe, deterministic SQLite FTS5
retrieval for Feature 6.

**Architecture:** The worker loads and decrypts a terminal raw
collection run before opening a short app database transaction. The app
database owns review documents, a trigger-maintained regular FTS5 table,
and active publish/index state; a new retrieval package exposes the only
consumer-facing search contract.

**Tech Stack:** Node.js 24.15.0, pnpm 11.16.0, TypeScript 6.0.3,
better-sqlite3 12.11.1, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10,
SQLite FTS5, Zod 4.4.3, Vitest 4.1.10

## Global Constraints

- Follow
  `docs/superpowers/specs/2026-07-30-review-publish-fts-retrieval-design.md`.
- The web package must never import `@bread-map/raw-db`, review secrets,
  raw review paths, or the publisher.
- The public corpus must contain only decrypted payload fields already
  deidentified by Feature 4.
- Never log or return plaintext bodies from worker errors.
- `PARTIAL` and incremental runs merge; absence never deletes a
  non-expired current review.
- Any publish failure preserves the prior active corpus and index state.
- No external API, Docker, OpenAI, or paid service is required.
- Use strict RED-GREEN-REFACTOR for every behavior.
- The user explicitly requested commit workflow execution. After the
  complete Feature gate passes, inspect every changed file, split the
  result into logical conventional commits, and push the verified commit
  series to `origin/main` before starting Feature 6.

## File Map

### Create

- `packages/app-db/src/schema/reviews.ts`: public review documents and
  publish/index version tables
- `packages/app-db/src/schema/review-search.ts`: FTS table/index contract
  constants
- `packages/app-db/src/schema/reviews.test.ts`: migration and trigger
  integration tests
- `drizzle/app/0003_review_publish_fts.sql`: generated relational schema
  plus reviewed FTS5 virtual table and triggers
- `drizzle/app/meta/0003_snapshot.json`: Drizzle relational snapshot
- `packages/retrieval/package.json`: retrieval workspace package
- `packages/retrieval/tsconfig.json`: package TypeScript configuration
- `packages/retrieval/src/review-repository.ts`: public repository types
- `packages/retrieval/src/normalize-review-search.ts`: body/query
  normalization and safe FTS expression construction
- `packages/retrieval/src/sqlite-review-repository.ts`: better-sqlite3
  adapter
- `packages/retrieval/src/sqlite-review-repository.test.ts`: real SQLite
  contract tests
- `packages/retrieval/src/index.ts`: public exports
- `apps/worker/src/reviews/publish-review.ts`: raw-to-app publisher
- `apps/worker/src/reviews/publish-review.test.ts`: real dual-database
  publisher tests

### Modify

- `packages/app-db/src/schema/index.ts`: export review schema and FTS
  constants
- `apps/worker/package.json`: depend on `@bread-map/retrieval`
- `package.json`: add the Feature 5 gate
- `scripts/check-workspace-boundaries.ts`: include publisher/raw review
  publication symbols in web boundary checks
- `scripts/check-workspace-boundaries.test.ts`: verify the new boundary
- `docs/README.md`: record Feature 5 completion
- `docs/05-data/data-design.md`: align public-corpus retention semantics
- `docs/09-decisions/decision-log.md`: record non-restorative purge
- `docs/10-delivery/README.md`: update implemented Feature list
- `docs/10-delivery/directory-structure.md`: record new package/files
- `docs/10-delivery/local-development.md`: add migration and Feature 5
  commands
- `docs/10-delivery/development-readiness-checklist.md`: add automatic
  Feature 5 gate

---

### Task 1: Public review schema and trigger-maintained FTS5

**Files:**

- Create: `packages/app-db/src/schema/reviews.test.ts`
- Create: `packages/app-db/src/schema/reviews.ts`
- Create: `packages/app-db/src/schema/review-search.ts`
- Create: `drizzle/app/0003_review_publish_fts.sql`
- Create: `drizzle/app/meta/0003_snapshot.json`
- Modify: `drizzle/app/meta/_journal.json`
- Modify: `packages/app-db/src/schema/index.ts`

**Interfaces:**

- Produces:
  - `reviewPublishVersions`
  - `reviewDocuments`
  - `ftsIndexStates`
  - `REVIEW_PUBLISH_CONTRACT_VERSION = "review-publish-v1"`
  - `REVIEW_FTS_INDEX_VERSION = "review-fts-unicode61-v1"`

- [x] **Step 1: Write the failing migration and trigger tests**

Create a migrated real app database and assert these objects exist:

```ts
expect(tableNames).toEqual(
  expect.arrayContaining([
    "review_publish_version",
    "review_document",
    "fts_index_state",
    "review_fts"
  ])
);
expect(triggerNames).toEqual(
  expect.arrayContaining([
    "review_document_fts_insert",
    "review_document_fts_update",
    "review_document_fts_delete"
  ])
);
```

Seed one published store, one active version, and one review. Assert
insert, update, and delete change `review_fts` in the same transaction:

```ts
expect(
  client.prepare(
    "SELECT review_id, store_id, normalized_body FROM review_fts"
  ).all()
).toEqual([
  {
    review_id: "review_fixture",
    store_id: "store_fixture",
    normalized_body: "소금빵 바삭함"
  }
]);
```

The test must also prove invalid provider, out-of-range rating, malformed
date, and a missing/non-public store cannot be persisted.

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
corepack pnpm test packages/app-db/src/schema/reviews.test.ts
```

Expected: FAIL because the review tables and `review_fts` do not exist.

- [x] **Step 3: Add relational Drizzle schema**

Define:

```ts
export const reviewPublishVersions = sqliteTable(
  "review_publish_version",
  {
    versionId: text("version_id").primaryKey(),
    sourceRunId: text("source_run_id").notNull(),
    sourceRunStatus: text("source_run_status").notNull(),
    sourceAsOfDate: text("source_as_of_date").notNull(),
    status: text("status").notNull(),
    activeSlot: integer("active_slot"),
    documentCount: integer("document_count").notNull(),
    ftsDocumentCount: integer("fts_document_count").notNull(),
    corpusChecksum: text("corpus_checksum").notNull(),
    publishedAtMs: integer("published_at_ms").notNull()
  },
  (table) => [
    uniqueIndex("review_publish_source_run_unique").on(
      table.sourceRunId
    ),
    uniqueIndex("review_publish_active_slot_unique").on(
      table.activeSlot
    )
  ]
);
```

Add SQLite checks for:

- `source_run_status in ('SUCCEEDED','PARTIAL')`
- `status in ('BUILDING','ACTIVE','SUPERSEDED')`
- nullable `active_slot` equal to `1`
- ISO local date shape
- nonnegative equal document counts after activation
- 64-character lowercase hexadecimal checksum

Define `reviewDocuments` with a foreign key to a published `store` and
the fields in the design. Define `ftsIndexStates` with one active slot,
the exact index version, equal nonnegative count, and checksum.

- [x] **Step 4: Generate the relational migration**

Run:

```powershell
corepack pnpm exec drizzle-kit generate --name=review_publish_fts --config=drizzle/app.config.ts
```

Expected: a new `0003` migration and snapshot containing the three
relational tables and indexes.

- [x] **Step 5: Append the reviewed FTS5 table and triggers**

Add this exact shape after relational tables:

```sql
CREATE VIRTUAL TABLE `review_fts` USING fts5(
  `review_id` UNINDEXED,
  `store_id` UNINDEXED,
  `normalized_body`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `review_document_fts_insert`
AFTER INSERT ON `review_document`
BEGIN
  INSERT INTO `review_fts`(
    rowid, review_id, store_id, normalized_body
  ) VALUES (
    new.rowid, new.review_id, new.store_id, new.normalized_body
  );
END;
--> statement-breakpoint
CREATE TRIGGER `review_document_fts_update`
AFTER UPDATE OF `review_id`, `store_id`, `normalized_body`
ON `review_document`
BEGIN
  DELETE FROM `review_fts` WHERE rowid = old.rowid;
  INSERT INTO `review_fts`(
    rowid, review_id, store_id, normalized_body
  ) VALUES (
    new.rowid, new.review_id, new.store_id, new.normalized_body
  );
END;
--> statement-breakpoint
CREATE TRIGGER `review_document_fts_delete`
AFTER DELETE ON `review_document`
BEGIN
  DELETE FROM `review_fts` WHERE rowid = old.rowid;
END;
```

- [x] **Step 6: Run migration checks and verify GREEN**

Run:

```powershell
corepack pnpm test packages/app-db/src/schema/reviews.test.ts
corepack pnpm db:check
```

Expected: PASS, including replaying migration on an already migrated
database.

- [x] **Step 7: Inspect the task diff**

Run:

```powershell
git status --short
git diff --check
git diff -- packages/app-db drizzle/app
```

Confirm no raw fields appear in the app schema.

---

### Task 2: Safe review retrieval package

**Files:**

- Create: `packages/retrieval/package.json`
- Create: `packages/retrieval/tsconfig.json`
- Create: `packages/retrieval/src/review-repository.ts`
- Create: `packages/retrieval/src/normalize-review-search.ts`
- Create: `packages/retrieval/src/sqlite-review-repository.ts`
- Create: `packages/retrieval/src/sqlite-review-repository.test.ts`
- Create: `packages/retrieval/src/index.ts`

**Interfaces:**

```ts
export interface ReviewSearchInput {
  text: string;
  storeIds?: readonly string[];
  limit?: number;
}

export interface StoreReviewListInput {
  storeId: string;
  limit?: number;
}

export interface ReviewSearchHit {
  reviewId: string;
  storeId: string;
  body: string;
  ratingBasisPoints: number | null;
  publishedDate: string;
  snippet: string;
}

export interface ReviewIndexState {
  indexVersion: "review-fts-unicode61-v1";
  publishVersionId: string;
  documentCount: number;
  corpusChecksum: string;
  builtAtMs: number;
}

export type ReviewSearchResult =
  | { status: "AVAILABLE"; hits: readonly ReviewSearchHit[] }
  | {
      status: "UNAVAILABLE";
      code: "FTS_UNAVAILABLE";
      hits: readonly [];
    };

export interface ReviewRepository {
  searchReviews(input: ReviewSearchInput): ReviewSearchResult;
  listStoreReviews(
    input: StoreReviewListInput
  ): readonly ReviewSearchHit[];
  getActiveIndexState(): ReviewIndexState | null;
}
```

- [x] **Step 1: Write failing real-database repository tests**

Name the break each test catches:

- search misses normalized Hangul/Unicode text
- FTS operators escape the text boundary
- store filtering widens results
- equal relevance produces nondeterministic order
- list-by-store leaks another store
- an unavailable/dropped FTS table throws instead of degrading

Use literal expected IDs and bodies. Do not compute expected values with
the normalizer under test.

- [x] **Step 2: Run the repository test and verify RED**

Run:

```powershell
corepack pnpm test packages/retrieval/src/sqlite-review-repository.test.ts
```

Expected: FAIL because `@bread-map/retrieval` and its adapter do not
exist.

- [x] **Step 3: Implement normalization and FTS query encoding**

Implement:

```ts
export function normalizeReviewText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildReviewFtsQuery(value: string): string {
  const tokens =
    normalizeReviewText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    throw new ReviewQueryValidationError("REVIEW_QUERY_EMPTY");
  }
  return tokens
    .map((token) => `"${token.replace(/"/gu, "\"\"")}"`)
    .join(" AND ");
}
```

Validate text length `1..200`, store IDs `1..100`, each ID `1..128`,
and limit `1..100`.

- [x] **Step 4: Implement the SQLite adapter**

Use parameter placeholders for every store ID and limit. Search with:

```sql
SELECT
  document.review_id AS reviewId,
  document.store_id AS storeId,
  document.body,
  document.rating_basis_points AS ratingBasisPoints,
  document.published_date AS publishedDate,
  snippet(review_fts, 2, '[', ']', ' … ', 16) AS snippet
FROM review_fts
JOIN review_document AS document
  ON document.rowid = review_fts.rowid
WHERE review_fts MATCH ?
ORDER BY
  bm25(review_fts) ASC,
  document.published_date DESC,
  document.review_id ASC
LIMIT ?
```

Append the optional `document.store_id IN (...)` predicate before
ordering. Catch only SQLite execution errors and return
`FTS_UNAVAILABLE`; allow input validation errors to reach the caller.

- [x] **Step 5: Verify GREEN and package boundaries**

Run:

```powershell
corepack pnpm test packages/retrieval/src/sqlite-review-repository.test.ts
corepack pnpm --filter @bread-map/retrieval typecheck
corepack pnpm check:boundaries
```

Expected: PASS with no raw database dependency.

- [x] **Step 6: Inspect the task diff**

Run:

```powershell
git status --short
git diff --check
git diff -- packages/retrieval
```

---

### Task 3: Transactional raw-to-app review publisher

**Files:**

- Create: `apps/worker/src/reviews/publish-review.test.ts`
- Create: `apps/worker/src/reviews/publish-review.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**

```ts
export interface PublishReviewRunOptions {
  rawDatabase: RawDatabaseHandle;
  appDatabase: AppDatabaseHandle;
  runId: string;
  encryptionKeys: ReadonlyMap<string, Buffer>;
  now?: () => number;
}

export interface ReviewPublishSummary {
  versionId: string;
  sourceRunId: string;
  sourceRunStatus: "SUCCEEDED" | "PARTIAL";
  sourceAsOfDate: string;
  documentCount: number;
  ftsDocumentCount: number;
  corpusChecksum: string;
  status: "ACTIVE" | "SUPERSEDED";
  replayed: boolean;
}

export function publishReviewRun(
  options: PublishReviewRunOptions
): ReviewPublishSummary;
```

- [x] **Step 1: Write failing dual-database publisher tests**

Use real migrated app/raw files and existing
`encryptRawReview`. Prove:

- a successful run publishes a searchable review
- replay returns `replayed: true` with one version and one document
- a later incremental run preserves the first review and adds the second
- a partial run preserves a current review for an absent store
- a 12-month cutoff deletes the document and its FTS row
- missing key and tampered ciphertext leave the previous active version
  unchanged
- a non-public store aborts the publish
- a review dated after the run's fixed as-of date aborts the publish
- a superseded source run cannot reactivate stale data

- [x] **Step 2: Run the publisher test and verify RED**

Run:

```powershell
corepack pnpm test apps/worker/src/reviews/publish-review.test.ts
```

Expected: FAIL because `publishReviewRun` does not exist.

- [x] **Step 3: Implement safe error and run loading**

Add:

```ts
export type ReviewPublishErrorCode =
  | "REVIEW_PUBLISH_RUN_NOT_FOUND"
  | "REVIEW_PUBLISH_RUN_NOT_TERMINAL"
  | "REVIEW_PUBLISH_KEY_UNAVAILABLE"
  | "REVIEW_PUBLISH_DECRYPT_FAILED"
  | "REVIEW_PUBLISH_STORE_NOT_PUBLIC"
  | "REVIEW_PUBLISH_FTS_INCONSISTENT"
  | "REVIEW_PUBLISH_STALE_REPLAY"
  | "REVIEW_PUBLISH_INPUT_EXPIRED"
  | "REVIEW_PUBLISH_INPUT_NOT_ELIGIBLE"
  | "REVIEW_PUBLISH_INPUT_KEY_VERSION_MISMATCH"
  | "REVIEW_PUBLISH_INPUT_INCOMPLETE"
  | "REVIEW_PUBLISH_INPUT_INVALID"
  | "REVIEW_PUBLISH_DATABASE_UNAVAILABLE";

export class ReviewPublishError extends Error {
  constructor(readonly code: ReviewPublishErrorCode) {
    super(code);
    this.name = "ReviewPublishError";
  }
}
```

Load `review_collection_run` by ID and accept only `SUCCEEDED` or
`PARTIAL`. Load ciphertext rows by exact `run_id`, resolve each key by
`key_version`, and call existing `decryptRawReview` with row-derived AAD.
Map all crypto failures to `REVIEW_PUBLISH_DECRYPT_FAILED`.

- [x] **Step 4: Implement calendar cutoff and deterministic checksum**

Implement a February-safe year subtraction on the ISO date. Hash rows
ordered by `review_id`, separating each field with a length prefix so
different field boundaries cannot collide:

```ts
function updateField(hash: Hash, value: string): void {
  hash.update(String(Buffer.byteLength(value, "utf8")));
  hash.update(":");
  hash.update(value);
  hash.update(";");
}
```

Checksum these public fields only: review ID, store ID, provider, body,
normalized body, rating or empty marker, published date, collected time,
and source run ID.

- [x] **Step 5: Implement the app transaction**

Within `appDatabase.client.transaction`:

1. insert `BUILDING` version with zero counts/checksum
2. upsert validated documents
3. delete rows older than the cutoff
4. update every remaining row to the new `publish_version_id`
5. load review and FTS rows in `review_id` order
6. reject any ID, store, normalized body, count, or checksum mismatch
7. clear prior active slots and mark old rows `SUPERSEDED`
8. activate the new version and insert active index state

Never open the raw database or decrypt inside this transaction.

- [x] **Step 6: Verify GREEN and rollback behavior**

Run:

```powershell
corepack pnpm test apps/worker/src/reviews/publish-review.test.ts
corepack pnpm test packages/app-db/src/schema/reviews.test.ts packages/retrieval/src/sqlite-review-repository.test.ts
```

Expected: PASS, including fresh queries proving the previous active
version survives each failure case.

- [x] **Step 7: Inspect the task diff**

Run:

```powershell
git status --short
git diff --check
git diff -- apps/worker/src/reviews/publish-review.ts apps/worker/src/reviews/publish-review.test.ts apps/worker/package.json
```

Confirm no plaintext is present in thrown errors or diagnostic output.

---

### Task 4: Boundary, delivery, and complete Feature gate

**Files:**

- Modify: `scripts/check-workspace-boundaries.ts`
- Modify: `scripts/check-workspace-boundaries.test.ts`
- Modify: `package.json`
- Modify: `docs/README.md`
- Modify: `docs/10-delivery/README.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Interfaces:**

- Produces root script `test:reviews:feature5`
- Preserves `check:boundaries` as the automated web/raw security gate

- [x] **Step 1: Write the failing boundary test**

Create a temporary web source that imports:

```ts
import { publishReviewRun } from "../../../worker/src/reviews/publish-review";
```

Run the boundary scanner and expect it to reject the file with a safe
publisher-boundary finding. The production change this catches is a web
developer directly importing the worker-only decryption publisher.

- [x] **Step 2: Run and verify RED**

Run:

```powershell
corepack pnpm test scripts/check-workspace-boundaries.test.ts
```

Expected: FAIL because the new publisher symbol/path is not blocked.

- [x] **Step 3: Extend the boundary and root Feature script**

Add publisher path/symbol detection without weakening existing raw path,
secret, locator, or collector rules.

Add:

```json
"test:reviews:feature5": "vitest run packages/app-db/src/schema/reviews.test.ts packages/retrieval/src/sqlite-review-repository.test.ts apps/worker/src/reviews/publish-review.test.ts scripts/check-workspace-boundaries.test.ts"
```

- [x] **Step 4: Update delivery documents**

Record:

- Feature 5 fixture implementation complete
- no new external preparation or cost
- exact migration and targeted test commands
- raw-to-app publication remains worker-only
- FTS failure returns an unavailable state for Feature 6 fallback
- live Kakao collection remains a separate operator gate

- [x] **Step 5: Run targeted and full verification**

Run, in this order:

```powershell
corepack pnpm test:reviews:feature5
corepack pnpm db:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Expected:

- all commands exit `0`
- no tests are skipped for Feature 5
- no external key or network call occurs
- the build contains no OpenAI dependency or route

- [x] **Step 6: Review requirements and final diff**

Re-read the Feature 5 section of the master plan and the design
acceptance criteria. Then run:

```powershell
git status --short
git diff --check
git diff --stat
```

Inspect every changed file. Record any unrun live checks separately;
Feature 5 has no required live external check.
