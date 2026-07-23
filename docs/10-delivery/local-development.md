# 로컬 개발 환경

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서는 현재 저장소의 실제 script와 Compose 설정을 기준으로 한 Windows 로컬 실행 절차다. Feature 1 기반은 외부 API key 없이 설치·검증·build할 수 있다.

## 1. 필수 도구

| 도구 | 기준 | 확인 명령 |
|---|---|---|
| Node.js | `24.18.0` 권장, `>=24.15.0 <25` 허용 | `node --version` |
| Corepack | Node.js에 포함 | `corepack --version` |
| Docker Desktop | Linux container engine 실행 | `docker info` |
| Git | 현재 지원 버전 | `git --version` |

pnpm은 전역 설치하지 않는다. 모든 명령을 `corepack pnpm`으로 실행하며 `package.json`의 `pnpm@11.16.0`을 사용한다.

## 2. 설치

저장소 루트에서 실행한다.

```powershell
corepack pnpm install --frozen-lockfile
```

설치는 `pnpm-lock.yaml`과 다른 해석 결과가 나오면 실패한다. Prisma, esbuild, sharp와 resolver의 install script만 `pnpm-workspace.yaml`에서 명시적으로 허용한다.

## 3. 환경변수

현재 기반 검증에는 `.env`가 필요하지 않다. 로컬 DB 설정을 바꾸거나 이후 외부 연동 Feature를 시작할 때만 `.env.example`을 복사해 값을 채운다.

```powershell
Copy-Item .env.example .env
```

| 변수 | 현재 필수 | 용도 | 기본값·비고 |
|---|---|---|---|
| `APP_DB_NAME` | 아니요 | app database 이름 | Compose 기본 `bread_map_app` |
| `APP_DB_USER` | 아니요 | app database role | Compose 기본 `bread_map_app` |
| `APP_DB_PASSWORD` | 아니요 | app database 로컬 암호 | Compose에 local-only 기본값 |
| `APP_DB_PORT` | 아니요 | app database host port | `5433` |
| `RAW_DB_NAME` | 아니요 | raw database 이름 | Compose 기본 `bread_map_raw` |
| `RAW_DB_USER` | 아니요 | raw database role | Compose 기본 `bread_map_raw` |
| `RAW_DB_PASSWORD` | 아니요 | raw database 로컬 암호 | Compose에 local-only 기본값 |
| `RAW_DB_PORT` | 아니요 | raw database host port | `5434` |
| `APP_DATABASE_URL` | 이후 Feature | web·worker의 app DB 연결 | 아직 runtime에서 읽지 않음 |
| `RAW_DATABASE_URL` | 이후 Feature | worker 전용 raw DB 연결 | web에 제공 금지 |
| `KAKAO_CLIENT_ID` | 이후 Feature | Kakao Login | Feature 11 전에는 불필요 |
| `KAKAO_CLIENT_SECRET` | 이후 Feature | Kakao Login | Git 저장 금지 |
| `NEXT_PUBLIC_KAKAO_MAP_APP_KEY` | 이후 Feature | Kakao Maps browser SDK | Feature 13 전에는 불필요 |
| `AUTH_SECRET` | 이후 Feature | Auth.js session 보호 | Feature 11 전에는 불필요 |
| `AUTH_URL` | 이후 Feature | Auth.js callback base URL | 로컬 로그인 구현 때 설정 |
| `OPENAI_API_KEY` | 이후 Feature | OpenAI Responses API | Feature 8 전에는 불필요 |
| `DATA_GO_KR_SERVICE_KEY` | 이후 Feature | 공공데이터 API | Feature 2 전에는 불필요 |

## 4. 로컬 database

Docker Desktop을 먼저 실행한 뒤 두 PostgreSQL service를 올린다.

```powershell
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
```

정상 상태:

- `app-db`: `localhost:5433`, role/database `bread_map_app`, `healthy`
- `raw-db`: `localhost:5434`, role/database `bread_map_raw`, `healthy`

데이터 volume을 유지하면서 중지:

```powershell
docker compose -f infra/compose.yaml stop
```

## 5. Web 실행

```powershell
corepack pnpm dev
```

브라우저에서 `http://localhost:3000`을 연다. 개발 서버는 로컬 전용 주소인
`127.0.0.1`에만 바인딩되며, 현재는 UI/UX 구현 전의 최소 root page만 표시한다.

`apps/worker`는 아직 job 구현 전 골격이므로 `corepack pnpm dev:worker`를 실행하면 즉시 종료되는 것이 정상이다.

## 6. 검증

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
docker compose -f infra/compose.yaml config
```

검증 범위:

- 두 Prisma client 생성
- 7개 workspace project typecheck와 build
- web의 `raw-db` dependency/import 금지
- Vitest workspace test
- Next.js production build
- Compose schema와 interpolation

## 7. 종료

```powershell
docker compose -f infra/compose.yaml down
```

위 명령은 컨테이너와 네트워크만 종료하며 데이터 볼륨은 유지한다.

## 8. 데이터베이스 초기화

로컬 DB 데이터를 완전히 지우고 새 상태로 다시 시작해야 할 때만 다음 명령을
사용한다.

> 주의: `down -v`는 `app_db`와 `raw_db`의 로컬 Docker 볼륨 및 그 안의 데이터를
> 삭제한다. 필요한 데이터가 없는지 확인한 후 실행한다.

```powershell
docker compose -f infra/compose.yaml down -v
docker compose -f infra/compose.yaml up -d
```

그런 다음 두 컨테이너의 상태가 `healthy`인지 다시 확인한다.
