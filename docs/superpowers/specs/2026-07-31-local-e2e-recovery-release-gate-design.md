# Local E2E, Recovery, and Release Gate Design

## 1. Scope and authority

Feature 10 turns the approved local-first MVP completion conditions into one
repeatable, cost-free release command. It follows the ownership index in
`docs/README.md`, the active decisions DR-032 through DR-042, and Section 14 of
the approved local MVP design.

The owner design's Section 14 contains thirteen normative completion bullets;
the master plan's phrase "14 completion conditions" refers to that section,
not to a different fourteen-item list. This Feature maps all thirteen bullets
and records credential-dependent live integration status separately. It does
not invent a new product condition.

The user already approved autonomous completion through Feature 10. This
document is a faithful implementation translation of approved requirements,
not a new product or security decision. It adds no remote deployment, paid
API, OpenAI client, active chatbot, Kakao Route, or automatic live provider
access.

## 2. Considered approaches

### A. Typed in-process orchestrator with real subprocess gates — selected

A TypeScript orchestrator creates an isolated run directory, composes existing
database and search functions for deterministic setup and recovery, and runs
the production build and Playwright as subprocess gates. Every gate returns a
typed, redacted result that is written atomically as JSON.

This approach gives direct assertions for data invariants while still proving
the real browser/build boundary. It is portable across the supported Windows
development environment and can fail closed at the first unsafe or incorrect
state.

### B. Shell-only command chain

A package script could concatenate migration, test, build, and browser
commands. It would be short, but cleanup, structured results, cross-platform
error handling, and secret/path redaction would be brittle.

### C. One large Vitest integration test

A single test could exercise most functions quickly, but it would not prove
the production Next.js start path, the system Chrome flow, or a stable operator
command. It would also mix test-runner state with release orchestration.

## 3. Release-run architecture

`pnpm verify:local-mvp` runs `scripts/verify-local-mvp.ts`. The command:

1. creates a unique ignored directory under `var/local-mvp-verification`;
2. creates and migrates explicit app and raw SQLite files there;
3. seeds only sanitized deterministic fixtures;
4. executes a representative structured search through the public retrieval
   facade;
5. proves file-backed review checkpoint resume and zero duplicate rows;
6. backs up the app database, restores the snapshot to a new path, applies
   forward migrations, and verifies the restored copy;
7. emits the Feature 6 quality metrics as structured JSON;
8. audits source and production build output for forbidden chatbot/OpenAI
   behavior and checks local-only configuration, ignored artifacts, and
   redacted captured output;
9. starts the production web server on `127.0.0.1:3000` and runs the Feature 10
   Playwright suite against the generated app database;
10. writes `test-results/local-mvp/report.json` atomically and exits nonzero if
    any automated gate fails.

All temporary database paths are explicit. The verifier never opens the
developer's default `var/app.sqlite` or `var/raw.sqlite`. Raw review storage is
excluded from backup and restore.

## 4. Recovery contract

`restoreAppDatabase` accepts a snapshot, a destination path, and the app
migration directory. It rejects missing snapshots, SQLite URLs, identical
source/destination paths, and any existing destination before writing.

The implementation opens the snapshot read-only, uses SQLite's online backup
API to copy into the new path, applies forward migrations to the new copy, and
then verifies:

- `PRAGMA integrity_check` is exactly `ok`;
- `PRAGMA foreign_key_check` returns zero rows;
- Drizzle migration history exists and is nonempty;
- application table and row counts are plausible and captured;
- public review and FTS document counts agree;
- a stable public-data checksum matches the snapshot when no forward migration
  changes data;
- the active search snapshot resolves and a representative structured query
  succeeds deterministically;
- hidden/out-of-snapshot fixture data remains unavailable.

The report contains only basenames, counts, booleans, versions, and hashes. A
verified restore is a swap candidate only; Feature 10 never replaces the
active app database automatically.

## 5. Checkpoint recovery fixture

The review recovery gate uses a file-backed migrated raw database and the
existing cooperative page-boundary interruption. It commits two pages, closes
the database to model process loss, reopens the same file, resumes the same
logical run at page three, and asserts that the next checkpoint is used and
the final unique review count equals the input count. No provider request,
credential, or raw review body is logged.

This is intentionally a deterministic forced interruption at the repository's
documented safe commit boundary. It proves restart behavior without adding an
unreliable operating-system kill harness.

## 6. Browser E2E boundary

Feature 10 uses a separate production Playwright configuration on the fixed
Auth.js origin `http://127.0.0.1:3000`. The verifier creates short-lived local
test users, revocable registry sessions, and encrypted Auth.js cookies in the
isolated app database. No authentication bypass is compiled into application
runtime code.

Only the Kakao Map JavaScript SDK is replaced by a deterministic local script;
store, favorite, and history requests reach the real Next.js route handlers and
the generated SQLite database. The browser suite is split into:

- `search-and-detail.spec.ts`: real API search/detail, snapshot consistency,
  map failure, sparse-review state, and truthful FTS fallback;
- `favorites-isolation.spec.ts`: two encrypted sessions prove ownership
  isolation through the real favorite/history endpoints;
- `chat-shell.spec.ts`: disabled controls, focus restoration, and zero
  `/api/chat`, `/api/routes`, or OpenAI requests;
- deterministic OAuth failure presentation that exposes only a stable public
  error identifier and keeps the map/search shell recoverable.

Credential-owned Kakao Login and Kakao Map live smokes remain separate and are
reported as `NOT_RUN_CREDENTIALS_REQUIRED` when no owner credentials exist.

## 7. Quality and security report

The machine-readable report has schema version 1 and contains per-gate status,
duration, sanitized evidence, and these search metrics:

- exactly 20 scenarios (18 successful, 2 expected safe errors);
- Hit Rate@5 at least 8,500 basis points;
- hard-exclusion, required-hit, status, and rating-only inversion violations
  equal to zero;
- truthful FTS fallback;
- 100-run determinism;
- 100 measured runs after warm-up and p95 below 1,500 ms.

The forbidden audit scans relevant web source plus all JavaScript text assets
under the production `.next` output. It fails on OpenAI runtime references,
`/api/chat`, `/api/routes`, or an enabled chat submit path. It also verifies
that server scripts specify `127.0.0.1`, representative database, WAL/SHM,
backup, dotenv, and report artifacts are ignored, and captured command/report
text contains no injected secret, nickname, raw review body, provider token,
fingerprint, or absolute SQLite path.

Public-tunnel absence cannot be inferred reliably from repository code. The
report therefore records the approved local-only configuration as automated
evidence and a separate `NOT_RUN_OPERATOR_ATTESTATION_REQUIRED` item for any
machine-external tunnel state.

## 8. Failure and cleanup behavior

The command stops on the first failed automated gate, records a safe public
error code, and exits nonzero. It never prints a secret, request body, raw
review, exact origin coordinate, or absolute database path. Successful runs
remove their temporary database directory. Failed-run artifacts are retained
only under the ignored verification directory for local diagnosis; generated
databases and reports remain Git-ignored and no artifact is committed.

## 9. Completion mapping

The thirteen normative local MVP conditions are covered as follows:

1. install/migration: existing frozen install documentation plus fresh DB gate;
2. catalog fixture: deterministic fixture bootstrap;
3. review checkpoint/resume: file-backed forced interruption gate;
4. public review/FTS: restored count and FTS checks;
5. deterministic search: quality report and representative restored query;
6. authentication/account isolation: real-route two-session browser gate;
7. map/list/detail: production browser E2E;
8. map/provider failure: deterministic failure states;
9. disabled chat/OpenAI `$0`: source/build/network audit;
10. recovery: new-file restore rehearsal;
11. privacy/log boundaries: redaction and ignore audit;
12. loopback-only operation: fixed-origin production start and configuration
    audit;
13. live external evidence: dated credential/policy status in the release
    checklist without claiming an unrun smoke as passed.
