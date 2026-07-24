# 로컬 개발 환경

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서는 Feature 1 전환 전 실제 script를 확인하는 절차와 SQLite 전환 뒤 갱신할 목표 절차를 분리한다.

## 1. Feature 1 전환 전 scaffold 확인

### 필수 도구

| 도구 | 현재 repository 기준 | 확인 |
|---|---|---|
| Node.js | `>=24.15.0 <25`, target `24.18.0` | `node --version` |
| Corepack | Node.js와 함께 사용 | `corepack --version` |
| Git | 현재 지원 version | `git --version` |

pnpm은 root `packageManager`의 `11.16.0`을 사용한다. Node 24 범위 밖에서는 engine warning이 발생하며 완료 검증 환경으로 인정하지 않는다.

### install

```powershell
corepack pnpm install --frozen-lockfile
```

현재 `pnpm-workspace.yaml`은 Prisma engine, esbuild, sharp와 resolver install script를 허용한다. 이는 전환 전 scaffold의 실제 상태다.

### 현재 검증

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

현재 `typecheck`와 `build`는 먼저 두 Prisma client를 generate한다. 검증 범위:

- 7개 기존 workspace project
- web의 raw-db dependency/import boundary
- Vitest
- Next.js production build
- Prisma schema client generation

이 결과가 SQLite 전환 완료를 의미하지 않는다.

### web·worker scaffold

```powershell
corepack pnpm dev
```

현재 web은 UI 구현 전 최소 root page만 표시한다. root script가 loopback host를 강제하지 않으므로 public network나 tunnel에 노출하지 않는다. `127.0.0.1` 강제 bind는 해당 web Feature에서 검증한다.

```powershell
corepack pnpm dev:worker
```

현재 worker는 job 구현 전 skeleton이라 즉시 종료될 수 있다.

## 2. legacy PostgreSQL 확인은 선택

Docker Desktop과 `infra/compose.yaml`은 PostgreSQL·Prisma scaffold를 조사할 때만 선택적으로 사용한다. 승인된 SQLite target의 설치 전제는 아니다.

Compose schema만 확인:

```powershell
docker compose -f infra/compose.yaml config
```

legacy service를 올리는 것은 Feature 1 구현·문서 동기화의 필수 단계가 아니다. 기존 volume 삭제 명령은 이 문서에서 안내하지 않는다.

## 3. 현재 environment 상태

scaffold typecheck·lint·test·build에는 `.env`가 필요하지 않다. `.env.example`은 아직 다음 legacy·후속 변수를 포함한다.

- PostgreSQL app/raw name·user·password·port·URL
- Kakao Login·Map
- Auth.js
- OpenAI
- public data key

`APP_SQLITE_PATH`, `RAW_SQLITE_PATH`, review encryption·dedupe key는 아직 `.env.example`과 runtime에 구현되지 않았다. Feature 1 또는 해당 external integration Feature가 이름·필요 시점·secret 주입을 함께 갱신한다.

실제 secret를 문서·Git·terminal output에 붙이지 않는다.

## 4. 아직 사용할 수 없는 SQLite command

다음 command name은 승인된 Feature 1 계획에 있지만 root `package.json`에는 아직 없다.

- `db:migrate`
- `db:backup:app`

따라서 지금 실행하라고 안내하거나 성공했다고 기록하지 않는다. `app.sqlite`·`raw.sqlite`를 수동으로 만들어 migration을 우회하지 않는다.

## 5. Feature 1 완료 후 갱신할 목표 절차

Feature 1이 구현·검증한 뒤 이 문서를 실제 script 이름과 output에 맞춰 갱신한다.

- SQLite capability와 FTS5 확인
- app/raw fresh file에 independent Drizzle migration 적용
- idempotent migration 재실행
- WAL·foreign key·`busy_timeout` 검증
- web app repository와 worker app/raw repository smoke
- web raw import·path guard
- app snapshot 생성
- active file을 덮지 않는 new-file restore
- `PRAGMA integrity_check`와 대표 search
- Prisma generate 없는 typecheck·lint·test·build

위 항목은 목표 절차 목록이며 현재 실행 가능한 command block이 아니다.

## 6. 문서 갱신 gate

Feature 1 완료 시 다음을 다시 읽고 같은 commit 범위에서 갱신한다.

- root `package.json` script
- `pnpm-workspace.yaml` catalog·allowBuilds
- `.env.example`
- actual folder tree
- [기술 스택 기준](technology-stack.md)
- [폴더 구조](directory-structure.md)
- [개발 준비 체크리스트](development-readiness-checklist.md)

검증되지 않은 command나 file 생성 사실을 먼저 문서화하지 않는다.
