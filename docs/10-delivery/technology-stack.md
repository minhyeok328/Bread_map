# 기술 스택 기준

[구현·릴리스 안내](README.md) · [폴더 구조](directory-structure.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 Feature 1에서 구현·검증된 현재 로컬 MVP 기술 기반을 설명한다. 실제 선언은 root `pnpm-workspace.yaml`, 각 `package.json`과 lockfile이 소유한다.

**기준일:** 2026-07-30

## 1. 현재 로컬 MVP 기반

| Area | Target | 역할 |
|---|---|---|
| Runtime | Node.js `24.18.0` | web·worker·script |
| Package manager | pnpm `11.16.0` | workspace·lockfile |
| Language | TypeScript `6.0.3` | 전체 source |
| Web | Next.js `16.2.11`, React `19.2.8` | `apps/web` |
| Database | SQLite/FTS5 | local app/raw file과 review 검색 |
| Driver | `better-sqlite3` `12.11.1` | server·worker SQLite access |
| Schema/migration | Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10` | independent app/raw migration |
| Coordinate transform | `proj4` `2.20.9` | worker의 EPSG:5174→WGS84 매장 좌표 정규화 |
| Authentication | `next-auth` `5.0.0-beta.32`, `@auth/core` `0.41.3`, `@auth/drizzle-adapter` `1.11.3` | Kakao OAuth·encrypted JWT·minimal Drizzle wrapper |
| Unit/integration | Vitest `4.1.10` | package·repository·service |
| Browser E2E | Playwright Test `1.61.1` | user flow·local review experiment |
| Static analysis | ESLint `9.39.5`, Next config `16.2.11` | source·package boundary |

표의 dependency는 현재 manifest와 lockfile에 exact version으로 고정돼 있다. `postcss` `8.5.18`과 `sharp` `0.35.3` workspace override는 Next.js transitive production advisory를 보완하며 production build가 호환 gate다.

## 2. 선택 이유

- 단일 Node·TypeScript runtime으로 web·worker·script 차이를 줄인다.
- SQLite file 두 개로 local owner 환경의 설치·backup·복구를 단순화한다.
- `app.sqlite`와 `raw.sqlite`를 package·path·secret 경계로 분리한다.
- Drizzle source와 generated migration이 schema 변경을 소유한다.
- FTS5는 비식별 review 검색을 local server에서 수행한다.
- recommendation은 pure deterministic function과 stable tie-breaker를 사용한다.
- Vitest와 Playwright를 각각 logic/integration과 browser flow에 사용한다.
- OpenAI·LangGraph와 remote hosting은 현재 runtime에서 제외한다.

## 3. 구현 상태와 대체된 이력

| Area | 현재 구현 |
|---|---|
| Connection | `@bread-map/sqlite-core`가 local path, PRAGMA와 online backup 소유 |
| App DB | `@bread-map/app-db`, `drizzle/app`, 기본 `var/app.sqlite` |
| Raw DB | `@bread-map/raw-db`, `drizzle/raw`, 기본 `var/raw.sqlite` |
| Boundary | web manifest/import/source에서 raw package·path·environment 차단 |
| Operations | `db:migrate`, app-only `db:backup:app` |
| Store catalog | Feature 2 staging→정규화·중복 근거·eligibility·`admin_review`·멱등 app publish |
| Authentication | Feature 7 최소 Kakao adapter, 갱신되지 않는 절대 6시간 encrypted JWT, hashed revocation registry |
| User data | Feature 7 ownership-scoped favorite·normalized history와 local-first withdrawal |

PostgreSQL `18.4`, Prisma `7.9.0`, `pg`, Prisma PG adapter와 `infra/compose.yaml`은 2026-07-23 workspace scaffold 이력으로 대체됐다. 현재 manifest·script·active tree에는 포함하지 않는다. OpenAI·LangGraph runtime dependency와 `OPENAI_API_KEY`도 DR-033에 따라 후속 독립 Feature로 이동했다.

root `build`와 `typecheck`는 migration이나 client generation을 자동 실행하지 않는다.

## 4. 검증 gate

Feature 1 기반은 다음 항목을 함께 확인한다.

- `better-sqlite3`, Drizzle ORM·Kit exact version이 manifest·lockfile에 존재
- app/raw independent migration과 fresh file 적용 통과
- Feature 3 app migration, store publish 좌표/CHECK와 replay unique constraint 통과
- WAL·foreign key·`busy_timeout` capability test 통과
- app/raw typed handle과 web raw import·runtime reference guard 통과
- app online snapshot을 새 readonly 연결에서 읽는 test 통과
- root build·typecheck가 Prisma generate 없이 통과
- PostgreSQL·Prisma·PG adapter·Compose runtime dependency 제거
- OpenAI·LangGraph가 current runtime dependency에서 제거되거나 후속 scope로 격리
- frozen install, typecheck, lint, test, build와 두 migration drift check 통과

## 5. 버전 변경 규칙

1. Feature 시작 시 고정 version의 security·compatibility를 확인한다.
2. 문제가 없으면 진행 중 Feature에서 임의 upgrade하지 않는다.
3. 변경이 필요하면 관련 package와 lockfile을 같은 scope로 갱신한다.
4. `typecheck`, `lint`, `test`, `build`와 직접 영향 integration을 통과한다.
5. major 또는 architecture 영향은 [결정 기록](../09-decisions/decision-log.md)에 남긴다.

공식 compatibility 근거는 dependency를 실제 추가하는 Feature에서 기준일과 함께 검증한다. 이 문서의 target version과 실제 lockfile이 다르면 구현 완료라고 판단하지 않는다.
