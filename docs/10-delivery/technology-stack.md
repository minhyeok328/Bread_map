# 기술 스택 기준

[구현·릴리스 안내](README.md) · [폴더 구조](directory-structure.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 P0 구현에서 사용하는 도구와 버전의 단일 기준이다. 실제 의존성 선언은 저장소 루트의 `pnpm-workspace.yaml` catalog와 각 package의 `package.json`이 소유한다.

기준일은 2026-07-23이며, Feature가 시작될 때 보안·호환성 문제가 확인된 경우에만 별도 결정 기록을 남기고 갱신한다.

## 1. 확정 스택

| 영역 | 선택 | 기준 버전 | 사용 위치 |
|---|---|---:|---|
| Runtime | Node.js LTS | `24.18.0` | 전체 TypeScript 실행 환경 |
| Package manager | pnpm workspace | `11.16.0` | monorepo 의존성·script·lockfile |
| Language | TypeScript | `6.0.3` | web, worker, 공유 package |
| Web | Next.js App Router | `16.2.11` | `apps/web` |
| UI runtime | React / React DOM | `19.2.8` | `apps/web` |
| Authentication | Auth.js의 `next-auth` | `4.24.15` | Kakao Login, database session |
| Conversation workflow | LangGraph | `1.4.8` | 멀티턴 상태 전이와 checkpoint |
| LLM integration | OpenAI JavaScript SDK | `6.48.0` | Responses API와 Structured Outputs |
| Database | PostgreSQL | `18.4` | `app_db`, `raw_db`, job queue |
| ORM | Prisma ORM | `7.9.0` | 두 database의 schema·migration·client |
| PostgreSQL driver | `pg` / Prisma PG adapter | `8.22.0` / `7.9.0` | Prisma 7 runtime connection |
| Unit/integration test | Vitest | `4.1.10` | package와 service 단위 검증 |
| Browser E2E | Playwright Test | `1.61.1` | 사용자 흐름과 관리자 로컬 수집 검증 |
| Static analysis | ESLint / Next config | `9.39.5` / `16.2.11` | 전체 TypeScript와 package 경계 |
| Local infrastructure | Docker Compose | Compose Specification | 두 PostgreSQL service |

## 2. 선택 이유

- Node.js 24 LTS 하나로 web, worker, script의 runtime 차이를 없앤다.
- pnpm workspace와 exact version catalog로 Feature별 의존성 drift를 줄인다.
- Next.js App Router 한 애플리케이션 안에 사용자 화면, server API와 `/admin`을 둔다.
- worker는 web process와 분리해 공공데이터 적재, 리뷰 실험, LLM 특징 추출과 집계를 실행한다.
- PostgreSQL은 제품 데이터, 원문 데이터와 job queue를 담당한다. P0에는 Redis·BullMQ를 추가하지 않는다.
- `app_db`와 `raw_db`는 별도 PostgreSQL service와 별도 role로 실행한다. web에는 `raw_db` 접속 정보가 전달되지 않는다.
- Prisma 7은 PostgreSQL 연결 시 `@prisma/adapter-pg`를 사용한다.
- 단위·통합 검증은 Vitest, 실제 브라우저 흐름은 Playwright로 분리한다.

## 3. 호환성 기준

- Next.js 16은 Node.js `20.9.0` 이상과 TypeScript `5.1.0` 이상을 요구한다.
- pnpm 11.16.0은 Node.js `22.13` 이상을 요구한다.
- Prisma 7.9.0은 Node.js `20.19`, `22.12` 또는 `24` 이상과 TypeScript `5.4` 이상을 요구한다.
- Vitest 4.1.10과 ESLint 9.39.5는 Node.js 24에서 동작한다.
- Next.js의 TypeScript ESLint toolchain이 공식 지원하는 범위에 맞춰 TypeScript는 `6.0.3`, ESLint는 plugin peer 범위 안의 `9.39.5`를 사용한다.
- Prisma 7 direct database 연결은 driver adapter가 필수이므로 `@prisma/adapter-pg`와 `pg`를 함께 고정한다.
- Vitest 4에서는 이전 `vitest.workspace.ts` 방식 대신 `vitest.config.ts`의 `test.projects`를 사용한다.

공식 근거:

- [Node.js release index](https://nodejs.org/dist/index.json)
- [Next.js 설치 요구사항](https://nextjs.org/docs/app/getting-started/installation)
- [Prisma 7 업그레이드 가이드](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Prisma PostgreSQL driver adapter](https://www.prisma.io/docs/orm/core-concepts/supported-databases/postgresql)
- [Vitest 4 migration guide](https://vitest.dev/guide/migration.html)
- [PostgreSQL 공식 Docker image](https://hub.docker.com/_/postgres)

## 4. 버전 변경 규칙

1. Feature 시작 시 현재 고정 버전에 알려진 보안 또는 호환성 문제가 있는지 확인한다.
2. 문제가 없으면 진행 중인 Feature에서 버전을 올리지 않는다.
3. 변경이 필요하면 관련 package를 한 묶음으로 갱신하고 lockfile을 다시 만든다.
4. `typecheck`, `lint`, `test`, `build`와 직접 영향 E2E를 통과시킨다.
5. major 변경이나 아키텍처 영향은 [결정 기록](../09-decisions/decision-log.md)에 남긴다.
