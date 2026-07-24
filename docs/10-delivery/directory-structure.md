# 폴더 구조

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 승인된 SQLite 목표 구조와 Feature 1 전환 전 실제 tree를 구분하고 package 소유권·import 경계를 정의한다.

## 1. 승인된 목표 구조

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

## 3. Feature 1 전환 전 실제 tree

실제 저장소에는 다음 path가 존재한다.

```text
packages/app-db/       # Prisma AppPrismaClient
packages/raw-db/       # Prisma RawPrismaClient
prisma/app/
prisma/raw/
infra/compose.yaml
infra/docker/README.md
```

또한 `packages/sqlite-core/`, `packages/retrieval/`, `drizzle/`, `var/`와 `backups/`는 아직 없다.

기존 path를 먼저 삭제하지 않는다. SQLite replacement, migration, repository, boundary와 backup test가 통과한 뒤 Prisma·Compose path를 제거한다.

## 4. 추가 원칙

- Feature code는 소유 package에 둔다. worker logic을 web에 복제하지 않는다.
- service 간 data는 `packages/contracts` validator를 거친다.
- generated client·migration artifact의 Git 포함 여부는 각 tool의 공식 산출물 계약에 맞춘다.
- operation script는 hidden business rule을 소유하지 않는다.
- SQLite absolute path를 source·error·browser response에 hard-code하지 않는다.
- 후속 production Dockerfile·remote deployment path는 현재 목표 tree에 미리 만들지 않는다.
