# 로컬 개발 환경

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서는 Feature 1에서 구현된 로컬 SQLite 저장소의 설치, migration, 실행, backup과 검증 절차를 소유한다.

## 1. 필수 도구

| 도구 | repository 기준 | 확인 |
|---|---|---|
| Node.js | `>=24.15.0 <25`, target `24.18.0` | `node --version` |
| pnpm | root `packageManager`의 `11.16.0` | `corepack pnpm --version` |
| Git | 현재 지원 version | `git --version` |

Docker, PostgreSQL, OpenAI key와 외부 API key는 SQLite storage foundation의 설치·검증 전제가 아니다.

## 2. 설치

```powershell
corepack pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml`은 사용하지 않는 optional peer를 자동 설치하지 않고 native addon 중 `better-sqlite3`의 build만 명시적으로 허용한다. `esbuild`, `sharp`, `unrs-resolver`는 기존 web toolchain에 필요한 build 항목이다.

## 3. 환경변수

둘 다 비워 두면 repository 상대 기본 경로를 사용한다.

| 이름 | 기본값 | 허용 소비자 | 비고 |
|---|---|---|---|
| `APP_SQLITE_PATH` | `var/app.sqlite` | web·worker·operation script | app data |
| `RAW_SQLITE_PATH` | `var/raw.sqlite` | worker·operation script only | web 참조 금지 |

로컬 filesystem path와 test의 `:memory:`만 허용한다. `libsql://` 같은 remote URL은 foundation boundary에서 거부한다. 실제 secret나 전체 environment를 문서·Git·terminal output에 붙이지 않는다.

## 4. migration과 실행

설치 후 두 독립 migration을 적용한다.

```powershell
corepack pnpm db:migrate
```

기본 실행은 정확히 `var/app.sqlite`와 `var/raw.sqlite`를 만들며 재실행해도 같은 migration을 중복 적용하지 않는다.

web과 worker scaffold:

```powershell
corepack pnpm dev
corepack pnpm dev:worker
```

web은 `127.0.0.1`에 bind한다. 현재 Feature 범위에는 데이터 수집, 사용자 API와 활성 챗봇이 포함되지 않는다.

## 5. app DB 온라인 backup

active app DB를 읽을 수 있는 SQLite snapshot으로 backup한다.

```powershell
corepack pnpm db:backup:app -- --output backups/app.sqlite
```

`--output <path>`는 필수다. 이 명령은 `raw.sqlite` option이나 raw backup 기능을 제공하지 않는다. `var/`, `backups/`, `*.sqlite`, WAL과 SHM 파일은 Git-ignore 대상이다.

새 파일 restore, `PRAGMA integrity_check`와 대표 검색을 결합한 release recovery gate는 Feature 10에서 구현한다.

## 6. 검증

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm db:check
```

`typecheck`와 `build`는 migration을 자동 실행하지 않는다. 테스트는 app/raw fresh migration, 승인 PRAGMA, app-only backup, web/raw 경계와 금지 dependency 정책을 포함한다.

migration 생성은 schema 변경 Feature에서만 수행한다.

```powershell
corepack pnpm db:generate:app
corepack pnpm db:generate:raw
```

generated SQL과 snapshot은 해당 schema 변경과 함께 검토한다.
