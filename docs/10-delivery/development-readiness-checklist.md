# 개발 준비 체크리스트

[구현·릴리스 안내](README.md) · [로컬 MVP 마스터 계획](../superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md) · [Feature 1 상세 계획](../superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md) · [보안 설계](../06-trust/security-design.md)

이 문서는 현재 10개 Feature의 시작 전에 사용자가 준비할 항목을 정의한다. 실제 secret 값은 checklist·문서·Codex 대화에 넣지 않고 완료 여부와 비민감 상태만 공유한다.

## 1. Feature 1 foundation 실행·재검증

필수:

- [ ] Node.js 24 지원 범위가 설치돼 있다.
- [ ] Corepack을 사용할 수 있다.
- [ ] Git이 설치돼 있고 repository에서 commit할 수 있다.
- [ ] local disk에 source·SQLite test file·app snapshot용 여유 공간이 있다.

확인:

```powershell
node --version
corepack --version
git --version
```

Feature 1에는 다음이 필요하지 않다.

- Docker Desktop·WSL2
- Kakao Developers app·key
- public data service key
- OpenAI project·key·payment
- domain·HTTPS·hosting

Node·pnpm exact target은 [기술 스택 기준](technology-stack.md)을 따른다.

repository foundation 확인:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate
corepack pnpm db:backup:app -- --output backups/readiness.sqlite
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

`raw.sqlite` backup이나 Docker 실행은 readiness 항목이 아니다.

## 2. Feature별 외부 준비 시점

| 시점 | 준비 | 완료 확인 |
|---|---|---|
| Feature 1 | Node·Corepack·Git | version·repository 상태 확인 |
| Feature 2 | 선택적 행정안전부 LOCALDATA live access | fixture 자동 검증, live는 승인·quota·response status |
| Feature 3 | FTC brand·취소·가맹점·가맹/직영 count access | Feature 2 snapshot과 FTC fixture로 eligibility 검증 |
| Feature 4 | Kakao REST 장소 API, local Playwright review 위험, encryption·HMAC key | API contract·policy gate·one-page dry run |
| Feature 5 | 추가 external 준비 없음 | 고정 app/FTS fixture |
| Feature 6 | 추가 external 준비 없음 | `test:search:feature6` 고정 fixture gate, 검수 JSON importer 계약 |
| Feature 7 | Kakao Login app, local callback, client secret | local OAuth·unlink smoke |
| Feature 8 | server fixture에는 없음; live UI에 Kakao Map JavaScript app key·local domain | authenticated API fixture·local map failure smoke |
| Feature 9 | 추가 external 준비 없음 | disabled chat shell·network 0 |
| Feature 10 | operator 승인 live smoke, local snapshot directory | snapshot·restore·release checklist |

외부 key가 준비되지 않은 Feature의 live smoke는 통과했다고 기록하지 않는다. unit·fixture 작업과 live integration 완료를 구분한다.

## 3. Feature 2 public data

- [ ] 행정안전부 `식품_제과점영업` OpenAPI 또는 file data 사용 조건을 확인한다.
- [ ] service key를 OS-protected secret 또는 Git-ignore environment에 보관한다.
- [ ] 승인 상태·quota·basis date·response schema를 기록한다.
- [ ] key 없이 사용할 수 있는 official file 경로와 key가 필요한 API를 구분한다.

고정 fixture, typecheck, lint, test, build와 migration drift 검증에는 service key가 필요하지 않다. FTC 자료 준비와 적격 판정은 Feature 3에서 시작한다.

공유 가능:

- source name
- 승인 여부
- quota와 response status

공유 금지:

- service key
- 전체 environment
- account·billing detail

## 4. Feature 3 franchise·독립성 근거

자동 gate:

```powershell
corepack pnpm test:catalog:feature3
```

- [x] 고정 FTC 상태·운영 주체·관리자 판정 fixture로 단일/2/5/6 경계를 검증한다.
- [x] FTC 미일치만으로 독립성을 확정하지 않는 경로를 검증한다.
- [x] 같은 Feature 2 staging 재처리의 store·decision·publish 중복 0을 검증한다.
- [ ] 실제 FTC brand·취소·가맹점·가맹/직영 count access와 기준연도를 operator가 확인한다.
- [ ] 실제 공식 운영 주체 근거와 관리자 승인을 서울 대상별로 입력한다.

미완료 두 항목은 live data 검증이며 자동 test, CI, typecheck, lint, build와 migration drift의 선행 조건이 아니다. key 값·전체 FTC 응답·개인 식별정보는 문서나 log에 남기지 않는다.

## 5. Feature 4 local review 실험

자동 fixture gate:

```powershell
corepack pnpm test:reviews:feature4
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
```

- [x] Kakao 장소 response allowlist·서울 tile·정확한 `제과,베이커리` tag와 Feature 3 published-only match를 검증한다.
- [x] 최근 12개월 review가 20건을 초과해도 개수 상한 없이 처리하는 Feature 4 회귀 fixture를 검증한다.
- [x] DR-036 최근 12개월 전량 initial backfill·수동 incremental·fallback·60분 budget pause/resume fixture를 검증한다.
- [x] crash resume·fingerprint 중복 방지·30/400일 purge·web/raw static boundary를 검증한다.
- [x] fixture command가 status와 count만 출력하고 live network를 사용하지 않음을 검증한다.
- [x] 실제 DOM의 점 구분 게시일을 extraction 경계에서만 ISO로 정규화하고 지원하지 않는 형식은 fail-closed함을 검증한다.

2026-07-29 공개·비로그인 한 페이지 점검은 stop-state selector를 관찰 근거로 확정하지 못해 `SELECTOR_STOP_STATE_UNCONFIRMED`로 종료했다. sanitized v2 selector contract, pagination action과 provider collection run은 시작하지 않았다.

실행 전:

- [ ] [정책 검토](../06-trust/policy-review.md)의 위험 문구를 읽고 동의한다.
- [ ] Kakao Map review 수집 허용이 확인된 것이 아님을 이해한다.
- [ ] 현재 Kakao REST quota·keyword search response contract를 확인한다.
- [ ] 대상 Kakao Developers 앱의 실제 잔여 quota와 과금 설정을 확인한다.
- [ ] `KAKAO_REST_API_KEY`를 worker-only 환경에 주입한다.
- [ ] local Playwright가 user service test와 분리돼 있다.
- [ ] review encryption key와 HMAC dedupe key를 서로 다른 32-byte 값으로 안전하게 주입한다.
- [ ] nickname·review body 실제값이 없는 sanitized v2 selector contract version을 확인한다.
- [ ] active Playwright page 1개 제한과 expanded-volume operator acknowledgement를 확인한다.
- [ ] `raw.sqlite`를 장기 backup하지 않는다.
- [ ] raw ciphertext·locator 30일, seen fingerprint·sync state 400일 hard delete를 확인한다.
- [ ] login·CAPTCHA·401·403·429·DOM change stop을 수용한다.

secret는 Codex 대화에 제공하지 않는다. 구현이 만든 key generation·injection 절차를 사용자가 local environment에서 실행한다.

## 6. Feature 5 공개 리뷰·FTS5

자동 gate:

```powershell
corepack pnpm test:reviews:feature5
corepack pnpm db:check
```

- [x] fresh app/raw migration에서 public review·publish/index version과
  regular FTS5 table·trigger를 검증한다.
- [x] 실제 암호화 fixture의 게시·멱등 replay·partial/incremental
  merge·12개월 cutoff를 검증한다.
- [x] 누락 key·위변조·비공개 store·부적격/만료 raw 입력이 기존
  active corpus를 바꾸지 않음을 검증한다.
- [x] FTS query operator를 text 경계로 인코딩하고 FTS 장애를
  `FTS_UNAVAILABLE`로 축소한다.
- [x] web에서 raw DB·secret·collector·decrypt publisher 참조를
  자동 차단한다.

Feature 5 fixture gate에는 추가 external 준비, network, Docker,
OpenAI 호출이나 비용이 없다. live Kakao 수집이 미실행이어도 이
fixture gate의 완료를 막지 않으며 두 상태를 별도로 기록한다.

현재 Feature 4의 `REVIEW_KEY_VERSION`은 encryption과 HMAC fingerprint
version을 함께 식별한다. 실제 HMAC key 회전은 stable review ID가
달라질 수 있으므로 migration 설계 없이 운영에서 수행하지 않는다.

## 7. Feature 6 결정론적 검색

자동 gate:

```powershell
corepack pnpm test:search:feature6
corepack pnpm db:check
```

- [x] strict 구조화 input/result와 safe error 계약을 검증한다.
- [x] `catalog_publish_state` singleton, source metadata 일치, stale
  replay 거부와 새 snapshot 외 store demotion을 검증한다.
- [x] `MANUAL_VERIFIED` 로컬 JSON importer의 active catalog·published
  store 제한, 정규화 중복·영업시간 겹침 거부, atomic active swap과
  immutable batch를 검증한다.
- [x] opaque `search-data-v1`가 catalog/source identity·metadata,
  canonical 활성 공개 후보 facts hash, 검수 근거와 일관된
  review/FTS component 변경을 감지함을 검증한다.
- [x] request origin·exact distance·FTS rank·보정 별점·총점을 공개
  계약에서 거부하고 거리만 250m 상한 bucket으로 반환한다.
- [x] 정확히 20개 search-only 시나리오를 성공 18개와 safe error
  2개로 분리하고 Hit Rate `>=8500bp`, 제외 0, 100회 결정성,
  rating inversion 0, truthful FTS fallback과 10+100 p95
  `<1500ms`를 검증한다.

Feature 6 fixture gate에는 external key, network, browser, Docker,
OpenAI와 실제 메뉴·영업시간 수집이 필요하지 않다. importer는
실제 근거의 수집기나 독립 검수자가 아니므로, operator가 live JSON을
게시하려면 각 `evidenceRef`와 `verifiedAtMs`의 출처·검수 절차를
별도로 완료해야 한다. 고정 fixture 성공을 live 서울 추천 품질로
해석하지 않는다.

계정·지도·목록·상세·UI 검증은 Feature 7~10의 cross-feature E2E로
남는다.

## 8. Feature 7 Kakao Login

- [x] Auth.js·core·Drizzle adapter exact version과 production audit를 확인했다.
- [x] account 물리 schema에서 profile·OAuth token column을 제거했다.
- [x] hashed session revocation, exact Origin, 두 사용자 IDOR와 local-first 탈퇴 자동 test가 있다.
- [ ] `Bread_map`으로 식별 가능한 Kakao Developers app을 준비한다.
- [ ] 일반 Kakao Login을 활성화하고 KakaoSync를 요구하지 않는다.
- [ ] local callback `http://127.0.0.1:3000/api/auth/callback/kakao`를 등록한다.
- [ ] 최소 동의에 불필요한 email·phone·birthday·gender가 없다.
- [ ] client ID·secret를 server-only secret에 보관한다.
- [ ] service 탈퇴와 Kakao unlink flow를 확인한다.

공유 가능:

- app 생성·Login 활성화 여부
- 등록한 public local callback
- 최소 동의 화면 상태

공유 금지:

- client secret·token·cookie·provider account ID

exact Auth.js adapter와 environment variable name은 Feature 7 manifest와 `.env.example`에 고정됐다.

**live smoke 상태 (2026-07-30):** user-owned Kakao client ID·secret가
local environment에 없어 callback login과 provider unlink는
`NOT_RUN_CREDENTIALS_REQUIRED`다. secret·provider ID·token은 기록하지
않는다.

## 9. Feature 8 Kakao Map

- [ ] Kakao Map product와 local JavaScript domain을 활성화한다.
- [ ] `http://127.0.0.1:3000`의 local origin 설정을 확인한다.
- [ ] public JavaScript app key를 Git-ignore된 local environment에 보관한다.
- [ ] map SDK·marker와 provider failure를 최소 request로 smoke한다.
- [x] 인증된 strict 검색·상세 API와 snapshot bootstrap을 migrated fixture에서 검증한다.
- [x] 지도·목록·상세의 store ID와 snapshot 일관성을 검증한다.
- [x] user exact origin을 POST body·process memory 밖의 log·history·DB·응답에 저장하지 않는다.
- [x] provider 실패 시 같은 후보·주소·250m 거리 상한을 유지하는 `MAP_UNAVAILABLE` contract를 검증한다.

Kakao Route의 이동시간·대중교통 기능과 `/api/routes`는 후속 독립
Feature다. Feature 8 완료를 위해 Kakao REST route key,
billing·quota를 준비하지 않는다.

**live smoke 상태 (2026-07-30):** user-owned Kakao Map JavaScript app
key와 등록된 local domain이 없어 SDK·marker·provider failure smoke는
`NOT_RUN_CREDENTIALS_REQUIRED`다. 자동 API gate 성공을 live provider
성공으로 해석하지 않는다.

## 10. Feature 9 지도 중심 UI·비활성 chat shell

- [x] 승인된 design token을 CSS variable로 중앙화했다.
- [x] 목록·marker·상세가 같은 전체 후보와 snapshot, 선택 매장 ID를 사용한다.
- [x] 지도 실패에도 목록·주소·상세 접근을 유지한다.
- [x] FAB와 chat은 상호 배타이고 Escape·닫기 뒤 FAB로 focus가 복귀한다.
- [x] chat 입력·suggestion은 disabled이며 submit·저장·chatbot network 경로가 없다.
- [x] system Chrome E2E에서 keyboard, mobile/tablet/desktop/wide,
  200% 확대에 해당하는 유효 viewport와 reduced motion을 검증했다.
- [x] browser fixture gate에서 local server 이외 network 요청을 차단했다.
- [ ] user-owned Kakao Map JavaScript app key와 등록 domain으로 live SDK·marker를 smoke한다.

**자동 gate 결과 (2026-07-31):** `test:ui:feature9`의 12개 browser
scenario가 통과했다. live SDK smoke는 자격증명이 없어
`NOT_RUN_CREDENTIALS_REQUIRED`이며 자동 gate 실패가 아니다.

**main 전달 결과 (2026-07-31):** Feature 9 구현과 검증 기록을
`8712d5a`부터 `7b6436d`까지 11개 논리 커밋으로 분리해
`origin/main`에 fast-forward push했다.

## 11. Feature 10 local release

- [ ] live source·Kakao smoke 범위를 operator가 승인한다.
- [x] app/raw DB, snapshot, WAL/SHM, failed-run과 report 경로가
  Git-ignore되는지 자동 확인한다.
- [x] restore를 active file이 아닌 새 file에 수행하고 active DB를
  자동 교체하지 않는다.
- [x] `PRAGMA integrity_check`, foreign key, migration, FTS, checksum과
  대표 search를 확인한다.
- [x] review page-boundary pause·file reopen·checkpoint resume과
  duplicate 0건을 확인한다.
- [x] source/build/browser audit에서 OpenAI network request 0건과 비용
  `$0`를 확인한다.
- [x] production start script와 Auth.js origin이
  `http://127.0.0.1:3000`으로 고정됐는지 확인한다.
- [ ] public tunnel·remote deployment가 비활성인지 확인한다.

자동 release gate:

```powershell
corepack pnpm verify:local-mvp
```

**자동 gate 결과 (2026-07-31):** fresh app/raw migration, fixture ingest,
real SQLite search, checkpoint resume, app-only new-file restore, Feature 6
quality report, production build, real-route browser E2E 6건과
source/build/local-security audit가 통과했다. 보고서는
`test-results/local-mvp/report.json`에 기록되며 성공 run의 임시 DB는
제거된다.

**live smoke 상태 (2026-07-31):** Kakao Login·Map은
`NOT_RUN_CREDENTIALS_REQUIRED`, review collection은
`SELECTOR_STOP_STATE_UNCONFIRMED`다. repository 밖에서 실행 중인 public
tunnel은 코드만으로 확정할 수 없어
`NOT_RUN_OPERATOR_ATTESTATION_REQUIRED`다. 이 세 상태를 자동 통과로
해석하지 않는다.

## 12. current·target environment 이름

Feature가 실제 구현될 때 `.env.example`에는 이름·설명·필요 Feature만 기록한다. 현재 구현된 storage·source·Feature 4·7과 map client target 이름은 다음과 같다.

```text
APP_SQLITE_PATH
RAW_SQLITE_PATH
DATA_GO_KR_SERVICE_KEY
KAKAO_REST_API_KEY
REVIEW_POLICY_SNAPSHOT_ID
REVIEW_ENCRYPTION_KEY_BASE64
REVIEW_HMAC_KEY_BASE64
REVIEW_KEY_VERSION
KAKAO_REVIEW_SELECTOR_CONTRACT_PATH
AUTH_SECRET
AUTH_URL
KAKAO_CLIENT_ID
KAKAO_CLIENT_SECRET
NEXT_PUBLIC_KAKAO_MAP_APP_KEY
```

실제 code가 읽지 않는 이름을 미리 current requirement로 취급하지 않는다. PostgreSQL·OpenAI 항목은 현재 `.env.example`과 runtime manifest에 존재하지 않는다.

## 13. 후속 원격 배포 준비

현재 로컬 MVP와 분리한다.

- public domain·HTTPS
- production Kakao callback·JavaScript domain
- Vercel·Turso 또는 다른 hosting·database provider
- remote secret·backup·restore·incident response
- monthly cost와 payment
- participant 5명과 support schedule
- review 수집기 제거·허가·licensed replacement
- OpenAI model·key·token·call·cost approval

후속 Feature가 시작되기 전에는 provider·domain·participant를 선택할 필요가 없다.

## 14. 개발 시작 승인 문구

Feature 1 foundation을 재검증했으면 secret 없이 다음처럼 공유한다.

> Node·Corepack·Git과 local disk 준비 완료. 외부 key 없이 SQLite storage foundation 검증 완료.

각 외부 Feature에서는 key 값 대신 `승인 완료`, `local secret 주입 완료`, `smoke 성공/실패`만 공유한다.
