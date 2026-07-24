# 빵찾깅 문서 허브

[저장소 소개](../README.md) · [제품 요구사항](00-product/prd.md) · [결정 기록](09-decisions/decision-log.md)

이 문서는 빵찾깅의 제품·기술 기준을 찾기 위한 단일 시작점이다. 같은 규칙을 여러 문서에 복제하지 않고, 아래 `기준 문서`가 해당 주제의 최종 정의를 소유한다.

## 권장 읽기 순서

1. [제품 요구사항](00-product/prd.md)에서 사용자, 문제, P0 범위와 성공 기준을 확인한다.
2. [사용자 여정](01-experience/user-journey.md), [화면 상태·카피](01-experience/ux-states-and-copy.md)와 [UI 디자인 시스템](01-experience/design-system.md)에서 실제 경험과 시각·상호작용 기준을 확인한다.
3. [추천 기준](02-recommendation/recommendation-spec.md)과 [평가 계획](02-recommendation/evaluation-plan.md)에서 추천의 판정과 검증 방식을 확인한다.
4. [LLM 계약](03-contracts/llm-contracts.md)과 [시스템 구조](04-architecture/system-architecture.md)에서 멀티턴 처리와 시스템 경계를 확인한다.
5. [데이터 설계](05-data/data-design.md), [보안 설계](06-trust/security-design.md)와 [정책 검토](06-trust/policy-review.md)에서 저장·권한·외부 전송 기준을 확인한다.
6. [로컬 우선 SQLite 웹 MVP 설계](superpowers/specs/2026-07-24-local-first-sqlite-web-design.md)에서 현재 목표를 먼저 확인한다. [로컬 개발 환경](10-delivery/local-development.md), [기술 스택 기준](10-delivery/technology-stack.md), [폴더 구조](10-delivery/directory-structure.md), [기존 P0 마스터 구현 계획](superpowers/plans/2026-07-23-p0-master-implementation.md)과 [개발 준비 체크리스트](10-delivery/development-readiness-checklist.md)는 현재 scaffold와 이전 계획의 이력으로 사용한다.

## 기준 문서

| 영역 | 문서 | 책임 |
|---|---|---|
| 제품 | [PRD](00-product/prd.md) | 사용자, 문제, P0, 요구사항, 지표, 로드맵 |
| 경험 | [사용자 여정](01-experience/user-journey.md) | 로그인부터 추천·과거 대화·삭제까지의 흐름 |
| 경험 | [화면 상태와 카피](01-experience/ux-states-and-copy.md) | 화면 상태, 실패 대체 흐름, 공식 안내 문구 |
| 경험 | [UI 디자인 시스템](01-experience/design-system.md) | 지도 중심 레이아웃, 시각 토큰, 빵빵이 FAB 채팅, 반응형·접근성 |
| 추천 | [추천 기준](02-recommendation/recommendation-spec.md) | 후보, 제외, 내부 관련도, 정렬, 동점 |
| 추천 | [평가 계획](02-recommendation/evaluation-plan.md) | 오프라인 평가, 5인 파일럿, 수용 기준 추적 |
| 계약 | [LLM 계약](03-contracts/llm-contracts.md) | 자연어 구조화, 설명, 리뷰 특징 출력 계약 |
| 구조 | [시스템 구조](04-architecture/system-architecture.md) | 인증, LangGraph, 앱·DB·외부 API 경계 |
| 구조 | [Worker 설계](04-architecture/worker-design.md) | 적재, 정규화, 검수, 리뷰 실험, 집계 작업 |
| 데이터 | [데이터 설계](05-data/data-design.md) | 출처, 스키마, 보존, 품질, 삭제와 복구 |
| 신뢰 | [보안 설계](06-trust/security-design.md) | 인증, 계정 격리, 위치·대화 개인정보, 비밀 |
| 신뢰 | [정책 검토](06-trust/policy-review.md) | Kakao·리뷰 플랫폼·외부 처리 정책 경계 |
| 실험 | [리뷰 수집 실험](07-experiments/review-collection-experiment.md) | 관리자 로컬 Playwright 실험과 중단 조건 |
| 운영 | [운영 기준](08-operations/operating-baselines.md) | 시간, 비용, 쿼터, 최신성, 장애 대응 |
| 결정 | [결정 기록](09-decisions/decision-log.md) | 승인 일자, 대안과 결정 영향 |
| 구현 | [로컬 개발 환경](10-delivery/local-development.md) | 설치, 환경변수, 실행과 검증 명령 |
| 구현 | [기술 스택 기준](10-delivery/technology-stack.md) | runtime, framework, database, test 도구와 version |
| 구현 | [폴더 구조](10-delivery/directory-structure.md) | monorepo package 소유권과 import 경계 |
| 구현 | [구현·릴리스 안내](10-delivery/README.md) | 실행 계획, 사용자 준비, 릴리스 산출물 |

## 문서 상태

| 문서군 | 상태 | 기준일 |
|---|---|---:|
| 제품·경험·추천·아키텍처 | 2026-07-23 구현 로드맵 결정 반영 | 2026-07-23 |
| 데이터 설계 | Kakao 단일 출처·12개월·20개·180일 반감기 반영 | 2026-07-23 |
| 리뷰 수집 | 서울 전체 수동 batch 설계, 공개 배포 불가 | 2026-07-23 |
| 애플리케이션 구현 | 기존 Feature 1 PostgreSQL scaffold 완료, 로컬 SQLite 전환은 미구현 | 2026-07-24 |
| 로컬 MVP 설계 | SQLite·Drizzle·FTS5, 배포 제외, OpenAI 비용 0원 승인 | 2026-07-24 |
| 사용자 UI 디자인 | 지도·왼쪽 탐색 드로어·빵빵이 FAB 채팅 UI 셸 `v0.1` 승인 | 2026-07-24 |

## 작업 기록

- [로컬 우선 SQLite MVP 마스터 구현 계획](superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md)
- [로컬 SQLite 저장소 기반 상세 구현 계획](superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md)
- [기존 P0 구현 로드맵 설계](superpowers/specs/2026-07-23-p0-implementation-roadmap-design.md)
- [기존 P0 마스터 구현 계획](superpowers/plans/2026-07-23-p0-master-implementation.md)
- [로컬 우선 SQLite 웹 MVP 설계](superpowers/specs/2026-07-24-local-first-sqlite-web-design.md)
- [UI 디자인 시스템](01-experience/design-system.md)
- [Workspace·Docker·테스트 기반 상세 실행 계획](superpowers/plans/2026-07-23-workspace-foundation.md)
- [기술 스택 기준](10-delivery/technology-stack.md)
- [폴더 구조](10-delivery/directory-structure.md)
- [로컬 개발 환경](10-delivery/local-development.md)
- [개발 준비 체크리스트](10-delivery/development-readiness-checklist.md)
- [Codex 운영 규칙 설계](superpowers/specs/2026-07-22-agent-operating-rules-design.md)
- [Codex 운영 규칙 실행 계획](superpowers/plans/2026-07-22-codex-operating-rules.md)
- [제품 문서 재구성 설계](superpowers/specs/2026-07-22-prd-restructure-design.md)
- [문서 재구성 실행 계획](superpowers/plans/2026-07-22-prd-documentation-restructure.md)
- [기존 서비스 기획서 이전 안내](service-plan.md)

## 문서 편집 원칙

- 제품 범위는 PRD, 추천 계산은 추천 기준서, JSON 계약은 LLM 계약, 스키마는 데이터 설계서에서만 규범적으로 정의한다.
- 다른 문서에서는 필요한 요약과 상대 링크만 둔다.
- 변경할 때 [결정 기록](09-decisions/decision-log.md)에 날짜·이유·영향을 남긴다.
- 정확한 사용자 위치, 대화 원문과 리뷰 원문을 예시 데이터로 복제하지 않는다.
