# Store and Map Server API Design

## 1. Scope

Feature 8 exposes the approved Feature 6 deterministic search result and a
snapshot-consistent public store detail read model through authenticated
Next.js route handlers.

This design follows the document ownership rules in `docs/README.md`:

- `docs/00-product/prd.md` owns the current local MVP and deferred Features.
- `docs/04-architecture/system-architecture.md` owns the web, app database,
  retrieval, map, and failure-isolation boundaries.
- `docs/06-trust/security-design.md` owns exact-location minimization and
  public error behavior.
- `docs/superpowers/specs/2026-07-30-deterministic-search-recommendation-design.md`
  owns the complete `StructuredSearchResult.items` array and its privacy
  contract.

Feature 8 does not call Kakao Route, OpenAI, or any other paid service. Kakao
Route travel times and alternatives are explicitly deferred by the current
PRD and system architecture. The older Feature 8 checklist entry for
`/api/routes` is a superseded online-P0 remnant and is corrected as part of
this Feature.

## 2. Approved Outcomes

Feature 8 provides:

1. an authenticated `POST /api/stores` structured-search endpoint;
2. an authenticated `GET /api/stores/[storeId]` detail endpoint;
3. strict, versioned Zod wire contracts;
4. a current-snapshot bootstrap when the first search has no version;
5. the same complete search `items` array for map and list consumers;
6. full verified menu and business-hour evidence in store detail;
7. rating and paged deidentified reviews from the active public corpus;
8. explicit current, warning, insufficient, and unavailable states;
9. safe public error codes with no SQL, stack, path, secret, exact origin, or
   raw-worker detail;
10. a `MAP_UNAVAILABLE` client-state contract that keeps the original search
    items, including address, public destination coordinates, and the existing
    250-meter straight-line distance upper-bound bucket.

## 3. Resolved Documentation Conflicts

### Kakao Route

DR-016 and DR-017 describe the older online P0. DR-033 and the current owner
documents narrowed the local MVP to Kakao Map display and deferred Kakao Route.
Feature 8 therefore creates no route adapter and no `/api/routes` endpoint.
Feature 9 owns browser SDK loading and changes only map presentation state to
`MAP_UNAVAILABLE` when the SDK fails.

No fake marker, route, travel time, or transport alternative is generated.

### Pagination

Feature 6 requires every passing candidate in one complete
`StructuredSearchResult.items` array, and the experience documents require
the map and drawer to use that same set. Store search is therefore not
paginated or arbitrarily truncated.

Only the potentially unbounded detail review collection is paginated:

- `reviewPage`: integer `1..1000`, default `1`
- `reviewLimit`: integer `1..20`, default `10`

Unknown parameters, duplicate parameters, numeric ambiguity, and values
outside the caps are rejected.

### Exact Distance

“Keep straight-line distance” means keeping the Feature 6 public
`distanceUpperBoundM` value. It never means returning exact meters. Exact
origin and exact rounded distance remain request-local and are absent from
responses, errors, logs, history, SQLite, and analytics.

## 4. Wire Contracts

### Search request

`POST /api/stores` uses a JSON body rather than URL coordinates:

```ts
interface StoreSearchRequest {
  query: Omit<StructuredSearchInput, "dataSnapshotVersion">;
  dataSnapshotVersion: string | null;
}
```

The nested `query` reuses all Feature 6 validation, including:

- text normalization limits;
- closed category, review, and sort enums;
- unique category filters;
- origin coordinate bounds;
- `maxDistanceM` requiring an origin;
- distance sorting requiring an origin;
- exact rejection of unknown fields.

`dataSnapshotVersion=null` is allowed only as first-search bootstrap. The
server reads the active opaque version and executes the search against it.
An explicit stale version fails with `SEARCH_DATA_VERSION_MISMATCH`; it is
never silently upgraded.

The successful response is the existing `StructuredSearchResult` without a
second marker collection. Both map and list derive their store IDs and order
from the exact same `result.items` reference.

### Store detail request

`GET /api/stores/[storeId]` requires:

```text
?dataSnapshotVersion=<search-data-v1_...>
&reviewPage=<1..1000>
&reviewLimit=<1..20>
```

The snapshot version is mandatory because detail is opened from a selected
search result. A direct request for a missing, inactive, excluded, or
out-of-snapshot store returns the same `RESOURCE_NOT_FOUND`.

### Store detail response

The response contains:

- public store and bakery IDs;
- display name, normalized address, district, optional phone, and public
  destination coordinates;
- opening state at request time;
- all active verified menus and categories;
- all active verified business-hour intervals;
- evidence ID, `MANUAL_VERIFIED` source, and verification time for each
  verified fact;
- raw average rating basis points only as secondary factual detail, with rated
  and total review counts;
- paged deidentified review body, publication date, optional rating, and
  `KAKAO_MAP` provider;
- review state: `AVAILABLE`, `INSUFFICIENT`, or `UNAVAILABLE`;
- menu and business-hour section state: `AVAILABLE` or `UNAVAILABLE`;
- source freshness state: `CURRENT` through 7 calendar days and `WARNING`
  through 30 calendar days;
- catalog, evidence, review, and opaque data snapshot versions.

Evidence reference URLs or local paths are not public. Traceability uses
stable evidence IDs, source labels, verification times, and publish/snapshot
versions.

When the active review corpus is unavailable or inconsistent, verified store,
menu, and hour facts still return while the review section is explicitly
`UNAVAILABLE`. Review count `0..2` is `INSUFFICIENT` and never hides the store.

## 5. Server Architecture

`apps/web` may consume only the safe package facade:

- `resolveCurrentSqliteSearchDataVersion()`
- `executeSqliteStoreSearch()`

It may not import SQLite repository classes, execute FTS directly, or use
internal ranking facts. The existing workspace boundary guard remains active.

`search-service.ts` owns:

- exact-origin POST and authentication checks;
- strict request parsing;
- first-search snapshot bootstrap;
- safe Feature 6 error-to-HTTP mapping.

`store-detail-service.ts` owns:

- strict path/query parsing;
- snapshot validation by the safe search facade;
- read-only app-database queries scoped to the selected active snapshot
  components;
- independent menu/hour/review section states;
- safe database-error mapping.

Every operation is synchronous inside a bounded SQLite read transaction.
No transaction waits for a network call.

## 6. Authentication and Request Safety

Both endpoints require the revocable Feature 7 principal.

Search uses POST so exact coordinates do not enter URL, browser history,
access logs, or query strings. It also requires the exact local
`http://127.0.0.1:3000` Origin before body parsing.

Detail uses GET and carries no user location. The client cannot send
`user_id`; the authenticated principal is checked but no account-owned data
is joined into these public-store reads.

The route handlers do not log request bodies. Tests use a sentinel exact
origin and assert it is absent from serialized success and failure responses.

## 7. Error Contract

| Condition | HTTP | Public code |
|---|---:|---|
| missing/invalid Origin | 403 | `ORIGIN_REQUIRED` |
| no active principal | 401 | `AUTHENTICATION_REQUIRED` |
| invalid JSON, body, path, or query | 400 | `SEARCH_INPUT_INVALID` |
| missing/non-public store | 404 | `RESOURCE_NOT_FOUND` |
| explicit snapshot changed | 409 | `SEARCH_DATA_VERSION_MISMATCH` |
| source newer than request or older than 30 days | 503 | `SEARCH_DATA_STALE` |
| unusable snapshot component | 503 | `SEARCH_DATA_UNAVAILABLE` |
| SQLite execution failure | 503 | `SEARCH_DATABASE_UNAVAILABLE` |
| unexpected implementation failure | 500 | `INTERNAL_ERROR` |

Responses contain only `{ "error": { "code": "..." } }`. They do not contain
validation detail, SQL, stack, database path, review raw data, request body, or
exact origin.

## 8. Map Failure Boundary

The server result is independent of Kakao Map availability. A Feature 9 client
can convert its presentation state from `READY` to `MAP_UNAVAILABLE` without
changing or copying the search result:

```ts
interface StoreMapState {
  status: "READY" | "MAP_UNAVAILABLE";
}
```

On `MAP_UNAVAILABLE`, the UI retains the search result's:

- deterministic item order and IDs;
- names and normalized addresses;
- public store coordinates;
- 250-meter distance upper-bound buckets;
- opening, menu, review, reason, and warning facts;
- detail-selection capability.

The user can retry the SDK or continue through the list. No server route,
external request, secret, quota, or cost is needed to prove this fallback.

## 9. Verification

Automated verification uses a migrated temporary SQLite fixture and proves:

- strict request/query bounds and unknown-field rejection;
- unauthenticated and wrong-Origin rejection;
- first-search version bootstrap and explicit mismatch behavior;
- search, map-consumer, list-consumer, and detail `store_id` consistency;
- all verified menus/hours and traceability metadata;
- available, insufficient, and unavailable review states;
- rating and deterministic review pagination;
- inactive/out-of-snapshot store non-disclosure;
- no exact location in database rows or serialized responses;
- safe SQL/path error mapping;
- `MAP_UNAVAILABLE` preserves the same search `items`;
- Feature 8 gate, boundary check, full typecheck, lint, tests, database check,
  production build, and production dependency audit.

Live Kakao Map marker/failure smoke remains a credential-dependent manual
check. It is reported separately and does not block the fixture-complete
server Feature. No paid quota is enabled automatically.
