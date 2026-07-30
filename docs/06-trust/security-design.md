# 보안과 개인정보 설계

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [시스템 구조](../04-architecture/system-architecture.md) · [데이터 설계](../05-data/data-design.md) · [정책 검토](policy-review.md)

이 문서는 사용자 PC의 `127.0.0.1`에서 실행하는 로컬 MVP와 Kakao account 구조의 인증, 계정 격리, 위치·review·SQLite file, secret와 삭제 기준을 정의한다.

## 1. 보호 목표

1. 한 사용자가 다른 사용자의 즐겨찾기와 검색/선택 기록을 보거나 바꾸지 못한다.
2. 정확한 사용자 위치가 SQLite·기록·log·analytics·외부 AI에 남지 않는다.
3. OAuth token, session, API key, raw encryption·dedupe key가 browser·DB·Git·log에 노출되지 않는다.
4. review nickname과 raw 평문이 `app.sqlite`, FTS5, browser와 log로 이동하지 않는다.
5. 기록 삭제와 탈퇴가 문서화된 범위를 실제로 제거한다.
6. app snapshot 복구가 삭제된 data와 만료 raw를 다시 노출하지 않는다.
7. web process가 `raw.sqlite`를 열거나 raw package를 import하지 못한다.

## 2. 데이터 분류

| 등급 | 예 | 저장 위치 | 원칙 |
|---|---|---|---|
| 계정 식별 | 내부 `user_id`, Kakao provider account ID | `app.sqlite` | server-scoped, 탈퇴 시 삭제 |
| 인증 비밀 | OAuth token, session token, cookie | server session·보호 저장 | 평문 log·client 노출 금지 |
| 사용자 기록 | favorite, normalized search/selection history | 계정별 `app.sqlite` | ownership, 사용자 삭제 |
| 일시 위치 | 정확 GPS 위도·경도 | browser·현재 request memory | 영구 저장·log·analytics 금지 |
| 거친 지역 | 사용자가 선택한 구·동·역 | 최소 검색 기록 | 정확 좌표로 확장하지 않음 |
| 공개 매장 data | 주소·좌표·영업·menu | `app.sqlite` | source·freshness 추적 |
| 비식별 review | 허용된 body·별점·날짜 | `app.sqlite`·FTS5 | nickname·fingerprint 없음 |
| 암호화 raw | 비식별 body ciphertext | worker 전용 `raw.sqlite` | 30일 hard delete, 장기 backup 없음 |
| 일시 reviewer ID | nickname | worker memory | HMAC 직후 폐기 |
| 운영 log | request ID, error code, duration, count | local log | path·본문·좌표·token 금지 |

## 3. Kakao Login

### 현재 구현 기준

- Auth.js 호환 Kakao provider의 Authorization Code 흐름을 사용한다.
- OAuth state, PKCE/nonce와 callback 검증을 축약하지 않는다.
- provider account ID를 내부 `user_id`와 분리한다.
- session cookie는 Auth.js 암호화 JWE, `HttpOnly`, `SameSite=Lax`, 갱신되지 않는 절대 6시간 만료를 사용한다.
- local callback은 Kakao에 등록된 정확한 `127.0.0.1` URI만 허용한다.
- request `Host`·forwarded host·scheme으로 임의 callback을 만들지 않는다.

HTTPS에서만 동작하는 `Secure` cookie와 production callback은 [후속 production 보안](#14-후속-production과-llm-보안)에서 별도 적용한다.

### 최소 동의

- 필수·저장: Kakao provider account ID
- 저장하지 않음: email, phone, birthday, gender, nickname, image
- OAuth scope는 profile 표시값을 제품 데이터로 수집하기 위해 확장하지 않는다.

profile nickname과 image는 authentication·account merge·authorization 근거로 사용하지 않는다.

### session

- Kakao access token은 탈퇴 unlink에 필요한 현재의 갱신되지 않는 절대 6시간 Auth.js 암호화 cookie 안에서만 유지하고 DB·browser JavaScript·session API·log에 내보내지 않는다.
- cookie의 random session ID는 SQLite에 SHA-256 lowercase hex hash로만 등록한다.
- logout·탈퇴와 security-relevant provider event에서 session을 폐기한다.
- expired session을 정리한다.
- 탈퇴 시작 시 새 user mutation을 먼저 차단한다.

## 4. 위치 동의와 memory 경계

Kakao Login, service 위치 선택 동의와 browser 위치 권한은 별도다.

위치 안내는 다음을 포함한다.

1. 거리와 map 중심 계산 목적
2. 공개 map provider로 전송될 수 있는 범위
3. account·검색 기록·SQLite·log에 저장하지 않음
4. 거부 시 구·동·역 직접 입력 가능

보호 규칙:

- service 안내에서 동의한 뒤에만 browser 권한을 요청한다.
- 정확 좌표는 현재 검색 request memory에서만 사용한다.
- request 종료·중지·권한 철회·오류에서 좌표를 폐기한다.
- service worker, localStorage, IndexedDB, replay와 analytics에 좌표를 전달하지 않는다.
- request body와 error breadcrumb에서 위치 field를 제거한다.
- 사용자가 선택한 거친 지역만 allowlist된 검색 기록에 저장할 수 있다.

## 5. 계정 소유권과 IDOR

모든 사용자 자원 query는 server session의 `user_id`를 조건으로 사용한다.

```text
favorite.user_id = session.user.id
search_history.user_id = session.user.id
selection_history.user_id = session.user.id
```

- URL·body의 `user_id`를 권한 근거로 사용하지 않는다.
- 다른 account와 없는 ID는 기본적으로 같은 404로 처리한다.
- batch 조회·삭제에도 ownership 조건을 포함한다.
- `store_id`는 공개 catalog ID지만 비적격·차단 매장은 user API에서 반환하지 않는다.
- 관리자 실행은 일반 user session과 분리하고 local operator 확인·재인증·audit를 요구한다.

test에는 연속·임의 ID, 다른 account의 유효 ID, 삭제 ID와 batch 혼합을 포함한다.

## 6. CSRF, XSS와 입력

- login·callback의 state/CSRF protection을 유지한다.
- favorite·기록 생성·삭제·탈퇴 mutation은 `Origin`이 정확히 `http://127.0.0.1:3000`일 때만 허용한다.
- 검색 문자열, 외부 menu와 review body를 HTML로 렌더링하지 않고 escape한다.
- Markdown을 허용한다면 raw HTML, 위험 URL scheme과 image tracking을 차단한다.
- 외부 URL은 `https` allowlist와 host 검증을 통과한 뒤 새 context로 연다.
- review body의 command나 markup을 실행하지 않는다.
- 검색 input 길이, enum과 Unicode normalization을 server에서 검증한다.

## 7. process·package·file 경계

### path

- web은 `APP_SQLITE_PATH`만 읽는다.
- worker는 `APP_SQLITE_PATH`와 `RAW_SQLITE_PATH`를 읽는다.
- `RAW_SQLITE_PATH`, `KAKAO_REST_API_KEY`, review encryption key와 dedupe key는 web environment에 주입하지 않는다.
- browser bundle과 public runtime config에는 어떤 SQLite path도 넣지 않는다.
- repository interface는 absolute path와 driver handle을 응답으로 반환하지 않는다.

### package

- `apps/web`은 app repository만 import한다.
- raw repository·Kakao locator·review collector·decrypt module은 `apps/worker`만 import한다.
- CI 또는 static import test로 web dependency graph의 raw import를 차단한다.
- worker가 app/raw 양쪽을 갱신할 때 cross-file atomicity를 가정하지 않고 idempotent checkpoint를 사용한다.

### local file

- `app.sqlite`, `raw.sqlite`, `-wal`, `-shm`과 snapshot은 Git-ignore한다.
- file은 project source가 아닌 local user data directory에 둔다.
- OS account 최소 permission을 적용하고 network share·cloud sync 기본 경로를 피한다.
- snapshot directory와 temporary restore file도 같은 보호를 적용한다.
- absolute path, file content와 file header를 log·error·UI에 표시하지 않는다.

## 8. review 보호

- nickname은 worker memory에서 fingerprint 계산 직후 폐기한다.
- Kakao keyword search 응답은 승인된 장소 field만 projection하고 전체 JSON을 저장하지 않는다.
- Kakao place ID와 URL locator는 worker-only `raw.sqlite`에만 임시 보존하고 web 응답·log에 포함하지 않는다.
- body의 URL, email, phone, account handle과 identifier pattern을 제거한다.
- 안전하게 비식별할 수 없으면 review 전체를 폐기한다.
- fingerprint는 store-scoped HMAC-SHA-256이며 `raw.sqlite`에만 둔다.
- 중복 방지용 seen fingerprint와 store sync anchor는 body·nickname·locator 없이 최대 400일만 보존한다.
- raw body는 AES-256-GCM과 row별 unique nonce로 암호화한다.
- encryption key와 dedupe key를 분리하고 version을 관리한다.
- decrypt 전에 auth tag와 AAD를 검증한다.
- raw ciphertext는 30일 뒤 hard delete하고 backup하지 않는다.
- HMAC key version이 sync state와 다르면 collection kill switch를 활성화하고 자동 backfill하지 않는다.
- 비식별 성공 body만 `app.sqlite`와 FTS5에 게시한다.

encryption과 local execution은 review 수집 권한을 만들어 주지 않는다.

## 9. secret 관리

현재 필요할 수 있는 secret:

- Auth.js secret
- Kakao client ID·client secret
- Kakao Map key
- Kakao Local REST API key
- review encryption key
- review HMAC dedupe key

`OPENAI_API_KEY`는 로컬 MVP 요구사항이 아니다.

secret는 environment 또는 OS-protected secret에 둔다. Git, Markdown, SQLite 일반 column, browser bundle, test fixture, terminal transcript와 screenshot에 넣지 않는다. 노출 의심 시 provider credential, session, encryption과 dedupe key를 영향 범위에 맞게 회전한다.

## 10. log와 analytics

### 허용

- 비민감 request ID, event name, success와 error code
- 후보·filter·review·FTS count
- duration과 snapshot·migration·recommendation version
- ownership access 거부 수
- backup·restore와 kill switch 상태

### 금지

- 검색·review body와 nickname
- Kakao place locator와 review fingerprint
- 정확 좌표·상세 사용자 주소
- provider account ID, OAuth/session token과 cookie
- API key, SQLite path, ciphertext, nonce, tag와 HMAC
- 건강·알레르기 표현

session replay를 사용하지 않는다. 후속 도입 시 login·location·account·review 화면을 기본 제외하고 별도 승인한다.

## 11. 삭제

### 기록

ownership을 확인하고 선택한 favorite 또는 검색/선택 기록만 짧은 `app.sqlite` transaction으로 삭제한다. 삭제 범위를 UI에 명시하고 다른 account data를 조용히 지우지 않는다.

### 탈퇴

1. 최근 authentication 확인
2. account를 deleting 상태로 전환하고 새 mutation 차단
3. session 폐기
4. favorite·검색/선택 기록 삭제
5. account·user 삭제
6. Kakao unlink 요청

Kakao unlink 실패는 local data 삭제를 rollback하지 않는다. 현재 구현은 provider token·provider account ID·retry row를 남기지 않고 `202 PENDING_MANUAL`만 반환한다.

### snapshot 복구

새 file restore 뒤 user delete tombstone과 current retention rule을 먼저 적용한다. 검증 전 file을 활성 `app.sqlite`로 교체하지 않는다. `raw.sqlite`는 restore 대상이 아니다.

## 12. 위협과 통제

| 위협 | 통제 |
|---|---|
| 다른 account record ID 추측 | server session ownership, 404 통일, IDOR test |
| OAuth callback 변조 | provider validation, exact registered local callback |
| session 탈취 | HttpOnly·SameSite, expiry, XSS/CSRF defense |
| exact location 유출 | request memory, body/APM masking, persistence field 금지 |
| malicious review markup | untrusted text, escaping, no tool execution |
| raw review 유출 | process/package/file 분리, AES-GCM, 30일 삭제 |
| SQLite file commit | Git-ignore, user data directory, status 검사 |
| 삭제 data 부활 | new-file restore, tombstone·retention replay |
| operator 오용 | local explicit action, reauth, audit, kill switch |

## 13. 필수 보안 검사

- Kakao callback state·registered URI 실패
- unauthenticated·expired session의 user mutation 차단
- account A가 account B의 favorite·history ID에 접근하는 IDOR matrix
- CSRF 없는 favorite·delete·withdrawal 차단
- exact coordinate가 schema·SQLite·log·analytics에 없는지 검사
- web의 `RAW_SQLITE_PATH`·raw package·key 접근 거부
- SQLite·WAL/SHM·snapshot Git-ignore와 path 비노출
- nickname·fingerprint·raw body가 app·FTS·browser·log에 없음
- ciphertext tamper와 30일 hard delete
- 기록 삭제·탈퇴 뒤 연결 row 0
- unlink 실패에서 local delete 유지
- XSS payload가 user·operator 화면에서 실행되지 않음

## 14. 후속 production과 LLM 보안

다음은 현재 완료 조건이 아니며 별도 Feature에서 다시 설계한다.

- public domain, HTTPS, `Secure` cookie와 production callback
- strict CSP, `frame-ancestors`, referrer policy, HSTS와 edge/proxy log
- remote DB·backup·secret manager와 incident response
- OpenAI client·API route·key
- prompt injection, model output schema, prompt/response retention
- conversation message·health expression privacy
- 5인 원격 pilot account와 support

후속 범위도 exact location, account ownership와 raw repository 경계를 완화할 수 없다.

## 관련 문서

- runtime·repository: [시스템 구조](../04-architecture/system-architecture.md)
- field·retention·restore: [데이터 설계](../05-data/data-design.md)
- external provider: [정책 검토](policy-review.md)
- local operation: [운영 기준](../08-operations/operating-baselines.md)
