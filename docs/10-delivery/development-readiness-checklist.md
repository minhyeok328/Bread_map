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
| Feature 6 | 추가 external 준비 없음 | local API contract test |
| Feature 7 | Kakao Login app, local callback, client secret | local OAuth·unlink smoke |
| Feature 8 | Kakao Map JavaScript/필요 REST access | local map·failure smoke |
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

## 6. Feature 7 Kakao Login

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

exact Auth.js adapter와 environment variable name은 Feature 7 구현이 manifest와 `.env.example`에 함께 고정한다.

## 7. Feature 8 Kakao Map

- [ ] Kakao Map product와 local JavaScript domain을 활성화한다.
- [ ] `http://127.0.0.1:3000`의 local origin 설정을 확인한다.
- [ ] 필요한 JavaScript·REST key를 local secret에 보관한다.
- [ ] map SDK·marker와 provider failure를 최소 request로 smoke한다.
- [ ] user exact origin과 provider response를 log·history에 저장하지 않는다.

Kakao Route의 이동시간·대중교통 기능은 후속 Feature다. Feature 8 완료를 위해 route billing·quota를 준비하지 않는다.

## 8. Feature 10 local release

- [ ] live source·Kakao smoke 범위를 operator가 승인한다.
- [ ] `app.sqlite` snapshot directory가 Git-ignore·local permission을 만족한다.
- [ ] restore를 active file이 아닌 새 file에 수행할 공간이 있다.
- [ ] `PRAGMA integrity_check`, migration, FTS와 대표 search를 확인한다.
- [ ] review experiment kill switch와 raw expiry를 확인한다.
- [ ] OpenAI network request와 cost가 `$0`인지 확인한다.
- [ ] public tunnel·remote deployment가 비활성인지 확인한다.

## 9. current·target environment 이름

Feature가 실제 구현될 때 `.env.example`에는 이름·설명·필요 Feature만 기록한다. 현재 구현된 storage·source·Feature 4 이름은 다음과 같다.

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
```

후속 Feature 예상 target:

```text
AUTH_SECRET
AUTH_KAKAO_ID
AUTH_KAKAO_SECRET
NEXT_PUBLIC_KAKAO_JS_KEY
```

실제 code가 읽지 않는 이름을 미리 current requirement로 취급하지 않는다. PostgreSQL·OpenAI 항목은 현재 `.env.example`과 runtime manifest에 존재하지 않는다.

## 10. 후속 원격 배포 준비

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

## 11. 개발 시작 승인 문구

Feature 1 foundation을 재검증했으면 secret 없이 다음처럼 공유한다.

> Node·Corepack·Git과 local disk 준비 완료. 외부 key 없이 SQLite storage foundation 검증 완료.

각 외부 Feature에서는 key 값 대신 `승인 완료`, `local secret 주입 완료`, `smoke 성공/실패`만 공유한다.
