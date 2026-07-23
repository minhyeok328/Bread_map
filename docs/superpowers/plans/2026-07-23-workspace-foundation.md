# Workspace·Docker·테스트 기반 상세 실행 계획

**Feature:** 1

**Branch:** `codex/workspace-foundation`
**상태:** 구현·검증 완료

## 목표

후속 Feature가 같은 Node.js·pnpm lockfile·package 경계·두 PostgreSQL service 위에서 구현되고, root 명령 하나로 검증되게 한다.

## 확정 기준

- 버전과 선택 근거: [기술 스택 기준](../../10-delivery/technology-stack.md)
- package 소유권과 import 경계: [폴더 구조](../../10-delivery/directory-structure.md)
- 전체 시스템 경계: [시스템 구조](../../04-architecture/system-architecture.md)

## 작업 순서

1. Root workspace, exact version catalog와 공통 TypeScript·ESLint·Vitest 설정을 만든다.
2. `apps/web`, `apps/worker`와 5개 공유 package의 최소 실행 가능한 골격을 만든다.
3. web에서 `@bread-map/raw-db`를 사용할 수 없도록 lint rule과 manifest 검증 test를 만든다.
4. `app_db`, `raw_db`의 분리된 Prisma schema·generated client 경계를 만든다.
5. PostgreSQL 18.4 두 service, 별도 role·volume·health check를 Compose로 정의한다.
6. install → typecheck → lint → test → build 순서의 CI를 만든다.
7. lockfile을 생성하고 로컬에서 같은 순서로 검증한다.

## 현재 계획에서 조정한 항목

마스터 계획의 `vitest.workspace.ts`는 Vitest 4에서 대체된 방식이다. 동일한 workspace test 목적을 유지하면서 공식 현재 방식인 `vitest.config.ts`의 `test.projects`를 사용한다.

## 검증

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
docker compose -f infra/compose.yaml config
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
```

완료 기준:

- 모든 workspace package가 하나의 lockfile을 사용한다.
- web의 raw DB dependency와 import가 자동으로 거부된다.
- 두 PostgreSQL service가 각각 `healthy`가 된다.
- 외부 API key 없이 정적 검증과 build가 성공한다.
