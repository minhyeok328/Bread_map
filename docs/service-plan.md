# 빵찾깅 서비스 기획서 이전 안내

이 문서는 2026-07-22에 주제별 기준 문서로 분리되었습니다. 이전의 단일 서비스 기획서 내용은 Git 이력에 보존되어 있으며, 현재 제품·기술 판단에는 아래 문서를 사용합니다.

## 시작점

- [문서 허브](README.md)
- [제품 요구사항 문서](00-product/prd.md)
- [결정 기록](09-decisions/decision-log.md)

## 주제별 기준

- 사용자 흐름과 문구: [사용자 여정](01-experience/user-journey.md), [화면 상태와 카피](01-experience/ux-states-and-copy.md)
- 추천 후보·제외·정렬: [추천 기준](02-recommendation/recommendation-spec.md)
- 추천·파일럿 검증: [평가 계획](02-recommendation/evaluation-plan.md)
- 자연어·설명 JSON: [LLM 계약](03-contracts/llm-contracts.md)
- 인증·멀티턴·외부 API: [시스템 구조](04-architecture/system-architecture.md)
- 적재·집계 작업: [Worker 설계](04-architecture/worker-design.md)
- 스키마·출처·보존: [데이터 설계](05-data/data-design.md)
- 인증·위치·삭제: [보안 설계](06-trust/security-design.md)
- 플랫폼·법적 위험 경계: [정책 검토](06-trust/policy-review.md)
- 관리자 리뷰 실험: [리뷰 수집 실험](07-experiments/review-collection-experiment.md)
- 비용·쿼터·장애 대응: [운영 기준](08-operations/operating-baselines.md)

## 주요 변경

- 로컬 익명 프로필에서 카카오싱크 필수 계정으로 변경
- 추천 전 확인형 흐름에서 추천 이후에도 계속 수정하는 전체 세션 멀티턴으로 확장
- 계정 전체 장기 취향을 제거하고 대화별 상태만 유지
- 위치를 선택 동의 후 앱 전경에서 갱신하되 정확 좌표는 저장하지 않음
- 2026-07-21 출시된 Kakao 경로 API를 P0 대상으로 갱신
- 사용자에게 보이던 100점 추천 점수를 제거하고 이유·이동시간·거리 중심으로 변경
- 의료·알레르기 정보를 추천에 사용하지 않고 매장 직접 확인 고지로 통일

설계 배경과 실행 기록은 [제품 문서 재구성 설계](superpowers/specs/2026-07-22-prd-restructure-design.md)와 [문서 재구성 실행 계획](superpowers/plans/2026-07-22-prd-documentation-restructure.md)에서 확인할 수 있습니다.
