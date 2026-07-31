# 빵찾깅 문서 허브

[저장소 소개](../README.md) · [제품 요구사항](00-product/prd.md) · [결정 기록](09-decisions/decision-log.md)

이 문서는 빵찾깅의 제품·기술 기준을 찾기 위한 단일 시작점이다. 같은 규칙을 여러 문서에 복제하지 않고, 아래 `기준 문서`가 해당 주제의 최종 정의를 소유한다.

## 현재 해석 기준

- **현재 로컬 MVP:** 사용자 PC의 `127.0.0.1`에서 SQLite·Drizzle·FTS5와 구조화 검색으로 실행하는 승인 목표다. 빵빵이 채팅은 비활성 UI 셸이고 OpenAI 비용 목표는 `$0`이다.
- **현재 저장소 구현:** Feature 1~10이 두 SQLite 기반부터 지도 중심 UI, 비활성 채팅 셸, production browser E2E, app-only 복구 rehearsal과 한 명령 local release gate까지 구현했다. 검색·상세는 활성 catalog 포인터와 같은 opaque composite snapshot을 사용하며 자동 gate의 OpenAI 비용과 외부 network 호출은 `$0`이다.
- **후속 독립 Feature:** 자연어·멀티턴·RAG·OpenAI, Vercel·Turso 배포와 원격 5인 파일럿이다. 현재 완료 조건이 아니다.

## 권장 읽기 순서

1. [로컬 우선 SQLite 웹 MVP 설계](superpowers/specs/2026-07-24-local-first-sqlite-web-design.md), [현재 마스터 계획](superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md), [Feature 9 UI 설계](superpowers/specs/2026-07-30-map-first-ui-chat-shell-design.md), [Feature 10 release gate 설계](superpowers/specs/2026-07-31-local-e2e-recovery-release-gate-design.md)에서 승인 목표와 현재 경계를 확인한다.
2. [제품 요구사항](00-product/prd.md)에서 현재 로컬 MVP 범위와 성공 기준을 확인한다.
3. [사용자 여정](01-experience/user-journey.md), [화면 상태·카피](01-experience/ux-states-and-copy.md)와 [UI 디자인 시스템](01-experience/design-system.md)에서 실제 경험을 확인한다.
4. [추천 기준](02-recommendation/recommendation-spec.md)과 [평가 계획](02-recommendation/evaluation-plan.md)에서 구조화 검색의 판정과 검증 방식을 확인한다.
5. [시스템 구조](04-architecture/system-architecture.md), [Worker 설계](04-architecture/worker-design.md), [데이터 설계](05-data/data-design.md)와 [보안 설계](06-trust/security-design.md)에서 SQLite·FTS5·raw 경계를 확인한다.
6. [구현·릴리스 안내](10-delivery/README.md), [로컬 개발 환경](10-delivery/local-development.md), [기술 스택 기준](10-delivery/technology-stack.md)과 [폴더 구조](10-delivery/directory-structure.md)에서 Feature 1~10의 설치·migration·검색 근거 게시·인증·UI·release 검증과 package 경계를 확인한다.
7. [LLM 계약](03-contracts/llm-contracts.md)과 [기존 온라인 P0 마스터 계획](superpowers/plans/2026-07-23-p0-master-implementation.md)은 후속 챗봇 설계와 과거 이력으로 읽는다.

## 기준 문서

| 영역 | 문서 | 책임 |
|---|---|---|
| 제품 | [PRD](00-product/prd.md) | 사용자, 현재 로컬 MVP, 후속 범위, 요구사항과 지표 |
| 경험 | [사용자 여정](01-experience/user-journey.md) | 로그인부터 구조화 검색·상세·기록·비활성 채팅까지의 흐름 |
| 경험 | [화면 상태와 카피](01-experience/ux-states-and-copy.md) | 화면 상태, 실패 대체 흐름, 공식 안내 문구 |
| 경험 | [UI 디자인 시스템](01-experience/design-system.md) | 지도 중심 레이아웃, 시각 토큰, 빵빵이 FAB 셸, 반응형·접근성 |
| 추천 | [추천 기준](02-recommendation/recommendation-spec.md) | 후보, 제외, 내부 관련도, 정렬, 동점 |
| 추천 | [평가 계획](02-recommendation/evaluation-plan.md) | 구조화 검색, 결정성, 대체 흐름과 수용 기준 |
| 계약 | [LLM 계약](03-contracts/llm-contracts.md) | 후속 자연어 구조화·설명·리뷰 특징 계약 |
| 구조 | [시스템 구조](04-architecture/system-architecture.md) | 인증, SQLite, 검색·추천과 외부 API 경계 |
| 구조 | [Worker 설계](04-architecture/worker-design.md) | 적재, 정규화, 검수, 리뷰·FTS 게시 작업 |
| 데이터 | [데이터 설계](05-data/data-design.md) | 출처, 스키마, 보존, 품질, 삭제와 복구 |
| 신뢰 | [보안 설계](06-trust/security-design.md) | 인증, 계정 격리, 위치·파일·리뷰 개인정보, 비밀 |
| 신뢰 | [정책 검토](06-trust/policy-review.md) | Kakao·리뷰 플랫폼·외부 처리 정책 경계 |
| 실험 | [리뷰 수집 실험](07-experiments/review-collection-experiment.md) | 관리자 로컬 Playwright 실험과 중단 조건 |
| 운영 | [운영 기준](08-operations/operating-baselines.md) | 로컬 실행, 비용, 최신성, snapshot과 장애 대응 |
| 결정 | [결정 기록](09-decisions/decision-log.md) | 승인 일자, 대안과 결정 영향 |
| 구현 | [로컬 개발 환경](10-delivery/local-development.md) | 설치, 환경변수, 실행과 검증 명령 |
| 구현 | [기술 스택 기준](10-delivery/technology-stack.md) | runtime, framework, database, test 도구와 version |
| 구현 | [폴더 구조](10-delivery/directory-structure.md) | monorepo package 소유권과 import 경계 |
| 구현 | [구현·릴리스 안내](10-delivery/README.md) | 실행 계획, 사용자 준비, 릴리스 산출물 |

## 문서 상태

| 문서군 | 상태 | 기준일 |
|---|---|---:|
| 책임 문서 동기화 | DR-032~DR-042 로컬 MVP·Feature 10 구현 기준 반영 완료 | 2026-07-31 |
| 데이터·리뷰 정책 | Kakao 장소 allowlist·12개월 initial backfill·수동 incremental·30일 ciphertext·400일 dedupe ledger·비공개 매장 public corpus purge | 2026-07-30 |
| 리뷰 수집 | 관리자 로컬 수동 batch, 공개 배포 불가 | 2026-07-24 |
| 애플리케이션 구현 | Feature 1~10의 SQLite data pipeline, strict 검색, 최소 Kakao account/session, 인증 API, 지도 중심 UI, recovery와 release gate 구현 완료. Selector contract는 `SELECTOR_STOP_STATE_UNCONFIRMED`; live review·Kakao Login·Kakao Map과 live 추천 품질 평가는 자격증명·operator 승인이 없어 미실행 | 2026-07-31 |
| Feature 6 자동 gate | 고정 30-store·50-menu·20 search-only scenario, 성공 분모 18+안전 오류 2, Hit Rate `>=8500bp`, 제외 0, 100회 결정성, 별점 역전 0, truthful FTS fallback, 10+100 p95 `<1500ms` | 2026-07-30 |
| Feature 7 자동 gate | 최소 account·6시간 encrypted JWT·hashed session registry·exact-Origin·두 사용자 IDOR·local-first withdrawal 검증 완료; live login·unlink는 `NOT_RUN_CREDENTIALS_REQUIRED` | 2026-07-30 |
| Feature 8 자동 gate | strict 검색·상세 계약, snapshot bootstrap, migrated SQLite map/list/detail ID 일관성, review pagination·partial state, 위치 비저장·안전 오류·web retrieval 경계 검증 완료; live map은 `NOT_RUN_CREDENTIALS_REQUIRED` | 2026-07-30 |
| Feature 9 자동 gate | 지도·목록·상세 상태 기계, 반응형·접근성, map 실패 fallback, 비활성 chat·focus 복귀와 local-only network browser 검증 완료 | 2026-07-31 |
| Feature 10 자동 gate | fresh DB migration·fixture·real search, checkpoint resume, app-only restore, quality report, production browser E2E와 source/build/security audit를 `verify:local-mvp`로 검증; OpenAI `$0`, external network 0 | 2026-07-31 |
| 로컬 MVP 설계 | SQLite·Drizzle·FTS5, 배포 제외, OpenAI 비용 `$0` 승인 | 2026-07-24 |
| 사용자 UI 디자인 | 지도·왼쪽 탐색 드로어·빵빵이 FAB 채팅 UI 셸 `v0.1` 승인 | 2026-07-24 |

## 작업 기록

- [로컬 우선 SQLite 웹 MVP 설계](superpowers/specs/2026-07-24-local-first-sqlite-web-design.md)
- [Feature 4 카카오 빵집 발견·리뷰 수집 설계](superpowers/specs/2026-07-26-kakao-bakery-review-collection-design.md)
- [Feature 4 카카오 빵집 발견·리뷰 수집 구현 계획](superpowers/plans/2026-07-26-kakao-bakery-review-collection.md)
- [Feature 4 확장 최근 12개월 backfill·수동 증분 설계](superpowers/specs/2026-07-29-kakao-review-year-backfill-incremental-design.md)
- [Feature 4 확장 최근 12개월 backfill·수동 증분 구현 계획](superpowers/plans/2026-07-29-kakao-review-year-backfill-incremental.md)
- [Feature 4 live DOM 날짜 호환 설계](superpowers/specs/2026-07-29-kakao-review-dom-date-compatibility-design.md)
- [Feature 4 live DOM 날짜 호환 구현 계획](superpowers/plans/2026-07-29-kakao-review-dom-date-compatibility.md)
- [Feature 5 리뷰 게시·FTS5 retrieval 설계](superpowers/specs/2026-07-30-review-publish-fts-retrieval-design.md)
- [Feature 5 리뷰 게시·FTS5 retrieval 구현 계획](superpowers/plans/2026-07-30-review-publish-fts-retrieval.md)
- [Feature 6 결정론적 검색·추천 설계](superpowers/specs/2026-07-30-deterministic-search-recommendation-design.md)
- [Feature 6 결정론적 검색·추천 구현 계획](superpowers/plans/2026-07-30-deterministic-search-recommendation.md)
- [Feature 7 Kakao 인증·사용자 데이터 설계](superpowers/specs/2026-07-30-kakao-auth-account-data-design.md)
- [Feature 7 Kakao 인증·사용자 데이터 구현 계획](superpowers/plans/2026-07-30-kakao-auth-account-data.md)
- [Feature 8 매장·지도 서버 API 설계](superpowers/specs/2026-07-30-store-map-server-api-design.md)
- [Feature 8 매장·지도 서버 API 구현 계획](superpowers/plans/2026-07-30-store-map-server-api.md)
- [Feature 9 지도 중심 UI·비활성 chat shell 설계](superpowers/specs/2026-07-30-map-first-ui-chat-shell-design.md)
- [Feature 9 지도 중심 UI·비활성 chat shell 구현 계획](superpowers/plans/2026-07-30-map-first-ui-chat-shell.md)
- [Feature 10 local E2E·recovery·release gate 설계](superpowers/specs/2026-07-31-local-e2e-recovery-release-gate-design.md)
- [Feature 10 local E2E·recovery·release gate 구현 계획](superpowers/plans/2026-07-31-local-e2e-recovery-release-gate.md)
- [로컬 우선 SQLite MVP 마스터 구현 계획](superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md)
- [로컬 SQLite 저장소 기반 상세 구현 계획](superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md)
- [서울 source 적재 상세 구현 계획](superpowers/plans/2026-07-26-seoul-source-ingestion.md)
- [매장 정규화·적격 판정 상세 구현 계획](superpowers/plans/2026-07-26-store-normalization-eligibility.md)
- [로컬 MVP 책임 문서 동기화 설계](superpowers/specs/2026-07-24-local-mvp-document-sync-design.md)
- [로컬 MVP 책임 문서 동기화 실행 계획](superpowers/plans/2026-07-24-local-mvp-document-sync.md)
- [기존 P0 구현 로드맵 설계](superpowers/specs/2026-07-23-p0-implementation-roadmap-design.md)
- [기존 P0 마스터 구현 계획](superpowers/plans/2026-07-23-p0-master-implementation.md)
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
