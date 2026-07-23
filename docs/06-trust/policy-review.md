# 외부 서비스와 리뷰 정책 검토

[문서 허브](../README.md) · [보안 설계](security-design.md) · [시스템 구조](../04-architecture/system-architecture.md) · [리뷰 수집 실험](../07-experiments/review-collection-experiment.md)

이 문서는 Kakao 계정·경로 API, OpenAI 처리와 지도 리뷰 수집의 정책 경계를 기록한다. 법률 자문이 아니며 공개 배포·수집 범위 확대 전에는 최신 공식 약관과 필요한 전문 검토를 다시 수행한다.

## 1. 결정 요약

| 영역 | 현재 결정 | 배포 경계 |
|---|---|---|
| Kakao Login | P0 필수 로그인 | Kakao Developers 앱·redirect URI·최소 동의 설정 |
| 현재 위치 | 서비스 선택 동의 + 브라우저 권한 | 거부 시 직접 출발지, 정확 좌표 비저장 |
| Kakao 경로 | 2026-07-21 출시 API P0 통합 | 좌표 전송 고지, 쿼터·요금·저장 조건 재확인 |
| OpenAI | 의도·설명·비식별 리뷰 특징 | `store:false`, 좌표·인증·식별정보 제외 |
| 지도 리뷰 | 자동수집 허용 근거 미확인 | 관리자 로컬 위험 실험만, 공개 웹 배포 금지 |

## 2. Kakao Login

### 도입 전제

사업자 등록을 요구하는 KakaoSync는 P0에서 사용하지 않는다. Kakao Developers 앱에서 일반 Kakao Login을 활성화하고 Auth.js Kakao provider의 Authorization Code 흐름으로 자체 계정을 만든다.

- 개발·파일럿 도메인과 redirect URI 등록
- REST API key와 client secret을 배포 비밀 저장소에 주입
- 개인정보 처리방침과 서비스 탈퇴·Kakao unlink 동선 준비
- Bread_map을 계정의 첫 Kakao Map 활성 앱으로 등록하고 무료 쿼터 표시 확인

공식 기준:

- [Kakao Login 이해하기](https://developers.kakao.com/docs/ko/kakaologin/common)
- [Kakao Login REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api)

### 최소 제공 정보

계정 연결에는 Kakao provider account ID만 필수다. 이메일·전화번호·생일·성별은 기능에 필요하지 않으므로 동의 항목으로 요청하지 않는다. 닉네임은 화면 인사에 필요할 때만 선택한다.

### 위치와의 구분

Kakao 로그인 동의는 브라우저 GPS 권한을 부여하지 않는다. 실제 현재 위치는 로그인 후 서비스 안내와 브라우저·OS 권한을 별도로 거쳐야 한다.

## 3. Kakao Login과 Auth.js

OAuth와 세션을 직접 구현하지 않고 [Auth.js Kakao provider](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/kakao.ts)를 사용한다. 구현 시 현재 Auth.js·Kakao 공식 문서의 endpoint, callback 경로와 필수 설정을 다시 확인한다.

Kakao 계정 탈퇴와 서비스 탈퇴는 동일하지 않다. 서비스 탈퇴는 로컬 사용자 데이터 삭제와 Kakao unlink 요청을 함께 제공한다. unlink 실패가 로컬 삭제를 지연하지 않게 한다.

## 4. Kakao Maps 경로

2026-07-21 출시된 Kakao Maps 도보·대중교통 경로 API를 P0 대상으로 한다.

- [Kakao Maps API 공통](https://developers.kakao.com/docs/ko/kakaomap/common)
- [Kakao Maps REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [쿼터 안내](https://developers.kakao.com/docs/en/getting-started/quota)

경로 요청에는 정확한 출발 좌표와 공개 매장 목적지 좌표가 Kakao로 전송될 수 있다. 서비스는 이 전송 사실을 위치 선택 동의 전에 고지한다.

서비스 자체 기준:

- 정확 출발 좌표, Kakao 장소 ID와 원본 응답 영구 저장 금지
- 앱 전경에서 100m 이상 이동 또는 사용자 요청 시에만 재계산
- Kakao 실패 시 가짜 이동시간 금지
- 실제 구현·릴리스마다 요금·무료 쿼터·호출 제한·제공 지역·응답 보관 조건 확인

Kakao가 자체 정책에 따라 처리하는 데이터와 빵찾깅의 비저장 정책을 같은 것으로 표현하지 않는다.

## 5. 지도·장소 데이터

Kakao Local 응답은 관리자 대조와 외부 지도 연결 보조일 뿐 공식 원장을 대체하지 않는다. `id`, `place_url`, 응답 좌표와 전체 JSON은 요청 종료 후 폐기하고 자체 `store_id`를 영구 식별자로 사용한다.

외부 카카오맵으로 이동하면 Kakao가 목적지, IP, 브라우저 정보 등을 자체 정책에 따라 처리할 수 있음을 링크 실행 전에 알린다.

## 6. 지도 리뷰 수집

2026-07-18 검토에서 Kakao 장소 리뷰의 자동 수집·복제·저장을 명시적으로 허용하는 공식 근거를 확인하지 못했다. robots.txt, 서비스 약관·운영정책, 리뷰 작성자의 권리와 개인정보 위험이 남는다. P0 수집 대상은 Kakao Map 하나이며 Naver Map 어댑터는 만들지 않는다.

따라서 다음 표현을 금지한다.

- `허용된 크롤링`
- `합법성 확인 완료`
- `개인·비영리라서 문제없음`
- `암호화했으므로 수집 가능`

관리자 로컬 실행, 저빈도, 최소 수집과 암호화는 위험을 줄이는 통제이지 권한을 만들어내지 않는다.

참고:

- [Kakao 통합서비스약관](https://www.kakao.com/policy/terms?lang=ko&type=ts)
- [Kakao 운영정책](https://www.kakao.com/policy/oppolicy?lang=ko)
- [Kakao Map robots.txt](https://map.kakao.com/robots.txt)
- [Kakao Place robots.txt](https://place.map.kakao.com/robots.txt)

## 7. 리뷰 실험 허용 경계

현재 P0에서 허용한 것은 일반 사용자 서비스가 아니라 [관리자 로컬 실험](../07-experiments/review-collection-experiment.md)이다.

- 관리자가 서울 전체 적격 매장 batch를 명시적으로 시작하고 매 실행 위험 고지 확인
- Kakao Map의 매장별 최근 12개월·최대 20개
- 동시 페이지 1개와 PostgreSQL checkpoint 기반 순차 실행
- 일시정지·재개·전체 중단·실패 매장 재실행
- 예약·지속 감시·사이트 전체 탐색 없음
- 로그인, CAPTCHA, 403, 429, 접근 거부에서 즉시 중단
- 세션·쿠키·비공개 API·stealth·proxy 등 우회 금지
- 작성자 정보·사진·프로필 수집 금지
- 원문 암호화와 30일 hard delete

Kakao 로그인으로 얻은 사용자 세션이나 cookie를 리뷰 실험에 사용하지 않는다.

## 8. 공개 배포 게이트

다음 중 하나를 만족하기 전에는 리뷰 수집 기능을 공개 배포에 포함하지 않는다.

1. 리뷰 저장·재이용 범위를 명시적으로 허용하는 공식 API
2. 플랫폼·권리자로부터 받은 서면 허가
3. 서비스 목적과 보존 범위를 허용하는 라이선스 데이터

어느 것도 없으면 수집기를 제거하고 공식 메뉴·관리자 검수·사용자 직접 제보 같은 허용된 근거로 대체한다. 기존 구조화 특징의 계속 사용 가능성도 라이선스·권리 범위에 따라 다시 판단한다.

## 9. OpenAI 처리

OpenAI는 다음 입력만 받는다.

- 현재 대화의 필요한 텍스트와 허용된 구조화 상태
- 확정 추천의 공개 가능한 사실·근거
- worker가 식별정보를 제거한 리뷰 텍스트

보내지 않는 값:

- 정확 위치와 상세 출발지
- Kakao provider account ID, token과 session
- 관리자 메모와 비밀
- 리뷰 작성자 정보와 제거되지 않은 민감정보

Responses API에 `store:false`를 사용하지만 이것이 조직 차원의 Zero Data Retention을 자동 보장한다는 뜻은 아니다. 공개 운영 또는 민감도 확대 전 [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)를 다시 확인한다.

## 10. 개인정보·저작권 검토

최소 수집, 목적 제한, 보존·삭제와 안전조치는 [개인정보 보호법](https://www.law.go.kr/법령/개인정보보호법) 등 적용 기준을 검토한다. 리뷰 텍스트·데이터베이스 이용은 [저작권법](https://www.law.go.kr/법령/저작권법), 플랫폼 약관과 작성자 권리를 함께 검토한다.

법적 해석이 필요한 공개 배포·수익화·대규모 수집은 문서 작성자의 판단으로 확정하지 않고 전문 검토를 받는다.

## 11. 재검토 트리거

- Kakao Login·Kakao Maps 약관, API 또는 쿼터 변경
- Auth.js Kakao provider의 호환성·보안 변경
- 비공개 5인 범위를 넘는 배포
- 위치를 백그라운드에서 사용하려는 요구
- 리뷰 수집 빈도·플랫폼·보존 기간 확대
- 리뷰 이미지·작성자 데이터·새 민감정보 처리
- OpenAI 모델·보존 정책 또는 데이터 처리 지역 변경
- 서비스 공개·유료화·서울 밖 확장

재검토 결과는 [결정 기록](../09-decisions/decision-log.md)에 날짜와 영향을 남긴다.

## 관련 문서

- 구체적인 보안 통제: [보안 설계](security-design.md)
- 리뷰 실행 한도: [리뷰 수집 실험](../07-experiments/review-collection-experiment.md)
- 비용·쿼터: [운영 기준](../08-operations/operating-baselines.md)
- 데이터 필드·보존: [데이터 설계](../05-data/data-design.md)
