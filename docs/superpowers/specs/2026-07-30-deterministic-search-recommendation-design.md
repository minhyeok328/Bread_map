# Deterministic Search and Recommendation Design

**Status:** Approved by delegated implementation authority

**Date:** 2026-07-30

**Feature:** Local MVP Feature 6

## 1. Goal

Provide a version-checked structured search service that combines the
published store catalog, verified menu and alias evidence, opening
hours, public review aggregates, and Feature 5 FTS retrieval without
OpenAI or another external service.

The completed slice must apply hard exclusions before relevance,
continue without fabricated review evidence when FTS is unavailable,
produce the same store order for the same input and versions, and meet
the fixed-fixture quality and latency gates.

## 2. Scope

Included:

- a strict `StructuredSearchInput` and public result contract
- approved search normalization and synonym expansion
- versioned app schema plus a strict local importer for verified menu,
  alias, and weekly opening evidence
- an explicit active-catalog publish pointer and stale-replay guard
- one opaque search-data version covering catalog, verified evidence,
  and the active review corpus
- an app-only SQLite store-search repository
- server-internal per-store FTS evidence with no public score
- pure hard-filter, distance, opening-state, ranking, and explanation
  functions
- a retrieval service that composes repositories with the pure
  recommendation package
- a 30-store, 50-menu, exactly 20-scenario fixture evaluation
- Hit Rate@5, hard-exclusion, 100-run determinism, fallback, and p95
  gates
- delivery documentation and a root Feature 6 verification command

Excluded:

- natural-language interpretation, LLM explanations, embeddings, and
  vector search
- browser routes, server APIs, authentication, map SDK calls, and UI
- external menu or opening-hours collection
- Kakao Route travel-time ranking
- persistence of request origin, search history, or selection history
- live-provider quality claims

## 3. Approaches Considered

### A. Repository facts plus a pure recommendation engine

SQLite loads versioned public facts and Feature 5 provides FTS
evidence. Pure TypeScript functions apply filters, ranking, and public
reason construction.

This keeps database access out of recommendation logic, makes every
comparison key directly testable, and allows later API or UI code to
consume one stable service.

### B. One SQL query for filtering and ranking

SQLite can calculate most flags and sort keys in one query. It reduces
round trips, but mixes product rules with SQL, makes fallback behavior
hard to test in isolation, and risks exposing internal FTS rank.

### C. A denormalized materialized search index

A precomputed table can make reads cheap, but it requires another
publish lifecycle and invalidation protocol before current local data
volume justifies it.

**Selected:** A. Repository facts plus a pure recommendation engine.

## 4. Ownership and Dependency Direction

### `packages/contracts`

Owns input enums, validation, public result fields, error codes, and the
Feature 6 version constants.

### `packages/app-db`

Owns relational tables for verified search evidence. It does not own
query normalization or ranking.

### `packages/recommendation`

Owns only pure data transformations:

- structured query normalization and approved synonyms
- distance and opening-state calculation
- hard filters and stage counts
- deterministic comparison keys and Bayesian rating adjustment
- public reason, warning, and relaxation construction

It depends on contracts and accepts candidate facts. It does not open a
database or call FTS.

### `packages/retrieval`

Owns the SQLite store repository, server-internal review evidence query,
and orchestration service. It depends on app DB, contracts, and the pure
recommendation package. It never opens `raw.sqlite`.

### `apps/web`

May consume the Feature 6 service in Feature 8. Feature 6 adds no web
route and does not weaken the raw/worker boundary.

## 5. Versions and Initial Vocabulary

The initial constants are:

- `SEARCH_CONTRACT_VERSION = "structured-search-v1"`
- `RECOMMENDATION_VERSION = "recommendation-v1"`
- `SEARCH_ALIAS_VERSION = "search-alias-v1"`
- `SEARCH_EVIDENCE_VERSION = "search-evidence-v1"`
- `RATING_PRIOR_VERSION = "rating-prior-v1"`

The initial verified menu category enum is:

- `FERMENTED_BREAD`
- `PASTRY`
- `SALT_BREAD`
- `BAGUETTE`
- `LOAF_BREAD`
- `SWEET_BREAD`
- `SANDWICH`
- `DESSERT`

Category IDs are stable machine values. Korean labels belong to the
later UI contract.

The approved synonym dictionary is exact and versioned. Its initial
groups include:

- `사워도우`, `sourdough`, `천연발효빵`
- `크루아상`, `크로와상`, `croissant`
- `페이스트리`, `패스트리`, `pastry`
- `소금빵`, `시오빵`
- `바게트`, `baguette`
- `식빵`, `loaf`

Synonyms expand only an explicit store, menu, or review query. They
never create a menu record, category fact, or recommendation reason.

## 6. Verified Search-Evidence Schema

### `search_evidence_publish`

A verified evidence batch is immutable after publication and contains:

- `publish_id`
- the exact active `input_catalog_publish_id`
- `contract_version = 'search-evidence-v1'`
- `status`: `BUILDING`, `ACTIVE`, or `SUPERSEDED`
- singleton `active_slot = 1` only for `ACTIVE`
- menu, store-alias, menu-alias, and business-hour row counts
- a canonical SHA-256 `corpus_checksum`
- `published_at_ms`

A strict worker-side local JSON importer validates all rows, store
membership, aliases, hours, overlap, evidence references, and the
caller-provided active catalog version before opening its transaction.
It derives the publish ID and checksum from canonical validated
content, inserts an immutable batch, supersedes the prior batch, and
activates the new batch atomically. Re-importing identical content is
idempotent; the same derived ID with different content fails closed.
No network source is contacted.

Child rows may be inserted only while their publish is `BUILDING`.
Activation checks the declared menu, store-alias, menu-alias, and
business-hour counts exactly once, then changes the publish to
`ACTIVE`. This keeps maximum valid imports linear while preserving
fail-closed counts. `ACTIVE` and `SUPERSEDED` children are immutable,
and a failed activation rolls back without replacing the previous
active publish.

### `menu`

Each verified menu row belongs to one evidence publish and contains:

- `menu_id`
- `evidence_publish_id`
- `store_id`
- display `name` and `normalized_name`
- one category from the initial enum
- `source = 'MANUAL_VERIFIED'`
- non-empty `evidence_ref`
- `verified_at_ms`

The unique key is
`(evidence_publish_id, store_id, normalized_name)`. Only rows attached
to the active evidence publish that targets the active catalog may
match or count as evidence.

### `store_alias`

Each approved store-scoped alias contains:

- `alias_id`
- `evidence_publish_id`
- `store_id`
- `alias_type`: `STORE_NAME` or `REGION`
- display `alias` and `normalized_alias`
- `source = 'MANUAL_VERIFIED'`
- non-empty `evidence_ref`
- `verified_at_ms`

`STORE_NAME` aliases are used only for `storeName`; `REGION` aliases
represent approved station, neighborhood, or local-area terms and are
used only for `region`.

### `menu_alias`

Each approved menu alias contains:

- `alias_id`
- `menu_id`
- display `alias` and `normalized_alias`
- `source = 'MANUAL_VERIFIED'`
- non-empty `evidence_ref`
- `verified_at_ms`

The unique key is `(menu_id, normalized_alias)`.

### `store_business_hour`

Each weekly interval contains:

- `interval_id`
- `evidence_publish_id`
- `store_id`
- `weekday` in `0..6`, where `0` is Sunday in Asia/Seoul
- `sequence` for split opening intervals
- `opens_minute` and `closes_minute` in `0..1439`
- `closes_next_day` as `0` or `1`
- `source = 'MANUAL_VERIFIED'`
- non-empty `evidence_ref`
- `verified_at_ms`

A same-day interval requires `closes_minute > opens_minute`. An
overnight interval requires `closes_minute <= opens_minute`. Missing
rows mean `UNKNOWN`; they are not interpreted as closed. Overlapping
intervals are invalid fixture or operator input and are rejected by
repository validation.

These tables hold verified facts only. The current LOCALDATA source has
no menu or opening-hours fields. Feature 6 supplies an auditable local
import path and proves behavior with reviewed fixtures, but does not
claim that missing live facts were collected, independently reviewed,
or inferred.

### `catalog_publish_state`

The singleton active-catalog row contains:

- fixed `state_id = 'active'`
- the active `publish_id`
- the corresponding `snapshot_id`
- the snapshot's ISO `source_basis_date`
- the snapshot's `source_downloaded_at_ms`
- `updated_at_ms`

Both IDs are foreign keys with restrictive deletion. The migration
backfills the row from the greatest successful publish by source basis
date descending, source download time descending, snapshot ID
descending, publish time descending, then publish ID ascending when an
existing database already has successful publishes. An empty database
remains without an active row until its first successful catalog
publish.

Catalog publication reads the incoming snapshot's total order
`(basis_date, downloaded_at_ms, snapshot_id)` before mutating catalog
rows. It rejects a tuple older than the active row with a safe
stale-source error. A successful publish demotes stores absent from the
incoming snapshot, lets the existing unpublish trigger purge their
public reviews, supersedes evidence tied to an older catalog, writes
the publish record, and replaces the singleton active row in the same
transaction. Replaying the same snapshot and versions is idempotent;
it may refresh the same active pointer but cannot move it backwards.

## 7. Structured Input Contract

`StructuredSearchInput` contains:

```ts
interface StructuredSearchInput {
  region: string | null;
  storeName: string | null;
  menuName: string | null;
  categories: readonly {
    category: MenuCategory;
    mode: "INCLUDE" | "EXCLUDE";
  }[];
  openNow: boolean;
  origin: {
    latitudeE7: number;
    longitudeE7: number;
  } | null;
  maxDistanceM: number | null;
  reviewEvidenceStatus:
    | "ANY"
    | "AVAILABLE"
    | "INSUFFICIENT";
  sortMode: "RELEVANCE" | "DISTANCE";
  dataSnapshotVersion: string;
  recommendationVersion: "recommendation-v1";
}
```

Validation rules:

- optional text is trimmed and has length `1..100` when non-null
- categories contain at most eight unique category IDs
- the same category cannot be both included and excluded
- `maxDistanceM` is an integer in `1..100000` and requires `origin`
- `DISTANCE` requires `origin`
- coordinates are finite E7 integers in global latitude/longitude
  bounds
- `dataSnapshotVersion` is a non-empty ID of at most 128 characters
- the exact recommendation version is required
- unknown fields are rejected

`requestTimeMs` is required execution context, not persisted input. It
must be a nonnegative safe integer and is interpreted in Asia/Seoul.
The request origin exists only in validated request memory. Results,
errors, filter summaries, logs, and evaluation reports never include
the origin coordinates.

## 8. Query Normalization

Text normalization:

1. applies Unicode NFKC
2. lowercases with the Korean locale
3. converts control characters and punctuation to spaces
4. collapses whitespace and trims
5. builds a compact letter/number key for exact dictionary and
   substring matching

Synonym expansion returns a stable, de-duplicated list with the
canonical Korean term first. Unknown terms return only their normalized
form. Region, store, and menu terms use separate approved alias fields;
an alias from one field cannot widen another field.

## 9. SQLite Candidate Snapshot and Composite Version

The repository resolves the singleton `catalog_publish_state` row and
joins it to a `SUCCEEDED` `data_publish` and its source snapshot.
It also resolves the active verified-evidence publish when its
`input_catalog_publish_id` equals the active catalog, and the consistent
active review publish/index state when available.

The opaque `dataSnapshotVersion` is
`search-data-v1_<sha256>` over a canonical tuple containing:

- active catalog publish ID, source snapshot ID, source basis/download
  metadata, and a canonical checksum of the active public candidate
  facts
- active evidence publish ID and checksum, or fixed `NONE` sentinels
- active review publish ID and corpus checksum, or fixed `NONE`
  sentinels
- the consistent active FTS state ID, index version, and checksum, or
  fixed `NONE` sentinels

The input version must equal this complete value. A missing active
catalog fails with `SEARCH_DATA_UNAVAILABLE`; a stale or unknown
composite version fails with `SEARCH_DATA_VERSION_MISMATCH`. A public
snapshot-inspection method exposes the current opaque version and safe
component IDs so a later API can bootstrap a request.

The catalog state basis/download metadata must equal the referenced
source-snapshot metadata. Any drift fails closed. Hashing the canonical
active candidate facts also changes the opaque version if catalog facts
change under an otherwise identical publish/snapshot identity.

Candidate, evidence, aggregate, and FTS reads execute synchronously in
one SQLite read transaction. The service validates the expected
composite version after the transaction has established its snapshot.
Concurrent evidence or review publication therefore produces either
the complete old view or the complete new view, never a mixed result.

Before loading candidates, the service compares the active
`source_basis_date` with the Asia/Seoul calendar date derived from
`requestTimeMs`. Future dates and dates more than exactly 30 calendar
days old fail closed with `SEARCH_DATA_STALE`. This source-age check
does not use `store.latest_verified_at_ms`: publication time is not
evidence that the upstream source itself is current.

The base candidate query loads only stores joined through
`store_source_link.snapshot_id` to the active catalog snapshot, whose
store and bakery are `catalog_status='published'`, whose business
status is `active`, and whose address and coordinate pair are present.
It then attaches rows from the matching active evidence publish and
active-corpus review aggregates.

Review aggregates contain:

- distinct public review count
- latest public review date
- rated review count
- sum of `rating_basis_points`

They come only from documents attached to the active review publish
version. Feature 6 uses every active public review in the current
12-month corpus; DR-036 removed the old per-store collection hard cap.

The repository returns facts in stable ID order. It does not apply
product ranking.

## 10. Review FTS Evidence

Feature 5's safe query builder and consistency checks remain the only
FTS entry point. `ReviewRepository` adds a server-internal evidence
method that returns at most one best real hit per store:

```ts
interface ReviewEvidenceHit {
  reviewId: string;
  storeId: string;
  publishedDate: string;
  snippet: string;
  internalRank: number;
}
```

`internalRank` is the SQLite `bm25` value and never enters a public
result, log, or evaluation artifact. The method returns all matching
stores for the bounded query instead of applying an arbitrary
candidate-count limit.

When `menuName` is non-null, the service queries canonical and approved
synonym terms in stable order. Per-store evidence comparison uses:

1. synonym term priority ascending
2. internal rank ascending
3. review published date descending
4. review ID ascending

An FTS error, missing active state, count mismatch, rowid/content
mismatch, or non-public document returns one `FTS_UNAVAILABLE` state
with no evidence hits.

When `menuName` is null, FTS is not needed and is not called.
Category-, store-, region-, opening-, distance-, and review-status-only
search remains `COMPLETE` even if no usable FTS index exists.

## 11. Hard Filters

Filters run before all ranking:

1. membership in the active source snapshot, current published
   catalog, active business, valid address and coordinates
2. normalized region or approved `REGION` alias match
3. normalized store name or approved `STORE_NAME` alias match
4. any requested excluded category removes a store
5. at least one requested included category must match when includes
   are present
6. `openNow=true` keeps only `OPEN`; `UNKNOWN` is not guessed open
7. `maxDistanceM` keeps only rounded distance within the bound
8. requested review evidence status
9. an explicit `menuName` requires either an active verified
    menu/alias match or a real FTS hit; when FTS is unavailable only the
    verified menu path remains

Every removal increments one primary `filterReasonCode` and the
corresponding stage count. A removed store cannot be restored by FTS,
review count, distance, completeness, or rating.

## 12. Derived Candidate Evidence

### Opening state

Opening state is `OPEN`, `CLOSED`, or `UNKNOWN`. The calculation checks
the current Asia/Seoul weekday interval and the previous weekday's
overnight interval. Interval starts are inclusive and closes are
exclusive.

### Distance

Distance uses the Haversine formula with Earth radius `6,371,000m` and
is rounded once to the nearest integer. Destination store coordinates
are public, while the exact rounded distance and request origin remain
process-local.

### Review status

- count `>= 3`: `AVAILABLE`
- count `0..2`: `INSUFFICIENT`

Insufficient reviews never remove an otherwise eligible store unless
the user explicitly selected `reviewEvidenceStatus='AVAILABLE'`.
Real snippets may still be shown with an insufficient warning, but FTS
rank does not influence ordering for that store.

### Completeness

The internal completeness key is an integer in `0..10000`:

- `3000`: at least one active verified menu
- `2500`: opening state is known
- `1500`: normalized phone exists
- `1500`: at least one active public review
- `1500`: at least three active public reviews

This value is never public.

### Adjusted rating

`rating-prior-v1` uses the rated-review global mean from the current
candidate snapshot with prior weight `5`. If no rated review exists,
the fixed prior mean is `4000` basis points. Each store's Bayesian mean
is rounded once to the nearest integer. The adjusted value is an
internal final tie helper only.

## 13. Deterministic Ranking

All descending and ascending directions are explicit and every
comparator ends with `store_id` ascending.

For `RELEVANCE`:

1. verified menu match descending
2. verified included-category match count descending
3. usable FTS evidence present descending
4. FTS `(term priority, internal rank, date, review ID)`
5. available review count descending
6. latest review date descending, null last
7. opening state `OPEN`, `UNKNOWN`, `CLOSED`
8. rounded distance ascending, null last
9. completeness descending
10. adjusted rating descending
11. store ID ascending

For `DISTANCE`:

1. verified menu match descending
2. verified included-category match count descending
3. usable FTS evidence and its comparison keys
4. available review count and latest date
5. rounded distance ascending, null last
6. opening state `OPEN`, `UNKNOWN`, `CLOSED`
7. completeness
8. adjusted rating
9. store ID ascending

FTS evidence is usable for ranking only when FTS is available and the
store has at least three reviews. A rating can never overtake a
different menu/category, review, visit, freshness, or completeness key.
`sortMode` changes only the order of visit-condition keys and does not
move distance ahead of review relevance.

## 14. Public Result

The result is:

```ts
interface StructuredSearchResult {
  status: "COMPLETE" | "PARTIAL";
  partialReason: "FTS_UNAVAILABLE" | null;
  items: readonly StructuredSearchItem[];
  metadata: {
    searchContractVersion: "structured-search-v1";
    recommendationVersion: "recommendation-v1";
    dataSnapshotVersion: string;
    catalogPublishId: string;
    searchEvidencePublishId: string | null;
    reviewPublishVersionId: string | null;
    sourceBasisDate: string;
    ftsIndexVersion: "review-fts-unicode61-v1" | null;
    aliasVersion: "search-alias-v1";
    ratingPriorVersion: "rating-prior-v1";
  };
  filterSummary: {
    initialCount: number;
    resultCount: number;
    reasonCounts: Readonly<Record<FilterReasonCode, number>>;
  };
  relaxationOptions: readonly RelaxationCode[];
}
```

Each item contains public store identity, display name, normalized
address, destination coordinates, a 250-meter distance upper-bound
bucket, opening state,
representative verified menus and categories with evidence IDs, review
status/count/latest date, one real snippet or null, public reason codes,
and warning codes.

It does not contain request origin, exact distance, internal FTS rank,
completeness, adjusted rating, comparison tuples, or a total score.
Exact rounded distance remains process-local for filtering and sorting.
For a non-null distance, the public `distanceUpperBoundM` is the
smallest positive multiple of 250 greater than or equal to the exact
rounded distance, with zero represented as 250. This reduces origin
reconstruction from public store coordinates and multiple results.

Representative menus are ordered by explicit menu match, included
category match, normalized name, and menu ID, then limited to three.
The map and list consumers receive the same complete `items` array.

When FTS is unavailable:

- result status is `PARTIAL`
- no snippet or review-text reason is returned
- menu, category, region, opening, distance, freshness, and stable
  ordering continue
- every item includes `FTS_UNAVAILABLE` warning
- no review score or text is fabricated

Relaxation options are stable codes in this order when applicable:

1. `EXPAND_REGION_OR_DISTANCE`
2. `DISABLE_OPEN_NOW`
3. `INCLUDE_INSUFFICIENT_REVIEWS`
4. `EXPAND_ADJACENT_CATEGORY`

They are suggestions only. The service never auto-relaxes a filter.

## 15. Errors

Safe service error codes are:

- `SEARCH_INPUT_INVALID`
- `SEARCH_DATA_UNAVAILABLE`
- `SEARCH_DATA_VERSION_MISMATCH`
- `SEARCH_DATA_STALE`
- `SEARCH_DATABASE_UNAVAILABLE`

Input validation details may identify the field but never include exact
origin values. Database errors are mapped to a safe code without an
absolute path or SQL text. FTS failure is a partial result, not a thrown
search failure.

## 16. Evaluation Fixture and Gates

`packages/testkit/src/search-scenarios.ts` owns deterministic,
non-sensitive data:

- at least 30 stores
- at least 50 active verified menus
- enough aliases and opening intervals for district, neighborhood, and
  station cases
- stores with 0, 1, 2, and at least 3 reviews
- ineligible, stale, closed-now, out-of-range, and category-excluded
  controls
- exactly 20 search-only structured scenarios listed below

| ID | Group | Counts toward Hit Rate@5 |
| --- | --- | --- |
| `region-district` | region | yes |
| `region-neighborhood-alias` | region | yes |
| `region-station-alias` | region | yes |
| `store-exact` | store | yes |
| `store-approved-alias` | store | yes |
| `menu-exact` | menu | yes |
| `menu-synonym` | menu | yes |
| `menu-review-fallback` | menu | yes |
| `category-include` | category | yes |
| `category-exclude` | category | yes |
| `open-now` | visit | yes |
| `overnight-open` | visit | yes |
| `distance-boundary` | visit | yes |
| `distance-sort` | visit | yes |
| `reviews-available` | evidence | yes |
| `reviews-insufficient` | evidence | yes |
| `combined-hard-filters` | combined | yes |
| `fts-unavailable-fallback` | degradation | yes |
| `version-mismatch` | expected error | no |
| `stale-source` | expected error | no |

Each case declares `countsTowardHitRate`; the Hit Rate denominator is
the 18 successful search cases. Expected-error cases are scored only
against their safe error and no-leak expectations.

Each scenario fixes input, expected candidate IDs, forbidden IDs,
expected top-five characteristics, fallback state, and stable order.
Unless a success case explicitly declares `PARTIAL`, its expected
status is `COMPLETE`. `menu-review-fallback` and
`fts-unavailable-fallback` are required-hit cases and must each return
an expected top-five store independently of the aggregate Hit Rate.

The automated evaluation must prove:

- Hit Rate@5 `>= 0.85`
- required-hit violations `= 0`
- hard-exclusion violations `= 0`
- 100 executions produce identical store, representative menu,
  category, reason, and evidence-ID order
- rating-only inversion count `= 0`
- FTS drop, metadata mismatch, and query failure retain structured
  results with no snippet
- after ten warm-ups, the p95 of 100 in-process fixture searches is
  below `1500ms`

The report contains versions, fixture ID, scenario counts, integer
durations, rates, and pass/fail values. It contains no origin
coordinates, review body, snippet, internal rank, or adjusted rating.

This fixture gate validates deterministic implementation behavior. It
does not replace the independent human review required before claiming
live recommendation quality.

Map rendering and account-isolation cases remain cross-feature E2E
checks for Features 7 through 10 and are not counted in the Feature 6
Hit Rate@5 denominator.

## 17. Acceptance Criteria

Feature 6 is complete when:

- the migration and schema constraints pass on fresh and existing app
  databases
- stale catalog replay and stale active source data fail closed
- contract normalization rejects every invalid cross-field case
- strong exclusions precede FTS and rating
- menu/category, open-now, distance, and review-status filters work
- review-insufficient and FTS-unavailable fallbacks return no fake
  evidence
- both sort modes and all null ties end at stable store ID order
- the 20-scenario quality, 100-run determinism, and p95 gates pass
- boundary, typecheck, lint, full tests, migration checks, and
  production build pass
- no external key, network, OpenAI, or paid service is used

## 18. Downstream Contract

Feature 8 may expose `StructuredSearchResult` through a server API and
use the same `items` array for map and list views. It may not add a
numeric score, persist request origin, query `review_fts` directly, or
relax hard exclusions.

Feature 9 may translate public reason and warning codes into approved
copy. Feature 10 will include the evaluation report in the local
release gate.
