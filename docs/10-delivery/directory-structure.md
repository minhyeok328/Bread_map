# 폴더 구조

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 로컬 SQLite MVP의 목표 tree, Feature 1에서 구현된 foundation path와 package 소유권·import 경계를 정의한다.

## 1. 로컬 MVP 구조

```text
Bread_map/
├── apps/
│   ├── web/                         # Next.js UI·server route
│   └── worker/                      # source·review·publish
├── packages/
│   ├── contracts/                   # input/output schema·shared type
│   ├── sqlite-core/                 # connection·pragma·transaction·backup
│   ├── app-db/                      # app repository, app schema export
│   ├── raw-db/                      # worker-only raw repository
│   ├── retrieval/                   # FTS5 query·snippet
│   ├── recommendation/              # deterministic filter·sort
│   └── testkit/                     # fixture·test helper
├── drizzle/
│   ├── app/                         # app.sqlite generated migration
│   └── raw/                         # raw.sqlite generated migration
├── var/
│   ├── app.sqlite                   # runtime file, Git-ignore
│   └── raw.sqlite                   # worker-only runtime file, Git-ignore
├── backups/                         # verified app snapshot, Git-ignore
├── scripts/                         # repository·operation helper
├── docs/
├── .github/workflows/
├── AGENTS.md
├── package.json
└── pnpm-workspace.yaml
```

`var/`, SQLite `-wal`·`-shm`과 `backups/`는 runtime data이며 Git에 포함하지 않는다. production에서는 source tree 밖 local user data directory를 실제 path로 사용할 수 있다.

## 2. package 경계

| 소비자 | 허용 | 금지 |
|---|---|---|
| `apps/web` | `contracts`, `app-db`, `retrieval`, `recommendation` | `raw-db`, decrypt·HMAC key |
| `apps/worker` | `contracts`, `sqlite-core`, `app-db`, `raw-db`, `retrieval` | user session cookie 처리 |
| `packages/contracts` | Zod·pure TypeScript | DB driver, Next runtime |
| `packages/sqlite-core` | driver·pragma·transaction·backup primitive | domain business rule |
| `packages/app-db` | app repository·schema | raw schema·secret |
| `packages/raw-db` | raw repository·crypto metadata | web import |
| `packages/retrieval` | app repository contract·FTS5 | raw body·raw path |
| `packages/recommendation` | contracts·pure candidate data | UI·direct DB connection |
| `packages/testkit` | test-only fixture | production runtime import |

web의 raw package import와 `RAW_SQLITE_PATH` 참조는 static boundary test가 차단한다.

## 3. Feature 1 구현 tree

현재 저장소의 storage foundation은 다음 path가 소유한다.

```text
packages/sqlite-core/              # local path·PRAGMA·online backup
packages/app-db/                   # app schema·typed handle·migrator
packages/raw-db/                   # worker-only raw schema·typed handle·migrator
drizzle/app.config.ts
drizzle/app/                       # app migration·snapshot·journal
drizzle/raw.config.ts
drizzle/raw/                       # raw migration·snapshot·journal
scripts/migrate-databases.ts
scripts/backup-app-database.ts
scripts/check-workspace-boundaries.ts
var/                               # runtime only, Git-ignore
backups/                           # app snapshot only, Git-ignore
infra/docker/README.md             # 후속 배포 비목표 안내
```

PostgreSQL·Prisma schema와 `infra/compose.yaml`은 SQLite replacement gate 통과 뒤 제거됐다. `packages/retrieval/`과 실제 domain schema는 각각 후속 Feature가 추가하며 storage foundation이 미리 소유하지 않는다.

## 4. 추가 원칙

- Feature code는 소유 package에 둔다. worker logic을 web에 복제하지 않는다.
- service 간 data는 `packages/contracts` validator를 거친다.
- generated Drizzle migration·snapshot은 schema source와 함께 Git에 포함한다.
- operation script는 hidden business rule을 소유하지 않는다.
- SQLite absolute path를 source·error·browser response에 hard-code하지 않는다.
- 후속 production Dockerfile·remote deployment path는 현재 목표 tree에 미리 만들지 않는다.
