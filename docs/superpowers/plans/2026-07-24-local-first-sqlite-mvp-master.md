# Local-First SQLite MVP Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 로컬 우선 설계를 서로 독립적으로 구현·검증할 수 있는 Feature 순서로 전환해, 서울 베이커리 데이터 수집부터 지도 기반 사용자 웹까지 OpenAI 비용 없이 완성한다.

**Architecture:** Next.js web은 `app.sqlite`만 사용하고, 로컬 worker는 `app.sqlite`와 암호화된 `raw.sqlite`를 사용한다. Drizzle migration, FTS5 retrieval adapter, 결정론적 추천 package를 경계로 두며 Kakao 로그인·지도와 승인된 UI를 마지막 사용자 흐름에서 결합한다.

**Tech Stack:** Node.js 24.18.0, pnpm 11.16.0, TypeScript 6.0.3, Next.js 16.2.11, React 19.2.8, SQLite/FTS5, better-sqlite3 12.11.1, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, Auth.js, Vitest 4.1.10, Playwright 1.61.1

## Global Constraints

- 이 문서는 로컬 MVP Epic의 순서와 공통 gate를 소유한다. 파일·함수·테스트 수준 실행은 각 Feature의 상세 계획이 소유한다.
- 각 Feature는 새 Codex 작업에서 구현과 직접 검증을 함께 완료한다. 사용자가 요청하기 전에는 Codex가 새 작업을 만들지 않는다.
- 프로젝트 `AGENTS.md`에 따라 main agent가 기본 실행자다. Subagent는 기본값이 아니며, 짧고 독립적인 업무가 실제로 통합 비용보다 이득일 때만 사용한다.
- web은 `raw.sqlite`, 원문 복호화 key, 리뷰 HMAC key를 import하거나 읽지 않는다.
- SQLite 파일, WAL/SHM 파일, backup과 secret은 Git에 포함하지 않는다.
- 수집 접근 제한, CAPTCHA, 403, 429를 우회하지 않는다. 이 상태는 전체 batch 중단 사유로 기록한다.
- 로컬 MVP에는 OpenAI client, API route, API key 요구사항과 생성형 응답을 넣지 않는다.
- 기존 PostgreSQL·Prisma 경로는 SQLite migration·repository 검증이 통과한 뒤 제거한다.
- 동일 입력·데이터·버전에서 검색·정렬 결과 순서는 항상 같아야 한다.
- 코드 작업은 실패하는 검증을 먼저 만들고 최소 구현으로 통과시킨 뒤 관련 전체 검증을 한 번 수행한다.

---

## Source of Truth

- 승인 설계: [`../specs/2026-07-24-local-first-sqlite-web-design.md`](../specs/2026-07-24-local-first-sqlite-web-design.md)
- UI 기준: [`../../01-experience/design-system.md`](../../01-experience/design-system.md)
- 추천 규칙: [`../../02-recommendation/recommendation-spec.md`](../../02-recommendation/recommendation-spec.md)
- 개인정보·보안: [`../../06-trust/security-design.md`](../../06-trust/security-design.md)
- 정책 경계: [`../../06-trust/policy-review.md`](../../06-trust/policy-review.md)
- 승인 결정: [`../../09-decisions/decision-log.md`](../../09-decisions/decision-log.md)의 DR-032, DR-033, DR-034, DR-035, DR-036, DR-037, DR-038, DR-039, DR-040

## Feature Sequence

| 순서 | Feature | 주 산출물 | 선행 | GitHub 연결 |
|---:|---|---|---|---|
| 1 | Local SQLite storage foundation | 두 SQLite package, Drizzle migration, backup, 경계 검증 | 없음 | `#2` |
| 2 | Seoul source ingestion | LOCALDATA fixture·adapter·원장 적재·run 상태 | 1 | `#3` |
| 3 | Store normalization and eligibility | 정규화, 좌표, 중복 병합, 독립 베이커리 판정 | 2 | `#4`, `#5` |
| 4 | Kakao bakery discovery and encrypted review collection | 공식 장소 발견, 최소 비식별·HMAC, checkpoint, AES-GCM 원문, 중단 정책 | 1, 3 | `#14` |
| 5 | Review publish and FTS retrieval | app review version, 삭제·검색 일관성, FTS5 adapter | 4 | `#14`, `#15` 범위 조정 |
| 6 | Deterministic search and recommendation | 구조화 검색, 동의어, 리뷰 부족 대체, 안정 정렬 | 3, 5 | `#8`, `#11` |
| 7 | Kakao authentication and account data | 최소 Kakao Login, session, 즐겨찾기·기록 격리 | 1 | `#13` |
| 8 | Store and map server APIs | 지도 후보·목록 동기화, 상세·메뉴·리뷰·길찾기 입력 | 6, 7 | `#12` |
| 9 | Map-first user interface and chat shell | 전체 지도, 왼쪽 drawer, FAB·비활성 채팅 셸 | 8 | `#10`, `#11`, `#12` |
| 10 | Local E2E, recovery and release gate | 재시작·복구·성능·접근성·OpenAI 0원 검증 | 2–9 | `#16` |

`#15`의 기존 LLM 특징 추출 범위는 DR-033과 충돌한다. Feature 5 작업을 시작할 때 issue 본문을 “비식별 리뷰 게시와 FTS5·근거 집계”로 갱신하거나 새 issue로 분리하고, OpenAI 작업은 후속 챗봇 Feature로 남긴다.

## Cross-Feature Contracts

### Stable identifiers

- `bakery_id`: 공공 원장 단위 자체 식별자
- `store_id`: 사용자에게 노출되는 매장 단위 자체 식별자
- 외부 provider ID는 검증되지 않은 영구 기본키로 사용하지 않는다.
- 모든 정렬의 마지막 tie-breaker는 `store_id ASC`다.

### Time and text

- DB timestamp는 UTC epoch millisecond 정수로 저장하고 UI에서 Asia/Seoul로 표시한다.
- 리뷰 게시일은 출처가 날짜만 제공하면 로컬 날짜 문자열과 정규화 기준을 함께 보존한다.
- 검색 정규화는 원문을 덮어쓰지 않고 별도 normalized field/index 입력을 만든다.

### Review state

```ts
export const reviewCollectionStatuses = [
  "complete",
  "no_reviews",
  "review_insufficient",
  "access_failed",
  "deidentification_failed",
  "retry_pending",
  "admin_review"
] as const;

export type ReviewCollectionStatus =
  (typeof reviewCollectionStatuses)[number];
```

### Error contract

사용자 API는 내부 stack, SQL, secret을 반환하지 않는다.

```ts
export interface PublicError {
  errorId: string;
  code:
    | "AUTH_REQUIRED"
    | "INVALID_INPUT"
    | "MAP_UNAVAILABLE"
    | "SEARCH_UNAVAILABLE"
    | "INTERNAL_ERROR";
  message: string;
  retryable: boolean;
}
```

Worker 오류는 `run_id`, `store_id`, 안전한 오류 code와 단계만 기록한다. nickname, 리뷰 원문, 암호문, token, secret은 로그 field가 될 수 없다.

## Feature 1 — Local SQLite Storage Foundation

상세 계획: [`2026-07-24-local-sqlite-storage-foundation.md`](2026-07-24-local-sqlite-storage-foundation.md)

완료 gate:

- [ ] `app.sqlite`와 `raw.sqlite`가 독립 migration 이력을 갖는다.
- [ ] 두 파일 모두 `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`으로 열린다.
- [ ] app DB backup을 생성하고 새 연결에서 읽을 수 있다.
- [ ] web manifest·source에서 `raw-db`, `RAW_SQLITE_PATH`, `raw.sqlite` 접근이 거부된다.
- [ ] PostgreSQL·Prisma·Docker Compose와 OpenAI/LangGraph runtime 의존성이 현재 scaffold에서 제거된다.
- [ ] install → typecheck → lint → test → build가 외부 key와 Docker 없이 통과한다.

## Feature 2 — Seoul Source Ingestion

주요 파일:

- `packages/contracts/src/catalog.ts`
- `packages/app-db/src/schema/catalog.ts`
- `apps/worker/src/catalog/localdata-client.ts`
- `apps/worker/src/catalog/normalize-source-row.ts`
- `apps/worker/src/catalog/run-ingestion.ts`
- `apps/worker/src/commands/ingest-catalog.ts`
- `apps/worker/src/catalog/__fixtures__/localdata-seoul.json`

작업과 gate:

- [ ] 고정 fixture로 API 응답 schema, pagination, nullable field를 실패 우선 검증한다.
- [ ] 원본 source row와 정규화 전 staging row를 분리한다.
- [ ] 동일 source snapshot을 재적재해도 중복 staging row가 생기지 않게 한다.
- [ ] page checkpoint와 run summary에 읽음·삽입·갱신·거부 건수를 기록한다.
- [ ] API key, 전체 응답 body와 주소 밖 개인정보가 로그에 나타나지 않게 검사한다.
- [ ] live API 호출은 수동 smoke로만 수행하며 CI는 fixture만 사용한다.

완료 기준: 서울 제과점 source fixture의 모든 row가 누락 없이 staging에 들어가고 같은 run 재실행 결과가 idempotent하다.

## Feature 3 — Store Normalization and Eligibility

주요 파일:

- `packages/contracts/src/store.ts`
- `packages/app-db/src/schema/stores.ts`
- `apps/worker/src/catalog/normalize-store.ts`
- `apps/worker/src/catalog/deduplicate-stores.ts`
- `apps/worker/src/catalog/classify-eligibility.ts`
- `apps/worker/src/catalog/publish-catalog.ts`
- `packages/testkit/src/store-fixtures.ts`

작업과 gate:

- [ ] 주소·전화·상호·좌표 정규화 table test를 먼저 만든다.
- [ ] 지점 병합은 정규화 주소·좌표 거리·전화·상호 근거를 모두 기록한다.
- [ ] 서울 영업점 2–5개 독립 브랜드만 적격으로 판정하고 6개 이상은 제외한다.
- [ ] 공정위 franchise 근거가 없다는 사실만으로 독립성을 확정하지 않는다.
- [ ] 애매한 결과는 `admin_review`로 보내고 자동 publish하지 않는다.
- [ ] 리뷰 0건이어도 적격 매장을 app DB에 publish한다.

완료 기준: fixture의 정답표와 분류 결과가 일치하고 모든 publish 매장이 고유 `store_id`, 서울 좌표와 판정 근거를 가진다.

## Feature 4 — Kakao Bakery Discovery and Encrypted Review Collection

주요 파일:

- `packages/contracts/src/review.ts`
- `packages/raw-db/src/schema/kakao-discovery.ts`
- `packages/raw-db/src/schema/review-runs.ts`
- `packages/raw-db/src/schema/raw-reviews.ts`
- `apps/worker/src/reviews/kakao-place-client.ts`
- `apps/worker/src/reviews/run-kakao-discovery.ts`
- `apps/worker/src/reviews/deidentify-review.ts`
- `apps/worker/src/reviews/fingerprint-review.ts`
- `apps/worker/src/reviews/browser-session.ts`
- `apps/worker/src/reviews/collect-store-reviews.ts`
- `apps/worker/src/reviews/encrypt-raw-review.ts`
- `apps/worker/src/reviews/run-review-batch.ts`
- `apps/worker/src/reviews/review-sync-state.ts`
- `apps/worker/src/commands/collect-reviews.ts`

작업과 gate:

- [ ] Kakao 공식 keyword search API의 서울 `빵집` 결과를 tile subdivision으로 탐색한다.
- [ ] 마지막 category segment가 정규화 후 정확히 `제과,베이커리`인 장소만 franchise 포함 후보 관측으로 저장한다.
- [ ] discovery coverage가 `COMPLETE`가 아니면 review batch를 시작하지 않는다.
- [ ] Feature 3 `catalog_status='published'` 매장과 연결된 locator만 review 대상으로 삼는다.
- [ ] 저장된 비민감 HTML fixture로 selector와 pagination 계약을 검증한다.
- [ ] 전화·이메일·URL·계정 ID·명시적 이름 패턴의 table test와 보수적 실패 규칙을 만든다.
- [ ] nickname은 HMAC 입력 직후 폐기하고 함수 결과·DB·로그에 포함하지 않는다.
- [ ] fingerprint는 승인된 5개 입력과 HMAC-SHA-256만 사용한다.
- [ ] AES-256-GCM key 길이, 매 row 고유 nonce, auth tag와 암호화 version을 검증한다.
- [ ] 최초 run은 최근 12개월 cutoff 또는 공개 DOM end까지 개수 상한 없이 처리한다.
- [ ] 후속 수동 run은 이전 성공 fingerprint anchor와 겹치는 page까지 신규 review만 처리하고 anchor가 사라지면 같은 run에서 backfill fallback한다.
- [ ] encrypted review·locator는 30일, seen fingerprint·store sync state는 body·nickname 없이 400일 뒤 hard delete한다.
- [ ] 60분 실행 예산 도달은 `PAUSED_BUDGET`으로 checkpoint하고 성공으로 표시하지 않는다.
- [ ] 매장·페이지 checkpoint 이후부터 재개하고 완료 매장은 건너뛴다.
- [ ] 로그인 만료, CAPTCHA, 401, 403, 429, 외부 redirect와 DOM/order 변경에서 batch 전체를 중단한다.
- [ ] 단일 매장 parse 실패는 안전한 상태를 남기고 다음 매장으로 진행한다.
- [ ] live smoke는 사용자가 명시적으로 실행하고 CI는 fixture만 사용한다.

완료 기준: 서울 discovery coverage가 `COMPLETE`이고, 적격 매장의 최근 12개월 initial backfill과 수동 incremental fixture가 성공하며 budget pause·resume 뒤 encrypted raw missing·duplicate가 0이고 nickname·평문 저장이 0이다.

## Feature 5 — Review Publish and FTS Retrieval

입력: Feature 4의 decrypt 가능한 비식별 payload·`store_id`·rating·date.

주요 파일:

- `packages/app-db/src/schema/reviews.ts`
- `packages/app-db/src/schema/review-search.ts`
- `packages/retrieval/package.json`
- `packages/retrieval/src/review-repository.ts`
- `packages/retrieval/src/sqlite-review-repository.ts`
- `apps/worker/src/reviews/publish-review.ts`

작업과 gate:

- [ ] Feature 4가 검증한 비식별 payload만 `app.sqlite` review로 게시한다.
- [ ] insert·update·delete마다 content table과 FTS5 결과가 일치한다.
- [ ] SQLite retrieval adapter 계약을 package-level test로 고정한다.
- [ ] review publish version과 삭제·검색 상태가 일치한다.

완료 기준: 같은 Feature 4 입력을 재게시해도 app review 중복이 없고, 활성 review version과 FTS5 문서가 일치하며 비식별 corpus 검색이 성공한다.

## Feature 6 — Deterministic Search and Recommendation

상세 계획: [`2026-07-30-deterministic-search-recommendation.md`](2026-07-30-deterministic-search-recommendation.md)

주요 파일:

- `packages/contracts/src/search.ts`
- `packages/app-db/src/schema/search-evidence.ts`
- `drizzle/app/0004_search_evidence.sql`
- `apps/worker/src/search-evidence/publish-search-evidence.ts`
- `apps/worker/src/commands/publish-search-evidence.ts`
- `packages/recommendation/src/normalize-query.ts`
- `packages/recommendation/src/derive-candidate.ts`
- `packages/recommendation/src/filter-candidates.ts`
- `packages/recommendation/src/rank-candidates.ts`
- `packages/recommendation/src/explain-result.ts`
- `packages/retrieval/src/store-search-repository.ts`
- `packages/retrieval/src/sqlite-store-search-repository.ts`
- `packages/retrieval/src/execute-store-search.ts`
- `packages/retrieval/src/search-evaluation.ts`
- `packages/testkit/src/search-scenarios.ts`

작업과 gate:

- [x] 지역·가게·메뉴·카테고리·영업·거리 입력 schema를 고정한다.
- [x] 활성 catalog pointer와 검수 검색 근거 batch를 versioned app schema·명시적 로컬 JSON importer로 고정한다.
- [x] catalog/source identity·metadata, canonical 공개 후보 facts, 검수 근거와 일관된 review/FTS를 opaque `search-data-v1` hash로 묶는다.
- [x] 승인 동의어 사전과 검색어 정규화 table test를 만든다.
- [x] 하드 필터 이후 FTS 관련도와 승인 우선순위를 순서대로 적용한다.
- [x] 리뷰 3개 미만 매장에는 메뉴·영업·거리·완성도 대체 순서를 적용한다.
- [x] 보정 별점은 마지막 동점 보조값으로만 사용한다.
- [x] exact origin·distance와 내부 rank·보정값을 공개하지 않고 거리만 250m 상한 bucket으로 반환한다.
- [x] 정확히 20개 search-only scenario를 성공 18개와 safe error 2개로 분리한다.
- [x] Hit Rate `>=8500bp`, 하드 제외 0, 전체 result 100회 결정성, rating inversion 0과 truthful FTS fallback을 검증한다.
- [x] 10회 warm-up 뒤 100회 측정 p95 `<1500ms`를 fixture DB에서 검증한다.

완료 기준: OpenAI 없이 strict 구조화 검색·공개 근거와 안전 오류를 반환하고 고정 fixture 품질·결정성 기준을 만족한다. fixture 성공은 live source·독립-human 품질을 의미하지 않는다.

## Feature 7 — Kakao Authentication and Account Data

주요 파일:

- `packages/app-db/src/schema/auth.ts`
- `packages/app-db/src/schema/user-data.ts`
- `apps/web/src/auth.ts`
- `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- `apps/web/src/server/user-repository.ts`
- `apps/web/src/app/api/favorites/route.ts`
- `apps/web/src/app/api/history/route.ts`
- `apps/web/src/app/api/account/route.ts`

작업과 gate:

- [x] Auth.js·core·Drizzle adapter의 공식 호환 조합을 확인해 exact pin한다.
- [x] Kakao provider account ID 외 이메일·전화·생일·성별·nickname·image를 저장하지 않는다.
- [x] OAuth access token은 갱신되지 않는 절대 6시간 암호화·HttpOnly JWT에만 두고 DB·session API·log에서 제외한다.
- [x] hash session registry와 route별 session `user_id` query scope를 강제한다.
- [x] 두 사용자 fixture로 즐겨찾기·기록의 교차 읽기·수정이 모두 거부되는지 검증한다.
- [x] 탈퇴는 local delete를 먼저 commit하고 Kakao unlink 실패 시에도 rollback하지 않는다.
- [ ] 로컬 callback `http://127.0.0.1:3000/api/auth/callback/kakao`의 실제 Kakao login·unlink를 수동 smoke한다.

자동 완료 기준: 계정별 데이터가 격리되고 위치 입력 없이도 인증된 목록 API를 사용할 수 있으며, 실제 Kakao 자격증명이 필요한 login·unlink smoke 상태는 별도로 기록한다.

## Feature 8 — Store and Map Server APIs

주요 파일:

- `packages/contracts/src/api/store-search.ts`
- `packages/contracts/src/api/store-detail.ts`
- `apps/web/src/server/search-service.ts`
- `apps/web/src/server/store-detail-service.ts`
- `apps/web/src/app/api/stores/route.ts`
- `apps/web/src/app/api/stores/[storeId]/route.ts`

작업과 gate:

- [x] 검색 body를 Feature 6 strict query로 검증하고 후보 배열을 임의 pagination·절단 없이 반환한다.
- [x] 상세 review query의 `reviewPage`를 1~1000, `reviewLimit`을 1~20으로 고정한다.
- [x] 지도 marker와 왼쪽 목록이 같은 API result set을 사용한다.
- [x] 상세 응답에 검수 메뉴·영업시간, 별점, 비식별 리뷰, 최신성·리뷰 부족 상태를 포함한다.
- [x] 정확 사용자 위치를 POST body와 요청 process memory에서만 사용하고 DB·history·응답에 저장하지 않는다.
- [x] Kakao Map SDK 실패 시 같은 후보와 주소·250m 거리 상한을 유지하는 `MAP_UNAVAILABLE` presentation contract를 제공한다.
- [x] SQL error, validation detail, stack과 내부 path가 public response에 노출되지 않게 한다.

Kakao Route와 `/api/routes`는 후속 독립 Feature다. Feature 8은 route
billing·quota·REST key를 요구하거나 이동시간을 추정하지 않는다.
실제 Kakao Map JavaScript SDK smoke는 user-owned app key가 없어
`NOT_RUN_CREDENTIALS_REQUIRED`로 남기고 자동 fixture gate와 구분한다.

완료 기준: `test:map:feature8`의 migrated fixture DB에서 검색
결과·지도 후보·상세 선택의 `store_id`와
`dataSnapshotVersion`이 일관되고 안전한 실패 응답을 반환한다.

## Feature 9 — Map-First User Interface and Chat Shell

주요 파일:

- `apps/web/src/app/page.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/map/bakery-map.tsx`
- `apps/web/src/components/store/store-drawer.tsx`
- `apps/web/src/components/store/store-list.tsx`
- `apps/web/src/components/store/store-detail.tsx`
- `apps/web/src/components/chat/bbangbbang-fab.tsx`
- `apps/web/src/components/chat/chat-shell.tsx`
- `apps/web/src/components/layout/map-shell.tsx`

작업과 gate:

- [x] `docs/01-experience/design-system.md`의 token을 CSS variable로 구현한다.
- [x] 검색·목록·상세를 왼쪽 drawer 하나의 명시적 상태 기계로 관리한다.
- [x] marker 선택과 list 선택이 같은 `selectedStoreId`를 갱신한다.
- [x] FAB를 열면 FAB가 사라지고, chat을 닫으면 FAB로 focus가 복귀한다.
- [x] chat composer와 suggestion은 disabled이며 submit handler와 chatbot network route가 없다.
- [x] Kakao Map 실패 시 왼쪽 목록·주소 탐색을 유지한다.
- [x] keyboard, 200% zoom에 해당하는 유효 viewport, reduced motion, mobile viewport를 검증한다.

완료 기준: 승인된 지도 중심 UI와 FAB·chat 상호 배타 동작이 브라우저 E2E에서 확인된다.

## Feature 10 — Local E2E, Recovery and Release Gate

주요 파일:

- `apps/web/e2e/search-and-detail.spec.ts`
- `apps/web/e2e/favorites-isolation.spec.ts`
- `apps/web/e2e/chat-shell.spec.ts`
- `apps/worker/src/recovery/restore-app-database.ts`
- `scripts/verify-local-mvp.ts`
- `docs/10-delivery/local-development.md`
- `docs/10-delivery/development-readiness-checklist.md`

작업과 gate:

- [ ] 빈 DB → migration → fixture ingest → search → web E2E를 한 명령으로 실행한다.
- [ ] worker 강제 중단 fixture 뒤 checkpoint resume과 중복 0건을 검증한다.
- [ ] app DB snapshot을 새 파일로 복구하고 integrity check·대표 query를 실행한다.
- [ ] 지도 실패·OAuth 실패·리뷰 부족·FTS fallback UI를 검증한다.
- [ ] source와 build output에서 `openai`, `/api/chat`, 활성 chat submit을 검사해 실패시킨다.
- [ ] p95 검색·추천, 100회 결정성, Hit Rate@5 결과를 machine-readable report로 남긴다.
- [ ] `127.0.0.1` bind, secret/nickname/raw review log 0건과 Git ignore를 확인한다.

완료 기준: 승인 설계의 14개 로컬 MVP 완료 조건을 모두 자동 검증하거나, Kakao live smoke처럼 자동화할 수 없는 항목은 날짜·결과·실행자를 release checklist에 기록한다.

## Integration Gates

각 Feature 종료 시 다음을 순서대로 실행한다.

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Feature 9 이후:

```powershell
corepack pnpm --filter @bread-map/web exec playwright test
```

Feature 10:

```powershell
corepack pnpm verify:local-mvp
```

## Commit and Review Policy

- 하나의 commit은 하나의 검증 가능한 의도를 담는다.
- commit subject는 Conventional Commit 형식을 사용한다.
- body 마지막에 실제 연결 issue를 `Refs: #<number>`로 기록한다.
- database schema와 generated migration은 같은 commit에 둔다.
- fixture에는 실제 nickname, token, 리뷰 원문과 secret을 넣지 않는다.
- Feature당 기본 full-scope review는 한 번만 수행하고 수정 뒤에는 변경 영역과 직접 의존성만 재검증한다.
- 각 Feature 완료 뒤 사용자가 결과를 확인하기 전에는 다음 독립 Feature를 같은 Codex 작업에서 시작하지 않는다.

## Plan Completion Checklist

- [ ] Feature 1–10이 승인 설계의 모든 목표와 비목표를 덮는다.
- [ ] 각 Feature에 독립 산출물, 선행 조건과 종료 gate가 있다.
- [ ] raw DB와 web 경계, nickname 폐기, OpenAI 0원 기준이 모든 관련 단계에 포함됐다.
- [ ] 리뷰가 없는 매장을 제외하지 않는 대체 흐름이 데이터·검색·UI에 모두 포함됐다.
- [ ] Vercel·Turso·실제 챗봇은 현재 완료 조건 밖에 남아 있다.
- [ ] 첫 Feature 상세 계획이 별도 문서로 연결됐다.
