# 기술 스택 기준

[구현·릴리스 안내](README.md) · [폴더 구조](directory-structure.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 승인된 로컬 MVP 목표와 Feature 1 전환 전 실제 dependency를 구분한다. 실제 선언은 root `pnpm-workspace.yaml`, 각 `package.json`과 lockfile이 소유한다.

**기준일:** 2026-07-24

## 1. 승인된 로컬 MVP 목표 스택

| Area | Target | 역할 |
|---|---|---|
| Runtime | Node.js `24.18.0` | web·worker·script |
| Package manager | pnpm `11.16.0` | workspace·lockfile |
| Language | TypeScript `6.0.3` | 전체 source |
| Web | Next.js `16.2.11`, React `19.2.8` | `apps/web` |
| Database | SQLite/FTS5 | local app/raw file과 review 검색 |
| Driver | `better-sqlite3` `12.11.1` | server·worker SQLite access |
| Schema/migration | Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10` | independent app/raw migration |
| Authentication | Auth.js-compatible Kakao provider | exact adapter는 Feature 7에서 고정 |
| Unit/integration | Vitest `4.1.10` | package·repository·service |
| Browser E2E | Playwright Test `1.61.1` | user flow·local review experiment |
| Static analysis | ESLint `9.39.5`, Next config `16.2.11` | source·package boundary |

목표 dependency는 Feature 1과 관련 Feature가 lockfile에 실제로 추가하고 검증하기 전에는 설치된 것으로 간주하지 않는다.

## 2. 선택 이유

- 단일 Node·TypeScript runtime으로 web·worker·script 차이를 줄인다.
- SQLite file 두 개로 local owner 환경의 설치·backup·복구를 단순화한다.
- `app.sqlite`와 `raw.sqlite`를 package·path·secret 경계로 분리한다.
- Drizzle source와 generated migration이 schema 변경을 소유한다.
- FTS5는 비식별 review 검색을 local server에서 수행한다.
- recommendation은 pure deterministic function과 stable tie-breaker를 사용한다.
- Vitest와 Playwright를 각각 logic/integration과 browser flow에 사용한다.
- OpenAI·LangGraph와 remote hosting은 현재 runtime에서 제외한다.

## 3. Feature 1 전환 전 실제 scaffold

2026-07-24 실제 manifest·tree에는 다음이 남아 있다.

| Area | 실제 상태 | 판정 |
|---|---|---|
| Database | PostgreSQL Compose service 두 개 | 대체 예정 scaffold |
| ORM | Prisma `7.9.0` | Drizzle 검증 뒤 제거 |
| Driver | `pg` `8.22.0`, `@prisma/adapter-pg` `7.9.0` | 제거 예정 |
| DB package | `packages/app-db`, `packages/raw-db` Prisma client | repository 교체 전 상태 |
| Schema | `prisma/app`, `prisma/raw` | Drizzle migration 교체 전 상태 |
| Infrastructure | `infra/compose.yaml` | target prerequisite 아님 |
| Conversation | LangGraph catalog dependency | current runtime에서 사용 금지, 제거 예정 |
| LLM | OpenAI SDK·LangChain OpenAI catalog dependency | current runtime에서 사용 금지, 제거 예정 |
| Auth | `next-auth` `4.24.15`, Prisma adapter catalog | exact target adapter 미확정 |

root `build`와 `typecheck` script는 아직 `prisma:generate`를 먼저 실행한다. 이 사실은 승인 target이 아니라 Feature 1의 제거 대상이다.

## 4. 전환 완료 판정

Feature 1은 다음이 모두 확인돼야 stack 전환 완료로 기록한다.

- `better-sqlite3`, Drizzle ORM·Kit exact version이 manifest·lockfile에 존재
- app/raw independent migration과 fresh file 적용 통과
- WAL·foreign key·`busy_timeout` capability test 통과
- app/raw repository와 web raw import guard 통과
- app snapshot·new-file restore test 통과
- root build·typecheck가 Prisma generate 없이 통과
- PostgreSQL·Prisma·PG adapter·Compose runtime dependency 제거
- OpenAI·LangGraph가 current runtime dependency에서 제거되거나 후속 scope로 격리
- docs의 target/scaffold 구분을 구현 완료 상태로 다시 갱신

## 5. 버전 변경 규칙

1. Feature 시작 시 고정 version의 security·compatibility를 확인한다.
2. 문제가 없으면 진행 중 Feature에서 임의 upgrade하지 않는다.
3. 변경이 필요하면 관련 package와 lockfile을 같은 scope로 갱신한다.
4. `typecheck`, `lint`, `test`, `build`와 직접 영향 integration을 통과한다.
5. major 또는 architecture 영향은 [결정 기록](../09-decisions/decision-log.md)에 남긴다.

공식 compatibility 근거는 dependency를 실제 추가하는 Feature에서 기준일과 함께 검증한다. 이 문서의 target version과 실제 lockfile이 다르면 구현 완료라고 판단하지 않는다.
