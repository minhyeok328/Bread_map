# Feature 4 live DOM 날짜 호환 설계

[문서 허브](../../README.md) · [Feature 4 확장 설계](2026-07-29-kakao-review-year-backfill-incremental-design.md) · [정책 검토](../../06-trust/policy-review.md) · [결정 기록](../../09-decisions/decision-log.md)

**상태:** 구현·자동 검증 완료, sanitized live selector contract는 `SELECTOR_STOP_STATE_UNCONFIRMED`로 미생성, provider collection run 미실행

**승인일:** 2026-07-29

## 1. 문제와 확인 경계

실제 Kakao 공개·비로그인 장소 상세 DOM을 한 페이지에서 구조적으로 점검한 결과, 로그인·CAPTCHA·접근 거부는 없었지만 review 게시일은 점 구분 형식으로 노출됐다. 현재 collector는 selector가 반환한 날짜 text를 ISO `YYYY-MM-DD`로만 해석하므로, 실제 DOM용 selector contract를 만들어도 첫 read가 `DOM_CONTRACT_CHANGED`로 중단된다.

점검 과정에서 nickname, review body, 장소 locator와 실제 selector 값은 문서·로그에 남기지 않았고 provider collection run도 시작하지 않았다.

## 2. 검토한 접근

### A. extraction 경계에서 Kakao 날짜만 엄격 정규화

selector가 반환한 게시일을 memory-only parser가 ISO 또는 점 구분 날짜로 제한해 읽고, 유효한 달력 날짜만 ISO로 변환한 뒤 기존 cutoff·정렬 검증에 전달한다. 다른 형식은 기존처럼 provider run 전체를 중단한다.

장점은 provider 차이를 extraction 경계에 가두고 DB·계약·암호화 payload를 변경하지 않는다는 점이다.

### B. 공용 ISO parser 자체를 느슨하게 확장

`asOfDate`, checkpoint와 provider DOM 날짜가 같은 parser를 공유하게 한다. 구현량은 작지만 내부 제어값까지 provider 표시 형식을 허용해 계약 경계가 불필요하게 넓어진다.

### C. selector contract에 날짜 변환 규칙 추가

contract가 format 또는 transform을 선언하게 한다. 향후 provider 확장에는 유연하지만 이번 단일 Kakao 형식에 비해 schema·migration·검증 범위가 과도하다.

**선택:** A. 내부 제어 날짜는 ISO-only로 유지하고 실제 DOM text만 provider 경계에서 변환한다.

## 3. 날짜 정규화 계약

review 게시일은 trim·NFKC 후 다음 두 형식만 허용한다.

- ISO: `YYYY-MM-DD`
- Kakao 점 구분: `YYYY.M.D`, 구분점 뒤 공백과 마지막 점만 선택적으로 허용

점 구분 날짜는 연·월·일을 숫자로 분리한 뒤 실제 달력 날짜인지 검증한다. 월 1–12, 해당 월의 유효 일자와 윤년을 만족할 때만 zero-padding한 ISO 날짜로 변환한다.

다음 입력은 fail-closed다.

- 상대 날짜
- 시간 포함 값
- slash 또는 한국어 단위 날짜
- 두 자리 연도
- 존재하지 않는 달력 날짜
- 날짜 외 text가 붙은 값

변환된 ISO 값만 기존 12개월 cutoff, as-of 상한과 내림차순 검증에 사용하고 raw DOM text는 저장·출력하지 않는다.

## 4. 구현 경계

- `extract-review-page.ts` 내부에 provider DOM 날짜 정규화 함수를 둔다.
- `asOfDate`, 이전 checkpoint 날짜와 DB·contract field는 계속 ISO-only다.
- review body·nickname 비식별, HMAC, AES-GCM과 30/400일 보존에는 변경이 없다.
- active Playwright page 1개, 3초 action delay와 provider-wide stop 조건을 유지한다.
- 날짜가 변환되지 않거나 순서가 깨지면 `DOM_CONTRACT_CHANGED`로 전체 run을 중단한다.

## 5. 테스트와 live contract 생성

테스트는 production 변경 전에 다음 실패를 재현한다.

1. 유효한 점 구분 날짜가 현재 `DOM_CONTRACT_CHANGED`가 된다.
2. 구현 후 같은 날짜가 ISO로 변환돼 정상 처리된다.
3. 잘못된 달력 날짜와 허용하지 않은 형식은 계속 중단된다.
4. 기존 ISO fixture, cutoff, pagination과 정렬 검증은 회귀하지 않는다.

자동 검증이 통과한 뒤에만 실제 공개 DOM에서 normal review selector와 pagination 형태를 다시 확인한다. contract는 Git에서 제외되는 local `var/` 범위에 저장하고, actual selector 값·nickname·body·locator를 대화나 문서에 출력하지 않는다. selector별 match count와 contract version만 검증한다.

login·CAPTCHA·401·403·429·access denial·외부 origin redirect·DOM/order 변경이 나타나면 contract 생성을 포함한 provider 작업 전체를 즉시 중단한다.

### 2026-07-29 검증 결과

- 점 구분 날짜 정규화와 허용하지 않은 형식의 fail-closed 회귀를 구현하고 자동 검증했다.
- 공개·비로그인 Kakao 장소 페이지 한 탭에서 허용 origin, provider stop 부재와 review navigation 후보 1개를 확인했다.
- 정상 페이지에는 login wall·CAPTCHA·access denial 상태가 나타나지 않아 세 stop-state selector를 관찰 근거로 확정할 수 없었다.
- `SELECTOR_STOP_STATE_UNCONFIRMED`로 contract 생성 전에 중단했으며 pagination action, `.env.live` selector path 변경, loader/live extraction과 provider collection run은 실행하지 않았다.
- live `raw.sqlite` 변경은 없다.

## 6. 완료 조건

- [x] 점 구분 실제 DOM 날짜가 ISO로 memory-only 변환된다.
- [x] 허용하지 않은 날짜 형식은 fail-closed다.
- [x] targeted Feature 4·year-sync·fixture·typecheck·lint가 통과한다.
- [ ] sanitized v2 selector contract가 loader와 live DOM 구조 검증을 통과한다.
- [ ] `.env.live`에는 contract 절대 경로만 반영되고 secret 값은 출력되지 않는다.
- [x] 별도 최종 승인 전 실제 discovery·review collection run은 시작하지 않는다.
