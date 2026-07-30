# 로컬 개발 환경

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서는 Feature 1의 로컬 SQLite 저장소, Feature 2의 서울 source
fixture 적재, Feature 3의 매장 정규화·적격 판정·catalog 게시,
Feature 4의 Kakao 장소 발견·암호화 리뷰 fixture pipeline과
Feature 5의 공개 리뷰 게시·FTS5 retrieval, Feature 6의 검수 검색
근거 게시·결정론적 구조화 검색, Feature 7의 Kakao 인증·사용자
데이터 API, Feature 8의 인증된 매장 검색·상세 API에 대한 설치,
migration, 실행, backup과 검증 절차를 소유한다.

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
| `KAKAO_REST_API_KEY` | 없음 | worker discovery live only | web·log·DB 주입 금지 |
| `REVIEW_POLICY_SNAPSHOT_ID` | 없음 | worker live only | 승인한 정책 검토본 식별자 |
| `REVIEW_ENCRYPTION_KEY_BASE64` | 없음 | worker review live only | 서로 다른 32-byte key 중 encryption key |
| `REVIEW_HMAC_KEY_BASE64` | 없음 | worker review live only | store-scoped fingerprint key |
| `REVIEW_KEY_VERSION` | 없음 | worker review live only | 비민감 key version |
| `KAKAO_REVIEW_SELECTOR_CONTRACT_PATH` | 없음 | worker review live only | nickname·본문 실제값이 없는 sanitized selector JSON 경로 |
| `KAKAO_CLIENT_ID` | 없음 | web Kakao Login live only | Kakao REST app key, client 공개 식별자지만 server config로만 사용 |
| `KAKAO_CLIENT_SECRET` | 없음 | web Kakao Login live only | Git·log·DB 금지 |
| `NEXT_PUBLIC_KAKAO_MAP_APP_KEY` | 없음 | web Kakao Map live only | 브라우저 공개 app identifier; REST key·secret가 아니며 Feature 8 서버 gate에는 불필요 |
| `AUTH_SECRET` | 없음 | web auth live only | Auth.js cookie encryption secret, 충분한 random 값 필수 |
| `AUTH_URL` | `http://127.0.0.1:3000` 고정 | web | 다른 값이면 시작 거부 |

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

web은 `127.0.0.1`에 bind한다. source 적재는 아래의 별도 worker command이며, Feature 7 사용자 API는 활성화됐지만 챗봇 submit/API는 현재 Feature 범위에 포함되지 않는다.

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

## 7. Feature 4 Kakao 장소 발견·암호화 리뷰 fixture

### 자동 fixture 검증

아래 명령은 live network, Kakao key와 브라우저 binary 없이 실행한다.

```powershell
corepack pnpm test:reviews:feature4
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
```

discovery fixture는 서울 `빵집` 검색 응답 중 정규화 tag가 정확히 `제과,베이커리`인 allowlist 장소만 관측한다. review fixture는 20건을 초과하는 최근 12개월 review를 개수 상한 없이 비식별한 뒤 nickname을 폐기하고 HMAC fingerprint와 AES-256-GCM 암호문만 `raw.sqlite` 경계에서 검증한다. year-sync gate는 initial backfill·incremental·fallback·budget pause/resume과 30/400일 hard delete를 검증한다. 두 fixture command는 status와 count summary만 출력한다.

### 사용자 승인 one-page live smoke

live smoke는 정책 허용을 의미하지 않는다. 현재 Kakao 사용 조건, 대상 앱의 실제 quota·과금 설정, 실제 공개 DOM으로 검증한 sanitized v2 selector contract, 중단 조건, worker-only secret, 확장된 접근량 인지와 명시적 operator 승인을 모두 확인한 경우에만 실행한다. 처음 한 번은 local Chromium binary도 별도로 설치해야 한다.

```powershell
corepack pnpm exec playwright install chromium
corepack pnpm --filter @bread-map/worker exec tsx src/commands/discover-kakao-bakeries.ts --live
corepack pnpm --filter @bread-map/worker smoke:kakao:live
```

60분 예산으로 중단된 같은 logical run은 operator가 다음처럼 수동 재개한다. `<run_id>`는 비밀값이 아니지만, run row의 locator나 raw payload를 조회·출력해서는 안 된다.

```powershell
corepack pnpm --filter @bread-map/worker exec tsx src/commands/collect-reviews.ts --live --acknowledge-policy-risk --acknowledge-expanded-volume-risk --one-page --run-budget-minutes 60 --resume-run <run_id>
```

`smoke:kakao:live`는 `--acknowledge-policy-risk --acknowledge-expanded-volume-risk --one-page --run-budget-minutes 60`을 고정하며 active page를 1개로 제한한다. login·CAPTCHA·401·403·429·access denial·외부 origin redirect·DOM/order contract 변경을 만나면 provider run 전체를 즉시 중단하고 자동 retry하지 않는다. 이 명령은 CI·일반 web·cron에서 실행하지 않으며, `raw.sqlite`는 장기 backup·snapshot·restore하지 않는다.

provider DOM의 유효한 점 구분 게시일은 extraction 경계에서만 ISO로 정규화하고, 잘못된 달력 날짜·상대 날짜·slash·한국어 단위·시간 포함 형식은 `DOM_CONTRACT_CHANGED`로 fail-closed한다. `asOfDate`, checkpoint와 DB field는 계속 ISO-only다.

2026-07-29 공개·비로그인 한 페이지 구조 점검에서는 provider stop이 나타나지 않아 login wall·CAPTCHA·access denial selector를 관찰 근거로 확정할 수 없었다. 결과는 `SELECTOR_STOP_STATE_UNCONFIRMED`이며 sanitized v2 selector contract를 생성하지 않았고 pagination action과 `.env.live` selector path 변경도 실행하지 않았다.

현재 정책·대상 앱 실제 quota·sanitized v2 selector·expanded-volume acknowledgement·명시적 operator 승인이 live gate의 별도 확인 항목이며, review DOM 수집 허용 근거도 확인되지 않았다. 따라서 discovery·review provider run은 시작하지 않았고 live `raw.sqlite` 변경과 수집 성공을 주장하지 않는다.

## 8. Feature 5 리뷰 게시·FTS5 retrieval

Feature 5 자동 gate는 fresh app/raw migration, 실제 AES-256-GCM
fixture, transactional publish, FTS5 trigger·query와 web/raw/publisher
경계를 함께 검증한다.

```powershell
corepack pnpm test:reviews:feature5
corepack pnpm db:check
```

publisher는 worker에서만 실행하며 `SUCCEEDED` 또는 `PARTIAL` raw
run의 비식별 암호문만 입력으로 받는다. raw 보존 기한, exact key
version, `MATCHED_ELIGIBLE`, published·active store를 app write 전에
검증한다. 누락 key, 인증 tag 위변조, FTS 불일치 또는 SQL 실패 시
새 version 전체가 rollback되고 기존 active corpus가 유지된다.

public `review_document`에는 nickname, fingerprint, ciphertext, nonce,
authentication tag, key version과 provider locator를 저장하지 않는다.
12개월보다 오래된 public 문서는 다음 publish에서 제거되며
`PARTIAL`·incremental run에 없는 non-expired 문서는 삭제로 해석하지
않는다.

매장이 published·active 상태를 벗어나면 해당 public review와 FTS
문서는 즉시 함께 삭제한다. 이 purge는 현재 MVP에서 되돌릴 hidden
archive를 만들지 않으므로, 매장이 다시 published가 되어도 과거
문서를 자동 복원하지 않고 이후 새로 수집 가능한 review만 게시한다.

`packages/retrieval`은 FTS 입력을 Unicode letter/number token으로
정규화·인코딩하고 app DB만 읽는다. active metadata·문서·FTS count가
불일치하거나 FTS 실행이 실패하면 `FTS_UNAVAILABLE`과 빈 결과를
반환한다. Feature 6은 이 상태에서 구조화 필터 fallback을 사용한다.

이 gate에는 새 외부 key, Docker, network, OpenAI 호출이나 비용이
없다. 실제 Kakao review 수집은 Feature 4의 별도 operator gate로
남는다.

## 9. Feature 6 검수 근거·결정론적 검색

### 검수된 로컬 JSON 게시

Feature 6은 외부 메뉴·영업시간 수집기를 제공하지 않는다. operator가
출처를 직접 검증한 로컬 JSON 한 파일을 다음 명령으로 게시한다.

```powershell
corepack pnpm --filter @bread-map/worker publish:search-evidence -- --input <verified-search-evidence.json>
```

다른 app DB 파일을 명시적으로 사용할 때만 `--app-db <path>`를
추가한다. 그렇지 않으면 `APP_SQLITE_PATH`, 이어서
`var/app.sqlite`를 사용하고 필요한 app migration을 먼저 적용한다.

입력 root는 정확히 다음 계약을 만족해야 한다.

- 활성 `catalog_publish_state`의 `catalogPublishId`
- `contractVersion: "search-evidence-v1"`
- `menus`: store, 검수 이름·category, 선택 menu alias
- `storeAliases`: `STORE_NAME` 또는 `REGION`
- `businessHours`: weekday·sequence·open/close minute·next-day 여부
- 모든 근거의 `source: "MANUAL_VERIFIED"`, 비어 있지 않은
  `evidenceRef`, nonnegative `verifiedAtMs`

unknown field, 미검수 source, 정규화 중복, 겹치거나 잘못된 영업시간,
비활성 catalog와 published·active가 아닌 store는 쓰기 전에
거부한다. 정상 batch는 canonical SHA-256으로 content-addressed
publish ID와 checksum을 만든다. 같은 transaction에서 parent를
`BUILDING`으로 만들고 자식 row를 쓴 뒤, 네 종류의 선언 건수를 한 번
정확히 확인해 `ACTIVE`로 전환한다. 활성·폐기 batch에는 자식을 추가할
수 없고, 검증 실패 시 기존 active slot을 유지한 채 전체를 rollback한다.
파일 read·JSON parse 실패는 원문·path를 public 결과에 싣지 않고 safe
error code로 종료한다.

이 importer의 존재와 fixture 성공은 실제 서울 메뉴·alias·영업시간을
수집하거나 독립적으로 검수했다는 뜻이 아니다. live 근거 파일은
출처·검수 절차를 별도로 완료한 operator만 게시한다.

### 검색 snapshot과 공개 계약

- `catalog_publish_state(state_id='active')`가 유일한 catalog
  pointer다. source basis date·download time이 연결된
  `source_snapshot`과 다르면 검색은 fail-closed한다.
- `dataSnapshotVersion`은 catalog/source identity·metadata, canonical
  활성 공개 후보 facts SHA-256, 활성 검수 근거, 일관된 활성
  review/FTS component를 묶은 opaque
  `search-data-v1_<64 lowercase hex>`다. 같은 publish ID 아래 공개
  매장 facts가 바뀌어도 version이 바뀐다.
- 요청은 repository가 inspect한 전체 version을 그대로 사용한다.
  mismatch는 `SEARCH_DATA_VERSION_MISMATCH`, source basis date가
  요청일보다 미래거나 30일을 넘으면 `SEARCH_DATA_STALE`다.
- exact origin과 distance는 요청 메모리의 filter·sort에만 사용한다.
  공개 item은 250m 단위 상한 `distanceUpperBoundM` 또는 `null`만
  반환하고 origin·exact distance·FTS rank·보정 별점·총점을
  반환하지 않는다.

### 자동 gate

```powershell
corepack pnpm test:search:feature6
corepack pnpm db:check
```

`test:search:feature6`은 strict 계약과 migration, active catalog·검색
근거 게시, 순수 필터·정렬, SQLite snapshot repository, FTS fallback과
정확히 20개 search-only fixture 평가를 함께 실행한다. 평가 분모는
성공 시나리오 18개와 safe error 2개로 분리하며 Hit Rate
`>=8500bp`, 하드 제외 0, 100회 결정성, rating inversion 0, truthful
FTS fallback, 핵심 fallback 2개의 개별 필수 hit, 10회 warm-up 뒤
100회 p95 `<1500ms`를 요구한다. 별도 `PARTIAL` 선언이 없는 성공
시나리오는 모두 `COMPLETE`여야 한다.

고정 fixture gate는 구현 결정성만 증명한다. live source·독립-human
추천 품질, 지도·web E2E는 후속 Feature gate다.

## 10. Feature 7 Kakao 인증·사용자 데이터

먼저 migration을 적용하고 user-owned Kakao app의 local secret를
process 또는 Git-ignore된 `.env.local`에 주입한다. `AUTH_SECRET`은
출력하지 않고 process memory에 생성할 수 있다.

```powershell
corepack pnpm db:migrate
$env:AUTH_SECRET = & node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:AUTH_URL = "http://127.0.0.1:3000"
```

`KAKAO_CLIENT_ID`와 `KAKAO_CLIENT_SECRET`은 Kakao Developers
console에서 준비해 같은 local secret 경계로 주입한다. shell history,
문서, Git, SQLite나 terminal 출력에 실제 값을 남기지 않는다. Kakao
app에는 다음 callback 하나를 등록한다.

```text
http://127.0.0.1:3000/api/auth/callback/kakao
```

자동 gate:

```powershell
corepack pnpm test:auth:feature7
corepack pnpm db:check
```

`test:auth:feature7`은 최소 account schema, OAuth/profile 비저장
adapter, 갱신되지 않는 절대 6시간 encrypted JWT, hashed session registry, fixed callback
origin, exact-Origin CSRF, 두 사용자 IDOR, normalized history와
local-first withdrawal·unlink 실패를 실제 임시 SQLite에서 검증한다.

실제 Kakao 자격증명이 있을 때만 다음 수동 smoke를 수행한다.

1. `http://127.0.0.1:3000/api/auth/signin`에서 Kakao로 로그인하고
   정확한 callback으로 돌아오는지 확인한다.
2. `/api/auth/session`이 내부 user ID·만료·authentication 시각 외
   profile·token·provider ID를 반환하지 않는지 확인한다.
3. 위치 권한이나 위치 값을 제공하지 않은 채 `/api/favorites` GET이
   인증된 빈 목록 또는 현재 사용자의 목록을 반환하는지 확인한다.
4. logout 뒤 기존 session이 거부되고 재로그인이 되는지 확인한다.
5. 같은 origin에서 확인 문자열로 `/api/account` DELETE를 호출해
   local row 삭제와 Kakao unlink를 확인한다.

2026-07-30 현재 repository에는 user-owned Kakao 자격증명이 없어서
이 live login·unlink smoke는 미실행이다. 자동 gate 성공을 live
provider 성공으로 해석하지 않는다.

## 11. Feature 8 매장·지도 서버 API

인증된 web은 같은 활성 검색 snapshot을 사용해 다음 API를 호출한다.

- `POST /api/stores`: exact `Origin: http://127.0.0.1:3000`과 유효한
  session을 요구한다. Feature 6 strict query와 nullable
  `dataSnapshotVersion`을 JSON body로 받고 지도·목록이 함께 사용할
  완전한 `items` 배열을 반환한다.
- `GET /api/stores/{storeId}`: 유효한 session과 필수
  `dataSnapshotVersion`을 요구한다. `reviewPage`는 1~1000,
  `reviewLimit`은 1~20이고 기본값은 각각 1과 10이다.

exact origin은 POST body와 요청 process memory에서만 계산에
사용하며 URL·DB·history·응답·오류에 넣지 않는다. 상세 응답은
검수 메뉴·영업시간, 비식별 review, 별점, freshness와 각 publish
version을 제공하고, hidden·out-of-snapshot store는 같은 404로
처리한다.

자동 gate:

```powershell
corepack pnpm test:map:feature8
corepack pnpm db:check
```

Feature 8 서버는 Kakao나 다른 외부 network를 호출하지 않는다.
Kakao Route와 `/api/routes`는 후속 독립 Feature이며 이동시간을
추정하지 않는다. Map JavaScript SDK 실패는 Feature 9 client가
같은 API `items`, 주소와 250m 거리 상한을 유지한 채
`MAP_UNAVAILABLE` 상태로 표현한다.

2026-07-30 현재 user-owned `NEXT_PUBLIC_KAKAO_MAP_APP_KEY`와 등록된
local JavaScript domain이 없어 live map smoke는
`NOT_RUN_CREDENTIALS_REQUIRED`다. 이 상태는 자동 API gate의 실패가
아니다.

## 12. app DB 온라인 backup

active app DB를 읽을 수 있는 SQLite snapshot으로 backup한다.

```powershell
corepack pnpm db:backup:app -- --output backups/app.sqlite
```

`--output <path>`는 필수다. 이 명령은 `raw.sqlite` option이나 raw backup 기능을 제공하지 않는다. `var/`, `backups/`, `*.sqlite`, WAL과 SHM 파일은 Git-ignore 대상이다.

새 파일 restore, `PRAGMA integrity_check`와 대표 검색을 결합한 release recovery gate는 Feature 10에서 구현한다.

## 13. 검증

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:catalog:feature3
corepack pnpm test:reviews:feature4
corepack pnpm test:reviews:year-sync
corepack pnpm test:reviews:feature5
corepack pnpm test:search:feature6
corepack pnpm test:auth:feature7
corepack pnpm test:map:feature8
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
