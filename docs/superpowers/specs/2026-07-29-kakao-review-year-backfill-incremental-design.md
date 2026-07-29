# Feature 4 확장 · Kakao 최근 12개월 전량 backfill·수동 증분 수집 설계

[문서 허브](../../README.md) · [Feature 4 승인 설계](2026-07-26-kakao-bakery-review-collection-design.md) · [정책 검토](../../06-trust/policy-review.md) · [결정 기록](../../09-decisions/decision-log.md)

**상태:** 사용자 승인, 책임 문서·구현 반영 전

**승인일:** 2026-07-29

**대상:** 기존 Feature 4의 매장당 20건 상한을 제거하고, 최근 12개월 전량 backfill과 operator 수동 증분 수집을 추가하는 확장

## 1. 결정 요약

기존 Feature 4의 Kakao 장소 발견, Feature 3 `catalog_status='published'` 매장 제한, active Playwright page 1개, 비식별·암호화, provider 전체 중단, 30/400일 보존 경계는 유지한다.

변경되는 항목은 review 수집량과 재실행 의미다.

- 최초 성공 run은 공개·비로그인 DOM에서 정상적으로 노출되는 최근 12개월 review를 개수 상한 없이 오래된 방향으로 처리한다.
- 후속 run은 operator가 수동으로 시작하며, 최신 review부터 이전 성공 run의 fingerprint anchor와 겹치는 지점까지 읽어 신규 review만 처리한다.
- cron, daemon, 예약 실행, 지속 감시와 자동 재시도는 추가하지 않는다.
- 하나의 logical run은 실행 시간 예산에 도달하면 `PAUSED_BUDGET`으로 checkpoint를 남길 수 있다. 같은 run의 수동 resume은 허용하지만, 새 run을 만들어 안전 경계를 우회하지 않는다.
- “전량”은 수집 시점에 Kakao가 공개·비로그인 DOM으로 정상 노출하고 승인 selector contract가 해석할 수 있는 범위를 뜻한다. 삭제·비노출·접근 제한·DOM 변경으로 확인할 수 없는 review까지 수집했다고 주장하지 않는다.

## 2. 현재 외부 조건과 정책 해석

2026-07-29 기준 Kakao 공식 문서는 키워드 장소 검색 API의 무료 일간 쿼터를 100,000건, 전체 API 무료 월간 쿼터를 3,000,000건으로 안내한다. 2026-07-21부터 Kakao Map API 무료 쿼터는 개발자 계정에서 처음 활성화한 앱에만 적용되며, 다른 앱 또는 무료 쿼터 초과 사용에는 비즈월렛과 유료 사용 설정이 필요할 수 있다.

- [Kakao Map 이해하기·이용 정책](https://developers.kakao.com/docs/ko/kakaomap/common)
- [Kakao Developers 쿼터](https://developers.kakao.com/docs/ko/getting-started/quota)
- [Kakao Local REST API](https://developers.kakao.com/docs/ko/local/dev-guide)

이 쿼터는 공식 장소 발견 API의 경계다. review DOM 자동 수집·저장·재이용을 허용하는 공식 API나 명시적 허용 근거는 확인되지 않았다. 따라서 전량 backfill은 허용된 crawling이나 합법성 확인 완료로 표현하지 않고, 기존보다 접근량이 커지는 정책 위험 관리자 로컬 실험으로만 다룬다.

live 전에 operator가 다음을 별도로 확인해야 한다.

1. 대상 Kakao Developers 앱의 실제 일간·월간 잔여 quota와 과금 설정
2. 실행 시점의 Kakao 약관·운영정책·robots와 review 저장·재이용 위험
3. 실제 공개 DOM에서 검증한 sanitized selector contract
4. worker-only secret와 기존 provider-stop 조건
5. 확장된 접근량을 인지했다는 명시적 acknowledgement

이 중 하나라도 확인되지 않으면 fixture 구현과 검증까지만 완료하고 live run을 시작하지 않는다.

## 3. 검토한 접근

### A. 매번 최근 12개월 전체 재탐색

모든 수동 run이 최신 review부터 12개월 cutoff까지 다시 읽고 HMAC ledger로 중복 저장만 막는다. 구현은 단순하고 과거에 늦게 삽입된 review도 다시 관측할 수 있지만, 이미 확인한 page를 반복해 외부 접근량과 정책 위험이 가장 크다.

### B. 최초 전량 backfill + fingerprint anchor 기반 증분

최초 run만 12개월 cutoff까지 읽는다. 후속 run은 최신 review부터 읽다가 이전 성공 run의 알려진 fingerprint anchor와 겹치면 해당 page를 끝까지 확인한 뒤 완료한다. anchor가 사라졌거나 신뢰할 수 없으면 조용히 완료하지 않고 같은 logical run을 12개월 backfill 모드로 승격한다.

이 방식은 일반적인 신규 review 수집에서 반복 접근을 줄이면서, anchor 삭제·본문 수정·30일 ciphertext 삭제 뒤에도 400일 HMAC ledger로 중복 저장을 막는다.

### C. 20건을 더 큰 고정 상한으로 교체

100건·500건 같은 상한은 운영량을 제한하기 쉽지만 “최근 12개월 전량”을 보장하지 못하고, 상한 변경을 반복하게 만든다.

**선택:** B. A는 operator가 명시적으로 요청하는 repair/reconciliation mode를 별도 설계하기 전까지 제공하지 않고, C는 채택하지 않는다.

## 4. 목표와 비목표

### 목표

1. 각 published 매장의 최근 12개월 review를 개수 상한 없이 최초 backfill한다.
2. 실행 시간 예산으로 pause·resume해도 같은 logical run의 missing과 duplicate를 0으로 유지한다.
3. 후속 수동 run은 이전 성공 anchor까지의 overlap을 확인하고 신규 review만 저장한다.
4. encrypted body가 30일 뒤 삭제돼도 400일 seen-fingerprint ledger로 재수집 중복을 막는다.
5. 수집 범위, partial·pause·provider stop과 count만 operator에게 보고한다.
6. 기존 개인정보·암호화·provider-stop·web/raw 경계를 완화하지 않는다.

### 비목표

- 12개월보다 오래된 review
- 일반 user가 시작하는 수집
- cron·예약·daemon·자동 resume
- login·CAPTCHA·access denial·429 우회
- proxy·stealth·계정·cookie·private API 사용
- review image, profile, 작성자 ID와 nickname 저장
- Kakao가 삭제·비노출하거나 DOM에서 제공하지 않는 review의 복원
- `app.sqlite` 게시와 FTS5
- 공개 배포와 대규모 상업 수집

## 5. 상태와 실행 모드

### review run mode

- `INITIAL_BACKFILL`: 해당 store에 완료 anchor가 없을 때 최근 12개월 cutoff까지 진행
- `INCREMENTAL`: 이전 성공 anchor가 있을 때 최신부터 overlap까지 진행
- `BACKFILL_FALLBACK`: incremental anchor가 사라졌거나 수정돼 같은 logical run에서 12개월 cutoff까지 계속 진행

### review run status

- `READY`
- `RUNNING`
- `PAUSED_OPERATOR`
- `PAUSED_BUDGET`
- `SUCCEEDED`
- `PARTIAL`
- `STOPPED_POLICY`
- `STOPPED_ACCESS`
- `FAILED_FINAL`

`PAUSED_BUDGET`은 성공이 아니다. operator가 같은 `run_id`로 resume해 모든 target store가 cutoff, DOM end 또는 유효 anchor에 도달해야 `SUCCEEDED`가 된다.

## 6. 데이터 모델 확장

### `review_seen_fingerprint`

worker-only `raw.sqlite`에 다음 allowlist field를 둔다.

- provider
- `store_id`
- 32-byte HMAC fingerprint
- fingerprint key version
- published date
- first-seen·last-seen 시각
- 400일 expiry

review body, nickname, locator, ciphertext, nonce와 auth tag는 이 table에 두지 않는다. unique key는 `(store_id, provider, fingerprint_key_version, fingerprint)`다.

### `review_store_sync_state`

- provider
- `store_id`
- 마지막 성공 mode
- 마지막 성공 run ID
- 마지막 성공 as-of date
- anchor fingerprint와 fingerprint key version
- anchor published date
- 완료 시각
- 400일 expiry

anchor는 비식별 성공 review 중 최신 stable fingerprint다. 한 run에서 모든 review가 비식별 실패해 anchor를 만들 수 없으면 incremental 완료 상태를 만들지 않고 다음 run도 backfill로 처리한다.

### 기존 보존 유지

- encrypted review와 temporary locator: 최대 30일 hard delete
- seen fingerprint, sync state, run·checkpoint·audit: 최대 400일
- `raw.sqlite`: 장기 backup·snapshot·restore 금지
- `app.sqlite` backup: raw data 포함 금지

HMAC key는 400일 dedupe window 동안 안정적으로 유지한다. 노출로 key rotation이 필요한 경우 collection kill switch를 먼저 활성화하고 ciphertext·fingerprint ledger의 영향 범위를 삭제한 뒤, operator가 새 initial backfill을 별도로 승인한다.

## 7. 수집 알고리즘

### 공통 전제

- 대상 query는 Feature 3 `catalog_status='published'`이며 strong Kakao match가 있는 store만 반환한다.
- browser active page는 정확히 1개다.
- review는 최신에서 오래된 순서라는 contract를 page 경계까지 검증한다.
- cutoff는 run의 고정 `as_of_date`에서 UTC calendar month 기준 12개월 전이다.
- 수집 중 날짜가 최신→과거 순서를 위반하면 `DOM_CONTRACT_CHANGED`로 provider run 전체를 중단한다.

### 최초 backfill

1. 최신 review page에서 시작한다.
2. page별 DOM contract와 provider-stop signal을 먼저 검사한다.
3. cutoff 이상인 review를 비식별 → HMAC → nickname 폐기 → AES-GCM → raw commit → seen ledger → checkpoint 순으로 처리한다.
4. cutoff보다 오래된 첫 review 또는 review DOM end에 도달하면 store를 완료한다.
5. locator, page cursor와 fingerprint 반복을 탐지하면 `FAILED_FINAL`로 중단한다.

review 개수 hard cap은 두지 않는다.

### 후속 증분

1. 최신 review부터 처리한다.
2. 새 fingerprint는 암호화 row와 seen ledger에 저장한다.
3. 이전 anchor를 발견하면 현재 page의 나머지 review까지 확인한다.
4. 현재 page에 새 fingerprint가 더 없고 날짜 순서가 유효하면 store를 완료한다.
5. anchor를 찾기 전에 cutoff에 도달하면 `BACKFILL_FALLBACK` 완료로 기록한다.

fingerprint가 이미 seen ledger에 있으면 ciphertext를 다시 만들지 않고 `duplicate_count`만 증가시킨다.

### pause와 resume

- 기본 live run 시간 예산은 60분이다.
- 예산 도달 시 현재 committed checkpoint 뒤에서 `PAUSED_BUDGET`으로 종료한다.
- resume은 같은 run·같은 `as_of_date`·같은 policy snapshot·같은 selector contract version·같은 key version만 허용한다.
- 조건이 바뀌면 기존 run을 resume하지 않고 operator 검토 후 새 run을 시작한다.

## 8. 외부 접근과 중단

review DOM page action 사이에는 최소 3초의 고정 간격을 적용한다. random delay, User-Agent rotation과 browser fingerprint 위장은 사용하지 않는다. 이 간격은 수집 권한을 만들지 않으며 provider signal이 우선한다.

다음은 provider run 전체를 즉시 중단하고 자동 retry하지 않는다.

- login·relogin 요구
- CAPTCHA·human verification
- HTTP 401·403·429
- access denial·abnormal traffic·automation warning
- 외부 origin redirect
- selector·DOM·날짜 정렬 contract 변경
- policy snapshot `DENY` 또는 `UNKNOWN`
- SQLite·crypto·fingerprint ledger integrity failure
- operator kill switch

한 store의 비민감 field parse 실패는 `FAILED_STORE`로 격리할 수 있지만, 날짜 순서·anchor·provider access 관련 오류는 다른 store로 진행하지 않는다.

## 9. CLI와 non-disclosure

live command는 기존 gate에 다음을 추가한다.

- `--acknowledge-expanded-volume-risk`
- `--run-budget-minutes 60`
- `--resume-run <run_id>` 또는 새 run 중 정확히 하나

command 출력은 다음 count와 status만 허용한다.

- run status·mode
- 대상·완료·실패 store count
- collected·duplicate·rejected count
- paused 여부와 non-sensitive reason code

review body, nickname, fingerprint, locator, ciphertext, secret, DOM과 SQLite 절대 path는 stdout·stderr·log·error·summary에 포함하지 않는다.

## 10. 검증

### 단위·fixture

- 20건 상한 제거와 21건 이상 처리
- calendar 12개월 cutoff 경계
- 최신→과거 page ordering과 위반 중단
- initial backfill의 DOM end·cutoff 완료
- incremental anchor overlap과 신규 review만 저장
- anchor 삭제·수정 시 backfill fallback
- 60분 budget pause와 같은 run resume
- run 조건 변경 시 resume 거부

### DB 통합

- 30일 ciphertext 삭제 뒤 400일 fingerprint가 중복 재수집 방지
- 400일 fingerprint·sync state hard delete
- seen ledger unique constraint
- raw commit과 seen-ledger/checkpoint crash 지점별 idempotency
- HMAC key version 불일치에서 collection 차단
- raw backup·web import 0

### provider stop

- login·CAPTCHA·401·403·429·access denial·외부 redirect·DOM/order 변경에서 이후 store 처리 0
- 자동 retry·새 page·artifact 생성 0
- CLI와 test output의 민감 field 노출 0

## 11. 완료 조건

- 20건 상한이 코드·계약·fixture·책임 문서에서 제거된다.
- initial fixture는 20건을 초과하는 최근 12개월 review를 모두 처리하고 cutoff에서 완료된다.
- incremental fixture는 신규 review만 저장하고 overlap anchor 뒤에 멈춘다.
- budget pause·resume 뒤 missing과 duplicate encrypted row가 0이다.
- 30일 ciphertext 삭제 뒤 같은 review를 다시 암호화하지 않는다.
- nickname·review 평문·fingerprint·locator·ciphertext·secret의 출력 노출이 0이다.
- provider-stop과 30/400일 retention 경계가 유지된다.
- current Kakao policy·actual app quota·sanitized selector·secret·expanded-risk acknowledgement를 operator가 확인하기 전 live run이 시작되지 않는다.
- live가 중단되거나 미실행이면 성공을 주장하지 않는다.

## 12. 책임 문서와 GitHub 영향

구현 시 새 결정 기록으로 DR-035의 review 개수 상한만 확장하고, 장소 발견·published 대상·보안·중단 규칙은 유지한다. 다음 문서를 같은 변경에서 동기화한다.

- `docs/09-decisions/decision-log.md`
- `docs/05-data/data-design.md`
- `docs/06-trust/policy-review.md`
- `docs/06-trust/security-design.md`
- `docs/07-experiments/review-collection-experiment.md`
- `docs/08-operations/operating-baselines.md`
- `docs/10-delivery/development-readiness-checklist.md`
- `docs/10-delivery/local-development.md`
- Feature 4 설계·마스터 계획의 후속 범위 링크

GitHub #14는 기존 20건 제한 Feature 4의 구현 이력으로 보존한다. 이 확장 설계·구현·live gate는 별도 GitHub issue가 필요하지만, issue 생성·수정은 데이터 수집 및 코드 변경과 분리해 사용자 승인 후 수행한다.
