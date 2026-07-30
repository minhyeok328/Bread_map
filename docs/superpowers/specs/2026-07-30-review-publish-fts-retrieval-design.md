# Review Publish and FTS Retrieval Design

**Status:** Approved by delegated implementation authority

**Date:** 2026-07-30

**Feature:** Local MVP Feature 5

## 1. Goal

Publish only Feature 4's successfully deidentified, encrypted review
payloads from worker-only `raw.sqlite` into the public `app.sqlite`
corpus, keep the review rows and FTS5 index consistent for every
insert, update, and delete, and expose a package-level retrieval
interface that Feature 6 can consume without raw database access.

The completed slice must be replay-safe, preserve the last active
corpus when a new publish fails, and add no external service, LLM, or
paid dependency.

## 2. Scope

Included:

- `app.sqlite` review document, publish version, and FTS index state
  schema and migration
- an FTS5 table maintained by SQLite triggers
- worker-only raw review decryption and publication
- complete and partial Feature 4 run handling
- deterministic review text normalization and FTS query escaping
- a SQLite review repository and stable retrieval contract
- fixture-level migration, publish, replay, failure, and retrieval tests
- delivery documentation and a Feature 5 verification command

Excluded:

- structured store search and recommendation ranking, owned by
  Feature 6
- authentication and account data, owned by Feature 7
- web routes, map APIs, and UI
- live Kakao review collection
- OpenAI, embeddings, vector search, and remote deployment

## 3. Approaches Considered

### A. Feature-by-feature vertical slices

Finish schema, worker publication, retrieval, and direct verification
for Feature 5 before Feature 6 consumes the contract.

This exposes integration failures early and keeps raw access out of the
web package. It requires a small amount of interface work now but leaves
each later Feature independently testable.

### B. Build all storage and service layers before integration

Create schemas for Features 5-8 first, then connect worker, retrieval,
recommendation, and web code later.

This reduces early context switching but defers the most important
database and security integration checks. A wrong review contract would
spread through several unfinished layers.

### C. Build UI and API stubs first

Make the map and review experience visible immediately, then replace
fixtures with real repositories.

This gives fast visual progress but makes it easy for fake data and
temporary contracts to become production behavior. It also delays proof
that encrypted raw input can be published safely.

**Selected:** A. Feature-by-feature vertical slices.

## 4. Components and Boundaries

### `packages/app-db`

Owns the public review schema and the FTS5 migration. It never imports
raw database code or encryption keys.

### `apps/worker`

Owns the only raw-to-app publication path. It reads a terminal Feature 4
run, resolves encryption keys by version, decrypts payloads in memory,
validates public-store ownership, and performs one short app database
transaction.

### `packages/retrieval`

Owns the review retrieval interface, query normalization, safe FTS5
query construction, and the SQLite adapter. It depends on
`@bread-map/app-db`, not `@bread-map/raw-db`, and contains no ranking,
UI, or LLM behavior.

### `apps/web`

May consume `packages/retrieval` in later Features. It must remain unable
to import raw repositories, raw paths, review secrets, or the publisher.

## 5. Public Review Data Model

### `review_publish_version`

One row records each attempted corpus transition:

- `version_id`: deterministic ID derived from source run ID and publish
  contract version
- `source_run_id`: logical reference to the raw collection run
- `source_run_status`: `SUCCEEDED` or `PARTIAL`
- `source_as_of_date`: Feature 4's fixed `YYYY-MM-DD`
- `status`: `BUILDING`, `ACTIVE`, or `SUPERSEDED`
- `active_slot`: nullable integer constrained to `1`, with a unique
  index so at most one version is active
- `document_count`, `fts_document_count`, and `corpus_checksum`
- `published_at_ms`

`source_run_id` is unique. Replaying the currently active source run
returns its existing summary without writing duplicates. Replaying a
superseded source run does not reactivate stale data.

### `review_document`

Each public row contains:

- stable `review_id`
- published `store_id` with an app database foreign key
- provider fixed to `KAKAO_MAP`
- deidentified `body` and separately normalized `normalized_body`
- nullable `rating_basis_points` in `0..5000`
- source `published_date` and `collected_at_ms`
- original `source_run_id`
- current `publish_version_id`

Nickname, fingerprint, ciphertext, nonce, authentication tag, key
version, raw locator, and exact user location are forbidden.

Rows older than the current run's 12-month calendar cutoff are deleted
from the public corpus. February 29 cutoffs clamp to February 28 in a
non-leap target year.

### `review_fts`

`review_fts` is a regular FTS5 virtual table with:

- stored, unindexed `review_id`
- stored, unindexed `store_id`
- indexed `normalized_body`
- `unicode61 remove_diacritics 2` tokenization

A regular FTS table is selected over an external-content table so
`COUNT(*)` reflects actual FTS documents instead of silently reading
through the content table. SQLite triggers maintain the FTS row with the
same rowid as `review_document`:

- after insert: insert the FTS row
- after update: delete the old FTS row and insert the new row
- after delete: delete the FTS row

### `fts_index_state`

The active state records:

- `index_version`, initially `review-fts-unicode61-v1`
- active `publish_version_id`
- document count and corpus checksum
- `ACTIVE` or `SUPERSEDED`
- the unique nullable `active_slot`
- `built_at_ms`

The publish transaction activates the version and index state only after
document counts and checksums agree.

## 6. Publish Flow

1. Load the requested raw collection run.
2. Reject non-terminal statuses. Accept only `SUCCEEDED` and `PARTIAL`.
3. If the source run was already published, verify the active document,
   FTS rowid/content, checksum, public-store ownership, and index metadata
   before returning its existing summary. Never report a corrupted replay
   as successful.
4. Load only ciphertext rows owned by that run.
   If fewer rows remain than the terminal run's committed
   `collected_count`, reject the incomplete input. Additional valid rows
   are allowed because Feature 4 can commit ciphertext before its crash
   recovery counter checkpoint.
5. Require unexpired run, observation, and ciphertext retention; require
   the observation to be `MATCHED_ELIGIBLE` for the same store and
   discovery run.
6. Require the ciphertext key version to equal the source run's recorded
   fingerprint key version, then resolve its exact 32-byte AES key.
7. Decrypt with the existing review AAD contract using the row's
   `review_id`, `store_id`, and provider.
8. Validate the decrypted payload, reject a published date later than
   the run's fixed as-of date, and normalize its body. Never log the
   plaintext or include it in an error.
9. Verify every referenced app store exists with
   `catalog_status='published'` and `business_status='active'`.
10. Compute the 12-month calendar cutoff from the run's as-of date.
11. In one `app.sqlite` transaction:
    - reject a never-published run whose as-of date predates the active
      version
    - insert the version as `BUILDING`
    - upsert decrypted documents by stable `review_id`
    - delete public documents older than the cutoff
    - associate every remaining document with the new corpus version
    - let triggers update FTS rows
    - compute deterministic content and FTS counts and corpus checksum
    - require row-for-row review/FTS identity and text equality
    - supersede the prior active version and index state
    - activate the new version and index state
12. Return a non-sensitive summary.

There is intentionally no cross-file transaction. Raw input is loaded
and validated before the app transaction. If any validation, SQL, or FTS
check fails, the app transaction rolls back and the prior active version
remains unchanged.

### Partial run behavior

A `PARTIAL` run can add or update its successfully collected reviews,
but absence from that run never deletes an existing non-expired review.
This preserves working data for failed stores. The active version records
partial completeness so later APIs can expose stale or partial state.

### Incremental run behavior

Incremental runs contain only new reviews. Publication therefore merges
by stable review ID and removes only documents outside the universal
12-month cutoff. It never treats a missing review as provider deletion.

## 7. Retrieval Contract

`ReviewRepository` provides:

- `searchReviews(input)`
- `listStoreReviews(input)`
- `getActiveIndexState()`

Search input contains normalized text, optional store IDs, and a bounded
limit. Text is NFKC-normalized, lowercased, collapsed for whitespace,
split into Unicode letter/number tokens, and encoded as quoted FTS terms.
No caller-provided FTS operator is executed.

Search output contains review ID, store ID, deidentified body, nullable
rating, published date, and a text snippet. Internal `bm25` rank is used
only for deterministic ordering and is not part of the public result
contract.

Ordering is:

1. `bm25(review_fts)` ascending
2. `published_date` descending
3. `review_id` ascending

An FTS operational error returns an explicit `UNAVAILABLE` result with
no hits. Feature 6 will then apply the documented menu, category,
business, distance, and completeness fallback rather than fabricating a
review score or snippet.

## 8. Error and Security Contract

Worker publish errors use safe codes only:

- `REVIEW_PUBLISH_RUN_NOT_FOUND`
- `REVIEW_PUBLISH_RUN_NOT_TERMINAL`
- `REVIEW_PUBLISH_KEY_UNAVAILABLE`
- `REVIEW_PUBLISH_DECRYPT_FAILED`
- `REVIEW_PUBLISH_STORE_NOT_PUBLIC`
- `REVIEW_PUBLISH_FTS_INCONSISTENT`
- `REVIEW_PUBLISH_STALE_REPLAY`
- `REVIEW_PUBLISH_INPUT_EXPIRED`
- `REVIEW_PUBLISH_INPUT_NOT_ELIGIBLE`
- `REVIEW_PUBLISH_INPUT_KEY_VERSION_MISMATCH`
- `REVIEW_PUBLISH_INPUT_INCOMPLETE`
- `REVIEW_PUBLISH_INPUT_INVALID`
- `REVIEW_PUBLISH_DATABASE_UNAVAILABLE`

Error messages, logs, and summaries must not contain review body,
ciphertext, nickname, fingerprint, nonce, tag, key, absolute database
path, or provider locator.

The publisher is worker-only. Workspace boundary tests must continue to
reject raw database, raw secret, locator, collector, and publisher
imports from the web package.

### Operational constraints

- Feature 4 currently derives stable review IDs from an HMAC fingerprint
  while one key-version label identifies the encryption and fingerprint
  inputs. Rotating the HMAC key can therefore change review IDs. Do not
  perform an operational HMAC rotation until a stable-ID migration and
  duplicate reconciliation path is designed.
- Publication is an app-database transaction, not a pre-publish backup.
  Large-corpus snapshot, restore, integrity, and representative search
  gates belong to Feature 10's local release recovery flow.
- A missing raw row is not a deletion signal. Only the universal
  12-month public cutoff removes an absent review. If a row counted as a
  committed insert is no longer present, publication fails as incomplete
  instead of interpreting the loss as an empty delta.
- Moving a store away from published·active is a fail-closed,
  non-restorative purge of its current public review documents and FTS
  rows. Returning that store to published does not resurrect the deleted
  reviews from a hidden archive; only newly collectible reviews enter the
  corpus. A reversible quarantine/archive would require a separately
  approved data-retention design.

## 9. Verification Strategy

### Schema integration

- blank and existing app databases migrate idempotently
- required tables, virtual table, indexes, and triggers exist
- insert, update, and delete keep review and FTS rows identical
- invalid provider, rating, date, or unpublished store is rejected

### Publisher integration

- a real encrypted Feature 4 fixture decrypts and publishes
- replaying the same run creates no duplicate document or version
- an incremental run merges new rows without deleting current rows
- a partial run preserves reviews for failed or absent stores
- the 12-month cutoff removes both document and FTS rows
- missing keys, tampered ciphertext, unpublished stores, expired raw
  input, future-dated payloads, ineligible observations, and key-version
  mismatches roll back without replacing the prior active version
- app rows and FTS rows have matching review IDs, store IDs, normalized
  bodies, counts, and checksum

### Repository contract

- Hangul and normalized Unicode terms retrieve expected reviews
- optional store filtering cannot widen the result set
- FTS syntax characters are treated as text, not operators
- empty and over-limit inputs are rejected
- ordering is deterministic
- list-by-store returns only public deidentified fields
- FTS failure returns `UNAVAILABLE`
- physical FTS rowid/content or public-store mismatch returns
  `UNAVAILABLE`

### Feature gate

The Feature is complete when targeted tests, the full workspace test
suite, typecheck, lint, migration checks, and production build pass
without external keys, Docker, OpenAI, or live Kakao access.

## 10. Downstream Contract

Feature 6 may consume only `ReviewRepository` and its public result
types. It must not query `review_fts` directly or import app/raw database
internals. Feature 8 may later expose deidentified snippets and dates,
while internal FTS ranks remain server-only.
