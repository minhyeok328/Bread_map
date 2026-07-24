# 개발 준비 체크리스트

[구현·릴리스 안내](README.md) · [로컬 MVP 마스터 계획](../superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md) · [보안 설계](../06-trust/security-design.md)

이 문서는 현재 10개 Feature의 시작 전에 사용자가 준비할 항목을 정의한다. 실제 secret 값은 checklist·문서·Codex 대화에 넣지 않고 완료 여부와 비민감 상태만 공유한다.

## 1. Feature 1 시작 전

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

## 2. Feature별 외부 준비 시점

| 시점 | 준비 | 완료 확인 |
|---|---|---|
| Feature 1 | Node·Corepack·Git | version·repository 상태 확인 |
| Feature 2 | 행정안전부·FTC public data access | source별 승인·quota·response sample |
| Feature 3 | 추가 external 준비 없음 | Feature 2 snapshot으로 eligibility fixture |
| Feature 4 | local Playwright review 실험 위험 확인, encryption·HMAC key 주입 방법 | policy gate·one-page dry run |
| Feature 5 | 추가 external 준비 없음 | 고정 app/FTS fixture |
| Feature 6 | 추가 external 준비 없음 | local API contract test |
| Feature 7 | Kakao Login app, local callback, client secret | local OAuth·unlink smoke |
| Feature 8 | Kakao Map JavaScript/필요 REST access | local map·failure smoke |
| Feature 9 | 추가 external 준비 없음 | disabled chat shell·network 0 |
| Feature 10 | operator 승인 live smoke, local snapshot directory | snapshot·restore·release checklist |

외부 key가 준비되지 않은 Feature의 live smoke는 통과했다고 기록하지 않는다. unit·fixture 작업과 live integration 완료를 구분한다.

## 3. Feature 2 public data

- [ ] 행정안전부 `식품_제과점영업` OpenAPI 또는 file data 사용 조건을 확인한다.
- [ ] FTC brand 목록·취소·가맹점·가맹/직영 count 자료 접근을 확인한다.
- [ ] service key를 OS-protected secret 또는 Git-ignore environment에 보관한다.
- [ ] 승인 상태·quota·basis date·response schema를 기록한다.
- [ ] key 없이 사용할 수 있는 official file 경로와 key가 필요한 API를 구분한다.

공유 가능:

- source name
- 승인 여부
- quota와 response status

공유 금지:

- service key
- 전체 environment
- account·billing detail

## 4. Feature 4 local review 실험

실행 전:

- [ ] [정책 검토](../06-trust/policy-review.md)의 위험 문구를 읽고 동의한다.
- [ ] Kakao Map review 수집 허용이 확인된 것이 아님을 이해한다.
- [ ] local Playwright가 user service test와 분리돼 있다.
- [ ] review encryption key와 HMAC dedupe key를 각각 안전하게 주입할 수 있다.
- [ ] `raw.sqlite`를 장기 backup하지 않는다.
- [ ] active app snapshot directory와 raw 30일 delete를 확인한다.
- [ ] login·CAPTCHA·401·403·429·DOM change stop을 수용한다.

secret는 Codex 대화에 제공하지 않는다. 구현이 만든 key generation·injection 절차를 사용자가 local environment에서 실행한다.

## 5. Feature 7 Kakao Login

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

## 6. Feature 8 Kakao Map

- [ ] Kakao Map product와 local JavaScript domain을 활성화한다.
- [ ] `http://127.0.0.1:3000`의 local origin 설정을 확인한다.
- [ ] 필요한 JavaScript·REST key를 local secret에 보관한다.
- [ ] map SDK·marker와 provider failure를 최소 request로 smoke한다.
- [ ] user exact origin과 provider response를 log·history에 저장하지 않는다.

Kakao Route의 이동시간·대중교통 기능은 후속 Feature다. Feature 8 완료를 위해 route billing·quota를 준비하지 않는다.

## 7. Feature 10 local release

- [ ] live source·Kakao smoke 범위를 operator가 승인한다.
- [ ] `app.sqlite` snapshot directory가 Git-ignore·local permission을 만족한다.
- [ ] restore를 active file이 아닌 새 file에 수행할 공간이 있다.
- [ ] `PRAGMA integrity_check`, migration, FTS와 대표 search를 확인한다.
- [ ] review experiment kill switch와 raw expiry를 확인한다.
- [ ] OpenAI network request와 cost가 `$0`인지 확인한다.
- [ ] public tunnel·remote deployment가 비활성인지 확인한다.

## 8. target environment 이름

Feature가 실제 구현될 때 `.env.example`에는 이름·설명·필요 Feature만 기록한다.

예상 target:

```text
APP_SQLITE_PATH
RAW_SQLITE_PATH
REVIEW_ENCRYPTION_KEY_B64
REVIEW_DEDUPE_KEY_B64
DATA_GO_KR_SERVICE_KEY
AUTH_SECRET
AUTH_KAKAO_ID
AUTH_KAKAO_SECRET
NEXT_PUBLIC_KAKAO_JS_KEY
```

실제 code가 읽지 않는 이름을 미리 current requirement로 취급하지 않는다. Feature 1 전 `.env.example`의 PostgreSQL·OpenAI 항목은 전환 전 scaffold이며 제거 여부를 manifest와 함께 검증한다.

## 9. 후속 원격 배포 준비

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

## 10. 개발 시작 승인 문구

Feature 1 준비가 끝나면 secret 없이 다음처럼 공유한다.

> Node·Corepack·Git과 local disk 준비 완료. 외부 key 없이 SQLite storage foundation을 시작할 수 있음.

각 외부 Feature에서는 key 값 대신 `승인 완료`, `local secret 주입 완료`, `smoke 성공/실패`만 공유한다.
