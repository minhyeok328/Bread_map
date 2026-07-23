# MVP 운영 기준

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [평가 계획](../02-recommendation/evaluation-plan.md) · [보안 설계](../06-trust/security-design.md)

이 문서는 5인 비공개 MVP를 한 명이 주당 최소 5시간으로 운영하기 위한 시간·비용·쿼터·최신성·분석 이벤트와 장애 대응 기준을 정의한다.

## 1. 운영 범위

- 사용자: 비공개 파일럿 5명
- 지역: 서울특별시
- 사용자 웹: 제한된 HTTPS 배포
- 관리자 데이터·리뷰 도구: 관리자 전용, 리뷰 수집은 로컬 worker만
- 운영 확보 시간: 주당 최소 5시간
- 공개 서비스·대규모 사용자 SLO가 아닌 파일럿 학습 기준

## 2. 주간 시간 배분

| 업무 | 주간 기준 |
|---|---:|
| 장애·보안·삭제 요청 확인 | 1시간 |
| 공공 원장·검수 큐·데이터 품질 | 1.5시간 |
| 추천 평가·파일럿 피드백 | 1시간 |
| 비용·쿼터·로그·백업 점검 | 0.5시간 |
| 개선 작업·문서 결정 기록 | 1시간 |

보안 사고, 삭제 실패, 원장 30일 초과는 개선 실험보다 우선한다. 리뷰 실험이 운영 시간을 반복적으로 초과하면 실험을 중단한다.

## 3. 서비스 기준

| 항목 | 목표·임계값 |
|---|---:|
| 입력 후 진행 표시 | 100ms 이내 |
| 외부 호출 제외 추천 계산 p95 | 1.5초 이하 |
| LLM 설명 없는 추천 응답 p95 | 2초 이하 |
| LLM 설명 포함 표시 | 10초 이하, 지연 로딩 |
| 위치 획득 대기 | 5초 후 직접 입력 제안 |
| 원장 최신성 경고 | 마지막 성공 7일 초과 |
| 새 추천 차단 | 마지막 성공 30일 초과 |
| 매장 개별 재검수 대기 | 180일 초과 |
| 가격·영업시간 하드 조건 사용 금지 | 검수 90일 초과 |

부분 실패에서 사용할 수 있는 목록·주소·과거 대화는 유지한다. 최신 영업 여부를 확인할 수 없으면 가짜·오래된 결과로 새 추천하지 않는다.

## 4. Kakao 계정 운영

릴리스 전 확인:

- 일반 Kakao Login 활성화와 최소 동의 항목
- Bread_map이 계정의 첫 Kakao Map 활성 앱인지와 무료 쿼터 표시
- 개인정보 처리방침 URL
- 개발·파일럿 callback URL 분리와 HTTPS
- Auth.js Kakao provider 현재 호환성
- client secret·Auth.js secret 회전 절차
- 탈퇴 Kakao unlink 성공·재시도 상태

로그인 성공률, callback 오류 코드, 세션 만료와 계정 소유권 거부 수를 관찰하되 Kakao provider account ID·token을 로그에 남기지 않는다.

## 5. 위치와 Kakao 경로

### 호출 원칙

- 현재 위치 선택 동의와 브라우저 권한이 있을 때만 정확 좌표 사용
- 앱 전경에서 100m 이상 이동 또는 사용자 새로 계산 시 재호출
- 같은 출발지 버킷·목적지·옵션의 동시 요청 합치기
- 사용자가 보고 있지 않은 화면의 선제 경로 호출 금지
- 정확 좌표·request body·원본 응답 로그·영구 저장 금지

### 쿼터 기준

Kakao 공식 쿼터 페이지를 릴리스마다 확인한다. 2026-07-22 계획 기준으로 첫 활성 앱의 도보·대중교통 무료 일일 쿼터를 각각 관찰하고 다음 경보를 둔다.

- 70%: 노란 경고, 중복·불필요 호출 조사
- 90%: 새 자동 재계산 soft stop, 사용자 수동 요청 우선
- 100% 또는 공급자 거부: 관련도순·직선거리 대체, 가짜 이동시간 금지

요금이 발생할 수 있는 앱·초과 호출은 관리자 명시 승인 없이 자동 전환하지 않는다. 기준 출처는 [Kakao quota](https://developers.kakao.com/docs/en/getting-started/quota)와 [Kakao Maps REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)다.

## 6. 비용과 OpenAI 승인 gate

5인 파일럿의 반복 web·PostgreSQL·OpenAI·Kakao 비용 합계는 월 30,000원 이하로 제한한다. 공급자 dashboard 예산은 알림용 soft threshold이므로 애플리케이션과 worker가 승인된 원화·token hard cap과 kill switch를 별도로 집행한다.

상한에 가까워지면 리뷰 특징 추출, 추천 설명, 의도 분석 순으로 대체 모드로 전환한다. 구조화 폼, 템플릿 설명과 결정론적 추천은 계속 제공한다. 유료 API·초과 쿼터와 상위 요금제로 자동 전환하지 않는다.

초기 서울 전체 리뷰 특징 추출은 반복 운영비와 분리한다.

1. 실제 리뷰 100개로 당시 사용 가능한 후보 모델의 strict schema 성공률, 특징 정확도, token, 비용과 처리 시간을 비교한다.
2. 전체 리뷰 수에 대한 예상 비용·시간을 계산한다.
3. 사용자에게 후보 모델과 일회성 상한을 제시한다.
4. 사용자 승인 전에는 100개를 넘는 전체 추출 batch를 실행하지 않는다.

모델·가격은 `requested_model_id`, `resolved_model_id`, 기준일 가격 설정과 실제 token 사용량으로 계산한다. 가격 변동을 문서의 고정 사실처럼 취급하지 않는다.

## 7. 공공데이터와 검수

- LOCALDATA 서울 원장: 매일 04:00 KST 목표
- 공정위 브랜드·가맹점: 주 1회, 새 기준연도 발견 시 재적재
- 공정위 규모 메타: 월 1회 확인
- 관리자 검수 큐: 주 1회 이상

새 적재가 실패하면 이전 성공 스냅숏을 유지하고 실패 시각·원인을 `/admin`에 표시한다. 7일 초과는 사용자에게 기준일 경고, 30일 초과는 새 추천 차단이다.

## 8. 리뷰 실험

- 예약 실행 없음
- Kakao Map 단일 출처, 매장별 최근 12개월·최대 20건
- 서울 전체 적격 매장 수동 batch, 동시 페이지 1개
- PostgreSQL checkpoint 기반 일시정지·재개·중단·실패 매장 재실행
- 초기 전체 뒤 우선순위 증분, 분기별 전체 갱신도 수동 시작
- 로그인·CAPTCHA·403·429·접근 거부 즉시 중단
- 원문 30일 hard delete

정책·접근 중단은 자동 재시도하지 않는다. 원문 기한 초과, 식별정보·평문 탐지, AES tag 실패가 한 건이라도 있으면 전역 kill switch를 활성화한다.

## 9. 분석 이벤트

이벤트에는 메시지·조건 원문, 정확 위치, 상세 주소, 건강 표현, provider ID·token과 리뷰 원문을 넣지 않는다.

| 이벤트 | 발생 시점 | 허용 속성 | 연결 지표 |
|---|---|---|---|
| `login_started` | Kakao 이동 전 | `request_id` | 로그인 funnel |
| `login_succeeded` | 세션 생성 | `duration_ms` | 로그인 성공률 |
| `login_failed` | callback 실패 | `error_code` | 로그인 실패율 |
| `location_notice_viewed` | 서비스 위치 카드 표시 | 없음 | 고지 노출 |
| `location_consent_granted` | 서비스 선택 동의 | 없음 | 위치 선택률 |
| `location_consent_denied` | 거부 | 없음 | 대체 수요 |
| `location_fallback_used` | 역·동·구 선택 | `origin_type` | 대체 완료율 |
| `conversation_created` | 새 대화 저장 | 없음 | 대화 시작 수 |
| `conversation_reopened` | 과거 대화 열기 | `age_band` | 재탐색 사용 |
| `conversation_deleted` | 삭제 commit | `had_recommendation` | 삭제 성공률 |
| `message_submitted` | 사용자 메시지 저장 | `turn_index`, `char_count_band` | 과업 소요 |
| `intent_updated` | 상태 version 저장 | `turn_type`, `changed_group_count` | 분석 성공률 |
| `clarification_shown` | 시스템 질문 | `reason_code`, `count` | 질문 부담 |
| `clarification_answered` | 사용자 응답 | `reason_code` | 질문 해결률 |
| `recommendation_requested` | 추천 노드 진입 | `sort_mode` | 추천 funnel |
| `recommendation_completed` | 결과 저장 | `result_count`, `duration_ms`, `route_coverage_band` | 완료율·성능 |
| `recommendation_empty` | 후보 0개 | `filter_count_bands` | 빈 결과율 |
| `sort_changed` | 두 정렬 전환 | `from`, `to`, `top_changed` | 가설 HYP-04 |
| `result_opened` | 상세 열기 | `rank_band`, `sort_mode` | 선택 행동 |
| `route_requested` | 경로 호출 | `transport_family`, `manual_refresh` | 경로 사용 |
| `route_failed` | 공급자 실패 | `error_code` | 대체 필요 |
| `favorite_changed` | 추가·해제 | `action` | 저장 행동 |
| `feedback_submitted` | 피드백 저장 | `feedback_type` | 품질 학습 |
| `conditions_copied_to_new_conversation` | 명시 복사 | `condition_group_count` | 과거 조건 재사용 |
| `fallback_started` | LLM·경로·위치 대체 | `provider`, `reason_code` | 대체 funnel |
| `fallback_completed` | 대체 과업 성공 | `provider`, `duration_ms` | 90% 목표 |

내부 사용자·대화 ID가 이벤트 결합에 필요하면 분석 전용 비가역 식별자로 변환하고 원본 provider ID를 사용하지 않는다.

## 10. 대시보드

### 제품

- 첫 추천 완료율과 중앙 소요 시간
- 빈 결과·회복률
- 정렬 전환과 선두 후보 변경률
- 과거 대화 재열람·조건 복사 사용
- 설명 만족도와 Hit Rate@5 최신 평가

### 신뢰

- 강한 제외 위반 0건
- 다른 계정 자원 접근 거부와 비정상 증가
- 위치 대체 사용률, 정확 좌표 금지 검사
- 대화·탈퇴 삭제 성공·실패
- 경로·LLM·지도 실패와 대체 완료율

### 데이터·비용

- 원장 기준일, active·published·stale 매장 수
- 검수 대기·품질 BLOCKER
- Kakao 호출량·쿼터·비용
- OpenAI token·비용·schema 실패
- raw 보존 만료·기한 초과와 key version

## 11. 장애 대응

### 로그인 장애

1. 신규 로그인 실패율과 Kakao 상태 확인
2. 기존 session은 유효성 검증이 되는 경우에만 유지
3. callback·secret·redirect URI 변경 확인
4. provider token과 account ID 없이 오류 코드 기록

### 위치·경로 장애

1. watcher 중단과 메모리 좌표 폐기 확인
2. 직접 출발지·관련도순·거리 대체 제공
3. 가짜 이동시간과 오래된 current 표시 금지
4. 쿼터·요금·응답 contract 변경 확인

### LLM 장애·상한

1. 한 번 재시도
2. 의도는 수정 가능한 폼, 설명은 템플릿
3. 리뷰 batch 중단
4. 결정론적 추천 유지

### 데이터 지연

1. 마지막 성공 스냅숏 유지
2. 7일 초과 경고
3. 30일 초과 새 추천 차단
4. 과거 대화는 당시 결과·기준일 표시로 열람 허용

### 삭제 실패

1. 계정을 `DELETING`으로 유지하고 새 접근 차단
2. cascade 삭제 idempotency key로 재실행
3. 서비스 데이터 삭제 후 Kakao unlink 실패는 별도 재시도
4. 내용이 없는 작업 ID·오류 코드만 기록

### 리뷰 안전장치 실패

1. 전역 kill switch
2. 신규 수집·복호화·추출 중단
3. 평문·기한 초과·암호화 영향 범위 확인
4. 삭제와 재집계 후에만 재개 검토

## 12. 백업과 복구

- `app_db`: 매일 암호화 `pg_dump`, 최근 7개 일간 + 4개 주간
- `raw_db`: 기본 백업 제외
- 공개 원본 snapshot: checksum과 730일
- RPO 24시간, RTO 2시간 목표
- 월 1회 빈 DB 복구, migration·FK·추천 뷰·tombstone 재생 확인
- 복구 후 삭제 tombstone 400일 재적용

백업에 정확 위치는 애초에 존재하지 않아야 한다. backup secret과 raw encryption key를 분리한다.

## 13. 릴리스 체크리스트

- Kakao Login·callback·최소 동의 검증
- 위치 문구·거부·철회와 100m 재계산 검증
- 다른 계정 IDOR·CSRF·session 만료 검증
- 강한 제외 0건·결정성 100%·Hit Rate@5 85% 이상
- Kakao 경로 전체 대안 정렬·부분 실패 검증
- LLM·지도·경로·위치·비용 상한 대체 흐름 검증
- 정확 좌표·message·review·secret 로그 부재 검사
- 원장 최신성·백업 복구·삭제 cascade 검증
- 리뷰 실험이 공개 build·CI에서 실행되지 않는지 검사
- 문서 기준일·결정 기록 갱신

## 관련 문서

- 제품 목표: [PRD](../00-product/prd.md)
- 평가: [평가 계획](../02-recommendation/evaluation-plan.md)
- 데이터 작업: [Worker 설계](../04-architecture/worker-design.md)
- 신뢰: [보안 설계](../06-trust/security-design.md), [정책 검토](../06-trust/policy-review.md)
