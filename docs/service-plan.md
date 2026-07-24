# 빵찾깅 서비스 기획서 이전 안내

이 문서는 2026-07-22에 주제별 기준 문서로 분리되었습니다. 이전의 단일 서비스 기획서 내용은 Git 이력에 보존되어 있으며, 현재 제품·기술 판단에는 2026-07-24 로컬 MVP 결정과 아래 책임 문서를 사용합니다.

## 시작점

- [로컬 우선 SQLite 웹 MVP 설계](superpowers/specs/2026-07-24-local-first-sqlite-web-design.md)
- [로컬 우선 SQLite MVP 마스터 구현 계획](superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md)
- [문서 허브](README.md)
- [제품 요구사항 문서](00-product/prd.md)
- [결정 기록](09-decisions/decision-log.md)

## 주제별 기준

- 사용자 흐름과 문구: [사용자 여정](01-experience/user-journey.md), [화면 상태와 카피](01-experience/ux-states-and-copy.md)
- 추천 후보·제외·정렬: [추천 기준](02-recommendation/recommendation-spec.md)
- 구조화 검색·추천 검증: [평가 계획](02-recommendation/evaluation-plan.md)
- 후속 자연어·설명 JSON 설계: [LLM 계약](03-contracts/llm-contracts.md)
- 인증·SQLite·외부 API 경계: [시스템 구조](04-architecture/system-architecture.md)
- 적재·집계 작업: [Worker 설계](04-architecture/worker-design.md)
- 스키마·출처·보존: [데이터 설계](05-data/data-design.md)
- 인증·위치·삭제: [보안 설계](06-trust/security-design.md)
- 플랫폼·법적 위험 경계: [정책 검토](06-trust/policy-review.md)
- 관리자 리뷰 실험: [리뷰 수집 실험](07-experiments/review-collection-experiment.md)
- 비용·쿼터·장애 대응: [운영 기준](08-operations/operating-baselines.md)

## 현재 해석 기준

- 현재 로컬 MVP는 `127.0.0.1`, SQLite·Drizzle·FTS5와 구조화 검색을 기준으로 한다.
- 현재 저장소의 PostgreSQL·Prisma 코드는 Feature 1 전환 전 scaffold이며 승인 목표가 아니다.
- 자연어·멀티턴·LLM 설명과 원격 배포·5인 파일럿은 후속 독립 Feature다.
- 추천 숫자 총점은 공개하지 않고 메뉴·영업·거리·비식별 리뷰 근거를 제공한다.
- 정확한 위치는 저장하지 않으며 의료·알레르기 안전을 판정하지 않는다.

이번 동기화의 범위와 실행 순서는 [로컬 MVP 책임 문서 동기화 설계](superpowers/specs/2026-07-24-local-mvp-document-sync-design.md)와 [실행 계획](superpowers/plans/2026-07-24-local-mvp-document-sync.md)에서 확인할 수 있습니다. 이전 제품 문서 재구성 배경은 [설계](superpowers/specs/2026-07-22-prd-restructure-design.md)와 [실행 계획](superpowers/plans/2026-07-22-prd-documentation-restructure.md)에 이력으로 남아 있습니다.
