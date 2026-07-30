# Kakao Authentication and Account Data Design

## 1. Scope

Feature 7 adds local Kakao authentication, revocable sessions, account-owned
favorites, normalized history, and withdrawal to the existing Next.js 16 and
SQLite application.

This design follows the document ownership rules in `docs/README.md`:

- `docs/06-trust/security-design.md` owns the authentication and privacy
  boundary.
- `docs/05-data/data-design.md` owns persisted fields and deletion behavior.
- `docs/04-architecture/system-architecture.md` owns the server/session flow.
- DR-024 in `docs/09-decisions/decision-log.md` owns the Kakao Login decision.

The older Feature 7 checklist says `localhost`, but the security owner and the
actual development bind require the exact callback
`http://127.0.0.1:3000/api/auth/callback/kakao`. Feature 7 corrects that stale
checklist entry.

## 2. Dependency review

### Recommendation

Proceed with caution using these exact versions:

- `next-auth@5.0.0-beta.32`
- `@auth/core@0.41.3`
- `@auth/drizzle-adapter@1.11.3`

The beta is accepted for this local MVP because it is the current official
Next.js 16 App Router integration line and the adapter is released against the
same Auth.js core line. Exact pins, a lockfile, adapter characterization tests,
and a complete build gate limit upgrade drift. A production release must
re-review the beta status.

### Compatibility and footprint

- The repository already fixes Node `>=24.15.0 <25`, Next `16.2.11`, React
  `19.2.8`, and Drizzle ORM `0.45.2`.
- `next-auth@5.0.0-beta.32` declares peers compatible with Next 16 and React 19.
- `@auth/drizzle-adapter@1.11.3` uses `@auth/core@0.41.3` and supports Drizzle
  SQLite databases, including the synchronous better-sqlite3 driver used here.
- The web workspace declares `drizzle-orm@0.45.2` directly because its
  repository and adapter wrapper import Drizzle query helpers under pnpm's
  strict dependency isolation.
- The adapter adds no external service and no paid runtime. Its only production
  dependency is Auth.js core, which the web workspace already carries.
- Auth.js and the adapter use the ISC license.
- The initial production audit exposed existing Next.js transitive pins to
  `postcss@8.4.31` and `sharp@0.34.5`. The former is only build-time reachable
  from repository-controlled CSS and the latter is not currently reachable
  from an untrusted image upload, but both are patched with exact workspace
  overrides `postcss@8.5.18` and `sharp@0.35.3`. The Next.js build is the
  compatibility gate because its current stable manifest has not yet adopted
  these patched major/minor lines.

### Breaking changes from the current placeholder versions

- The v4 `NextAuthOptions` and `NextAuth(handler)` pattern becomes the v5
  `NextAuth(config)` result with named `handlers`, `auth`, `signIn`, and
  `signOut`.
- Environment names and callback construction are made explicit instead of
  relying on request `Host` or forwarded headers.
- Session and adapter callback types come from the aligned Auth.js core line.

### Alternatives considered

1. Keep stable `next-auth@4.24.15` and write a custom adapter. This avoids a beta
   but is not the currently documented Next.js 16 integration and is not an
   officially aligned pair with the current Drizzle adapter.
2. Use Auth.js v5 with the unwrapped default Drizzle schema. This is smaller,
   but it stores provider access/refresh token fields and plaintext database
   session tokens, violating the approved minimum-data boundary.
3. Replace Auth.js with Better Auth. The upstream project recommends it for new
   projects, but that would supersede DR-024 and the approved Auth.js scope.

## 3. Chosen architecture

Auth.js performs the OAuth Authorization Code flow, state/PKCE checks, callback
validation, encrypted JWT cookie handling, and Kakao provider integration.
The official Drizzle adapter performs user/account linkage through a
security wrapper:

- Kakao profile mapping returns only the provider account ID. It does not map
  email, phone, birthday, gender, nickname, or image.
- Kakao `account()` and the adapter wrapper both discard refresh token, ID
  token, scope, expiry, and all other provider token fields before persistence.
- The physical account table has no OAuth token columns, so a future callback
  regression cannot persist them.
- The physical user table has no email, phone, birthday, gender, nickname, or
  image columns.

Auth.js uses encrypted JWT sessions so the current Kakao access token can remain
inside the server-readable, `HttpOnly`, `SameSite=Lax` cookie for one absolute,
non-rolling six-hour window. The access token is never returned by the session
callback and never written to SQLite. It is retained only so an authenticated
withdrawal can make the required Kakao unlink request.

A random session ID inside that encrypted cookie is registered in SQLite as a
SHA-256 hash. Every application API decodes the cookie server-side, hashes the
session ID, and verifies an active, unexpired row. Logout and withdrawal delete
the row, providing server-side revocation without storing the cookie or session
ID plaintext.

## 4. Data model

### `user`

- `user_id TEXT PRIMARY KEY`
- `status TEXT NOT NULL` constrained to `ACTIVE` or `DELETING`
- `created_at_ms`, `updated_at_ms`
- `deleted_at_ms` is nullable and constrained to agree with status

### `account`

- `account_id TEXT PRIMARY KEY`
- `user_id` with cascade delete
- `type TEXT NOT NULL` constrained to `oauth`
- `provider TEXT NOT NULL` constrained to `kakao`
- `provider_account_id TEXT NOT NULL`
- `created_at_ms`
- unique `(provider, provider_account_id)` and `(user_id, provider)`

The table intentionally has no provider token or optional profile columns.

### `session`

- `session_id TEXT PRIMARY KEY`
- `user_id` with cascade delete
- `session_token_hash TEXT NOT NULL UNIQUE`, exactly 64 lowercase hexadecimal
  characters
- `authenticated_at_ms`, `expires_at_ms`, `created_at_ms`

### `favorite`

- `favorite_id TEXT PRIMARY KEY`
- `user_id` and `store_id` foreign keys with cascade delete
- `created_at_ms`
- unique `(user_id, store_id)`

### `search_history`

- `search_history_id TEXT PRIMARY KEY`
- `user_id` with cascade delete
- `display_filters_json TEXT NOT NULL`
- `data_snapshot_version`, `recommendation_version`
- `result_count`, `created_at_ms`
- index `(user_id, created_at_ms)`

`display_filters_json` is a strict `search-history-filters-v1` object containing
only a coarse area label, category filters, `openNow`, a distance bucket,
review-evidence status, and sort mode. It cannot contain exact coordinates,
raw store/menu search text, medical expressions, or review text.

### `selection_history`

- `selection_history_id TEXT PRIMARY KEY`
- `user_id` and `store_id` foreign keys with cascade delete
- `source_surface TEXT` constrained to `LIST`, `MAP`, or `SEARCH`
- `created_at_ms`
- index `(user_id, created_at_ms)`

## 5. Authentication boundary

`AUTH_URL` must equal `http://127.0.0.1:3000` for this local MVP. The auth route
rejects any request whose URL origin differs, before passing it to Auth.js.
The Kakao developer application must register only:

`http://127.0.0.1:3000/api/auth/callback/kakao`

The route never derives a trusted callback from `Host`,
`X-Forwarded-Host`, or `X-Forwarded-Proto`.

Auth.js owns its login/callback CSRF and state checks. Application mutations
also require an `Origin` header exactly matching `AUTH_URL`. Missing or foreign
origins return `403`.

All application routes resolve an authenticated principal from the protected
cookie and active session registry. No route accepts `userId` in a path, query,
or JSON body.

## 6. API behavior

### `/api/favorites`

- `GET` returns only the session user's favorites.
- `POST` accepts `{ "storeId": "..." }`, is idempotent for the current user,
  and returns `201` on first creation or `200` when already present.
- `DELETE` accepts `{ "storeId": "..." }`; a missing or foreign favorite
  returns the same `404`, and another user's row is never changed.

### `/api/history`

- `GET ?kind=search|selection&limit=1..100` returns only the session user's
  selected history type.
- `POST` accepts either a strict normalized search-history payload or a
  selection payload with `storeId` and an allowlisted source surface.
- `DELETE` accepts `{ "kind": "...", "historyId": "..." }`; a missing or
  foreign ID returns the same `404`.

### `/api/account`

- `DELETE` requires the exact same origin, the confirmation value
  `DELETE_MY_ACCOUNT`, and authentication not older than ten minutes.
- A single SQLite transaction changes the user to `DELETING`, removes every
  session, favorite, search history, selection history, account, and user row.
- After the local transaction commits, the handler attempts Kakao unlink with
  the access token decoded from the current protected cookie.
- Kakao failure never rolls back local deletion. The response reports
  `providerUnlink: "PENDING_MANUAL"` without logging or persisting the token or
  provider account ID.
- The response clears the Auth.js session cookie.

## 7. Error and privacy behavior

- Unauthenticated and expired/revoked sessions return `401`.
- CSRF/origin failures return `403`.
- Missing and foreign owned resources both return `404`.
- Invalid JSON and schema failures return a stable `400` code without SQL,
  filesystem paths, provider IDs, tokens, or raw input.
- Unexpected database/provider failures return a stable public error and do not
  log protected values.
- Mutations for a `DELETING` user are rejected even before dependent rows are
  removed.

## 8. Verification

Automated gates cover:

1. fresh migration and repeat migration;
2. absence of OAuth/profile/exact-location columns;
3. adapter linkage with a full OAuth account fixture while persisting only
   provider identity;
4. plaintext session ID/token absence from SQLite;
5. callback-origin rejection;
6. unauthenticated, expired, revoked, and deleting-session rejection;
7. a two-user IDOR matrix for list, create, and delete operations;
8. strict history input that rejects raw text and coordinates;
9. logout/session revocation;
10. withdrawal success and unlink-failure local deletion;
11. dependency lock, typecheck, lint/boundary checks, full tests, migration
    drift, and production build.

The real Kakao callback and unlink smoke require user-owned Kakao credentials.
Credential-free automated verification is completed first. The release
checklist records the live smoke date and result without recording secrets,
provider IDs, or tokens.
