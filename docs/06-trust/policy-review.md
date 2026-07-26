# 외부 서비스와 review 정책 검토

[문서 허브](../README.md) · [보안 설계](security-design.md) · [시스템 구조](../04-architecture/system-architecture.md) · [리뷰 수집 실험](../07-experiments/review-collection-experiment.md)

이 문서는 로컬 MVP의 Kakao Login·Map, 위치와 지도 review 수집의 정책 경계를 기록한다. 법률 자문이 아니며 공개 배포·수집 확대·외부 AI 처리 전에는 최신 공식 약관과 필요한 전문 검토를 다시 수행한다.

## 1. 결정 요약

| 영역 | 로컬 MVP 결정 | 경계 |
|---|---|---|
| Kakao Login | account 기능에 사용 | 등록된 local callback, 최소 동의 |
| 위치 | 선택 동의 + browser 권한 | exact coordinate 비저장, 지역 직접 입력 |
| Kakao Map | 공개 매장 지도 표시 | 실패 시 목록·주소 유지 |
| Kakao Route | 후속 Feature | 좌표 전송·quota·저장 조건 재검토 |
| OpenAI | 비활성 | client·route·key 없음, 비용 `$0`, 새 승인 전 호출 금지 |
| 지도 review | 자동 수집 허용 근거 미확인 | 관리자 로컬 위험 실험만, 공개 배포 금지 |
| Vercel·remote DB | 후속 배포 | HTTPS·provider·data region·backup 재검토 |

## 2. Kakao Login

KakaoSync는 요구하지 않는다. Kakao Developers app에서 일반 Kakao Login을 활성화하고 Auth.js 호환 provider의 Authorization Code 흐름으로 내부 account를 만든다.

현재 준비:

- 정확한 local `127.0.0.1` callback 등록
- client ID·secret의 server-only 주입
- 개인정보 처리방침과 service 탈퇴·Kakao unlink 동선
- 필요한 Map product 활성화와 quota 표시 확인

최소 제공:

- 필수: provider account ID
- 선택: 표시용 nickname
- 요청하지 않음: email, phone, birthday, gender

Kakao Login 동의가 browser GPS 권한을 허용한다고 설명하지 않는다. service 탈퇴의 local data 삭제는 Kakao unlink 실패 때문에 지연하지 않는다.

공식 기준:

- [Kakao Login 이해하기](https://developers.kakao.com/docs/ko/kakaologin/common)
- [Kakao Login REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api)
- [Auth.js Kakao provider](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/kakao.ts)

## 3. 위치와 Kakao Map

정확 위치 사용 전 다음을 안내한다.

1. 거리·지도 중심 계산 목적
2. Kakao로 coordinate가 전송될 수 있는 범위
3. account·검색 기록·SQLite·log에 저장하지 않음
4. 거부 시 구·동·역 직접 입력 가능

service는 exact origin을 request 종료 후 폐기한다. Kakao가 자체 정책으로 처리하는 data와 빵찾깅의 비저장 정책을 같은 것으로 표현하지 않는다.

Kakao Local 또는 Map 응답은 공개 매장 표시·관리자 대조의 보조 자료일 뿐 공공 원장을 대체하지 않는다. Feature 4 장소 발견은 Kakao 공식 keyword search API에서 query `빵집`, 서울 범위, 마지막 category segment `제과,베이커리`를 적용한다. 공식 응답은 allowlist projection만 관측하고, Kakao place ID와 locator는 worker-only review navigation·resume에 필요한 동안만 보존한다. 전체 응답 JSON과 locator를 permanent catalog ID로 사용하지 않고 내부 `store_id`를 사용한다.

공식 장소 API의 quota·response contract·이용 조건 확인과 browser review 수집 위험 승인은 별도 gate다. 전자가 완료돼도 review 화면 자동 수집의 허용 근거가 생기지 않는다.

Kakao Route API의 이동시간·경로 대안은 후속 Feature다. 실제 도입 때 공식 quota·요금·지원 지역·response 보존·exact origin 전송을 다시 검토한다.

## 4. 지도 review 수집 위험

2026-07-18 검토에서 Kakao 장소 review의 자동 수집·복제·저장을 명시적으로 허용하는 공식 근거를 확인하지 못했다. robots.txt, service 약관·운영정책, 작성자 권리와 개인정보 위험이 남는다. 현재 source는 Kakao Map 하나이며 Naver adapter를 만들지 않는다.

금지 표현:

- `허용된 crawling`
- `합법성 확인 완료`
- `개인·비영리라서 문제없음`
- `local이라 문제없음`
- `암호화했으므로 수집 가능`

관리자 local 실행, 낮은 빈도, 최소 수집, 비식별과 encryption은 위험을 줄이는 통제이지 권한을 만들지 않는다.

참고:

- [Kakao 통합서비스약관](https://www.kakao.com/policy/terms?lang=ko&type=ts)
- [Kakao 운영정책](https://www.kakao.com/policy/oppolicy?lang=ko)
- [Kakao Map robots.txt](https://map.kakao.com/robots.txt)
- [Kakao Place robots.txt](https://place.map.kakao.com/robots.txt)

## 5. 로컬 review 실험 허용 경계

현재 허용 범위는 일반 user 기능이 아니라 [관리자 로컬 실험](../07-experiments/review-collection-experiment.md)이다.

- 관리자가 policy 위험을 매 실행 확인하고 명시적으로 시작
- 실행 시점의 서울 적격 store snapshot
- 공식 keyword search API로 완료한 서울 discovery snapshot
- Kakao Map의 최근 12개월·매장당 최대 20개
- browser page 1개, active run 1개
- local SQLite checkpoint 기반 순차 실행
- pause·resume·전체 stop·실패 store 재실행
- 예약·cron·지속 감시·site 전체 탐색 없음
- login·CAPTCHA·401·403·429·access denial·DOM change에서 즉시 중단
- session·cookie·private API·stealth·proxy 우회 금지
- nickname·ID·profile·photo·다른 활동 수집 금지
- 비식별 성공 body만 AES-256-GCM 암호화
- raw 30일 hard delete와 장기 backup 없음
- 장소 allowlist 관측은 400일, temporary locator는 run 완료 또는 최대 30일

Kakao Login으로 얻은 user session·cookie·token을 review 실험에 사용하지 않는다.

## 6. 수집 금지 동작

code·설정·수동 운영 어디에서도 다음을 허용하지 않는다.

- login 자동화와 account pool
- CAPTCHA OCR·풀이·수동 통과 뒤 자동 재개
- proxy·VPN·IP·User-Agent rotation
- browser fingerprint 위장·stealth plugin
- private JSON/XHR·GraphQL endpoint 탐색·호출·interception
- session cookie·token 추출·재사용
- robots.txt·access denial 무시
- screenshot·video·trace·HAR와 permanent browser profile 보존
- review image·OCR·EXIF 수집
- 상한을 여러 run으로 쪼개 우회

## 7. 공개 배포 gate

다음 중 하나를 만족하기 전에는 review 수집기와 수집 review를 공개 배포 기능에 포함하지 않는다.

1. review 저장·재이용 범위를 명시적으로 허용하는 공식 API
2. platform·권리자의 서면 허가
3. service 목적과 보존 범위를 허용하는 licensed data

어느 것도 없으면 수집기를 제거하고 공식 menu·관리자 검수·사용자 직접 제보 같은 허용 근거로 대체한다. 이미 만든 비식별 text와 FTS index의 계속 사용 가능성도 권리 범위에 따라 다시 판단한다.

## 8. OpenAI 비활성과 재승인

로컬 MVP는 OpenAI를 사용하지 않는다.

- OpenAI client·API route 없음
- `OPENAI_API_KEY` 요구 없음
- 검색·추천·review publish의 외부 AI 전송 없음
- OpenAI 비용 `$0`

후속 chatbot 또는 LLM 처리 Feature는 첫 call 전에 다음을 다시 승인한다.

- model·price basis date
- 입력 field와 deidentification
- `store:false`와 실제 data control
- token·call count·total cost hard cap
- prompt injection과 strict output validation
- retention·delete·incident 대응

`store:false`가 organization 차원의 Zero Data Retention을 자동 보장한다고 표현하지 않는다. 필요 시 [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)를 새 기준일에 다시 확인한다.

## 9. remote deployment 후속 검토

Vercel·Turso 또는 다른 remote hosting은 현재 완료 조건이 아니다. 후속 Feature에서 다음을 검토한다.

- public domain·HTTPS·production callback
- hosting·database region과 subprocess/worker 지원
- log·backup·secret manager와 operator access
- remote account deletion·incident·support
- 5인 pilot participant 안내와 consent
- review 수집기 완전 분리 또는 제거

## 10. 개인정보·저작권

최소 수집, 목적 제한, 보존·삭제와 안전조치는 [개인정보 보호법](https://www.law.go.kr/법령/개인정보보호법) 등 적용 기준을 검토한다. review text·database 이용은 [저작권법](https://www.law.go.kr/법령/저작권법), platform 약관과 작성자 권리를 함께 검토한다.

법적 해석이 필요한 공개 배포·수익화·대규모 수집은 문서 작성자의 판단으로 확정하지 않고 전문 검토를 받는다.

## 11. 재검토 trigger

- Kakao Login·Map 약관, API 또는 quota 변경
- Auth.js Kakao provider의 security·compatibility 변경
- local owner 범위를 넘는 remote deployment
- 위치를 background에서 사용하려는 요구
- review source·frequency·retention 확대
- review image·작성자 data·새 sensitive data 처리
- OpenAI 또는 다른 external AI 연결
- service 공개·유료화·서울 밖 확장

재검토 결과는 [결정 기록](../09-decisions/decision-log.md)에 date와 영향을 남긴다.

## 관련 문서

- security control: [보안 설계](security-design.md)
- review 실행 한도: [리뷰 수집 실험](../07-experiments/review-collection-experiment.md)
- cost·operation: [운영 기준](../08-operations/operating-baselines.md)
- field·retention: [데이터 설계](../05-data/data-design.md)
