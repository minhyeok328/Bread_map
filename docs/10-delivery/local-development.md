# 로컬 개발 환경

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서는 Feature 1의 로컬 SQLite 저장소, Feature 2의 서울 source fixture 적재와 Feature 3의 매장 정규화·적격 판정·catalog 게시에 대한 설치, migration, 실행, backup과 검증 절차를 소유한다.

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
| `DATA_GO_KR_SERVICE_KEY` | 없음 | worker live smoke only | fixture·CI에는 불필요 |

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

web은 `127.0.0.1`에 bind한다. source 적재는 아래의 별도 worker command이며, 사용자 API와 활성 챗봇은 현재 Feature 범위에 포함되지 않는다.

## 5. 서울 source fixture 적재

자동 test와 CI가 사용하는 고정 LOCALDATA fixture를 `app.sqlite`에 적재한다.

```powershell
corepack pnpm ingest:catalog:fixture
```

fixture는 provider response schema, 두 page pagination, nullable field와 서울 3건·비서울 1건을 고정한다. 첫 실행 summary는 읽음 4·삽입 3·갱신 0·거부 1이고, 같은 DB에 다시 실행하면 읽음 4·삽입 0·갱신 0·거부 1이며 staging row는 3건으로 유지된다.

실제 OpenAPI smoke는 자동 test와 분리한다. operator가 사용 조건·quota를 확인하고 공공데이터포털의 decoding key를 local secret로 주입한 경우에만 basis date와 함께 명시적으로 실행한다.

```powershell
$env:DATA_GO_KR_SERVICE_KEY = "<local secret>"
corepack pnpm --filter @bread-map/worker smoke:catalog:live -- --basis-date 2026-07-26
```

명령은 API key, 전체 응답 body, 주소와 기타 개인정보를 출력하지 않는다. live smoke는 Feature 2 자동 완료 조건이 아니며 실행 날짜·basis date·성공/실패만 별도 기록한다.

## 6. Feature 3 매장 정규화·적격 판정

Feature 3의 자동 검증은 고정 정답표와 Feature 2의 동일 LOCALDATA fixture를 사용한다.

```powershell
corepack pnpm test:catalog:feature3
```

이 gate는 다음을 한 번에 검증한다.

- 주소·전화·상호와 EPSG:5174→WGS84 좌표 정규화 table
- 정규화 주소·좌표 거리·전화·상호의 네 signal을 모두 가진 중복 판정
- 단일 독립점, 서울 2·5개 직영 브랜드의 적격과 6개 브랜드의 제외
- FTC 미일치만 있고 긍정적 독립/운영 주체 근거가 없을 때 `admin_review`
- 좌표·병합·판정이 애매한 후보의 자동 게시 차단
- customer review가 0건이어도 적격 매장 게시
- 같은 Feature 2 staging 재적재·재게시 뒤 store·decision·publish 중복 0

자동 gate에는 Docker, LOCALDATA/FTC API key와 live network가 필요하지 않다. 실제 FTC brand·취소·가맹점·직영점 자료와 공식 운영 주체·관리자 검수 근거는 별도 operator 입력이며, 현재 고정 fixture 성공을 live 서울 전체 검증으로 해석하지 않는다.

Feature 3은 library/service 경계와 자동 fixture gate를 제공한다. 임의의 미검수 후보를 기본 근거로 게시하는 CLI는 제공하지 않는다.

## 7. app DB 온라인 backup

active app DB를 읽을 수 있는 SQLite snapshot으로 backup한다.

```powershell
corepack pnpm db:backup:app -- --output backups/app.sqlite
```

`--output <path>`는 필수다. 이 명령은 `raw.sqlite` option이나 raw backup 기능을 제공하지 않는다. `var/`, `backups/`, `*.sqlite`, WAL과 SHM 파일은 Git-ignore 대상이다.

새 파일 restore, `PRAGMA integrity_check`와 대표 검색을 결합한 release recovery gate는 Feature 10에서 구현한다.

## 8. 검증

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:catalog:feature3
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
