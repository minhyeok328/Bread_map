# 결정 기록

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [재구성 설계](../superpowers/specs/2026-07-22-prd-restructure-design.md)

이 문서는 승인된 제품·기술 결정을 날짜순으로 기록한다. 새 결정은 이전 결정을 조용히 지우지 않고 `유지`, `확장`, `대체` 관계를 표시한다.

## 상태

- `ACTIVE`: 현재 기준
- `SUPERSEDED`: 새 결정으로 대체됨
- `EXPERIMENT`: 제한된 실험 범위

## 2026-07-18 기반 결정

### DR-001 · 서울 단일 사용자 로컬 MVP

**상태:** `SUPERSEDED` by DR-020

데이터 품질과 1인 운영 범위를 위해 서울·개인 PC 실행으로 시작했다. 지역 범위와 1인 운영 원칙은 유지하지만 사용자 웹은 카카오 계정 기반 5인 비공개 파일럿으로 확장됐다.

### DR-002 · 독립점 정의

**상태:** `ACTIVE`

단일 독립점과 서울 영업점 2~5개를 모두 직영하는 검수된 소규모 브랜드를 포함한다. 공정위 미일치만으로 독립성을 증명하지 않고 서울 영업점 6개 이상은 제외한다.

### DR-003 · 결정론적 추천

**상태:** `ACTIVE`, DR-015·DR-019로 확장

후보·필터·내부 관련도·동점은 TypeScript가 수행한다. LLM은 자연어 구조화, 리뷰 특징 후보와 확정 결과 설명만 담당한다.

### DR-004 · 기술 스택

**상태:** `ACTIVE`, 저장 기술 부분은 DR-032로 대체

TypeScript, `pnpm workspace`, Next.js, worker, PostgreSQL와 Prisma를 사용하고 MVP에서 Redis·BullMQ를 제외한다. LangGraph와 Auth.js Kakao provider를 추가한다.

### DR-005 · 이중 데이터베이스

**상태:** `ACTIVE`, 저장 기술은 DR-032로 개정

구조화 서비스 데이터 `app_db`와 AES-256-GCM 리뷰 원문 `raw_db`를 분리한다. web은 `raw_db`에 접근하지 않는다.

### DR-006 · 공식 원장

**상태:** `ACTIVE`

LOCALDATA 계열 `식품_제과점영업`을 기본 원장, 공정위 가맹정보를 프랜차이즈 판별 보조 자료로 사용한다.

### DR-007 · Kakao 장소 정보 비영속

**상태:** `ACTIVE`, DR-016·DR-018로 확장

Kakao Local 응답·장소 ID를 저장하지 않고 자체 `bakery_id`, `store_id`와 검수된 매장 좌표를 사용한다.

### DR-008 · 경로 API 출시 후 재검토

**상태:** `SUPERSEDED` by DR-016

당시 출시 전이던 경로 API를 출시 후 검토하기로 했으며, 2026-07-21 공식 출시 확인 뒤 P0 통합 결정으로 대체됐다.

### DR-009 · 리뷰 수집 위험 수용

**상태:** `EXPERIMENT`

자동수집 허용 근거가 확인되지 않았음을 기록한 채 관리자 로컬 Playwright 실험을 강제 상한·금지 우회·kill switch 아래 P0에 유지한다. 사용자 웹·공개 배포에는 포함하지 않는다.

### DR-010 · OpenAI 경계

**상태:** `ACTIVE`

Responses API strict 구조화 출력과 `store:false`를 사용한다. 위치·인증·작성자 식별정보를 전송하지 않고 모델·가격은 기준일 설정으로 분리한다.

### DR-011 · 위치 최소화

**상태:** `ACTIVE`, DR-018·DR-021로 확장

사용자의 정확 위치는 일시 계산에만 사용하고 저장하지 않는다. 공개 매장 좌표는 저장한다.

## 2026-07-22 제품 결정

### DR-012 · 특정 메뉴 탐색형 주 사용자

**상태:** `ACTIVE`

MVP 주 사용자는 원하는 특정 메뉴·맛·식감은 있지만 어느 빵집에 있는지 모르는 사용자다. 일반 맛집 랭킹보다 `먹고 싶은 빵을 찾는 과업`을 우선한다.

### DR-013 · 넓은 P0 유지

**상태:** `SUPERSEDED` for local MVP by DR-033

범위 축소안 대신 자연어·추천·지도·경로·상세·즐겨찾기·대화 기록·삭제·관리자·동기화·리뷰 실험·LLM 추출을 모두 P0로 유지한다. 주당 최소 5시간 운영과 수용 기준으로 위험을 관리한다.

### DR-014 · 의료·알레르기 정보 미사용

**상태:** `ACTIVE`

의료 상태를 추천 필터·점수로 사용하지 않는다. 빵집만 추천하며 재료·알레르기·교차접촉 정보를 검증하거나 안전을 보장하지 않고 사용자가 매장에 직접 확인하도록 안내한다.

### DR-015 · 추천 숫자 점수 비표시

**상태:** `ACTIVE`

결정론적 내부 관련도는 후보 설명과 관련도순에 사용하지만 사용자 화면에 100점·숫자 총점을 표시하지 않는다. 카드에는 이유, 주의점, 이동시간과 거리를 보여준다. 계정 전체 개인 학습 점수는 제거한다.

### DR-016 · Kakao 경로 API P0

**상태:** `ACTIVE`

2026-07-21 출시된 도보·대중교통 경로 API를 P0에 통합한다. 이동시간은 선택에 영향을 주며 실패 시 가짜 시간을 만들지 않는다.

### DR-017 · 지도·정렬·경로 표현

**상태:** `ACTIVE`

지도에는 전체 적격 후보를 표시한다. 기본은 이동시간순, 대안은 관련도순이며 두 정렬은 선두 후보를 실제로 다시 구성한다. 한 목적지의 유효 경로 대안은 총 시간이 짧은 순으로 모두 보여준다. 교통수단 조합 필터는 후순위다.

### DR-018 · 위치 선택 동의

**상태:** `ACTIVE`

카카오 로그인은 필수지만 위치는 선택이다. Kakao Login 동의, 서비스 위치 고지와 브라우저 GPS 권한을 분리한다. 거부하면 역·동·구 입력으로 계속 이용한다.

### DR-019 · 전체 세션 멀티턴

**상태:** `ACTIVE` for later chatbot Feature, local MVP에서는 DR-033으로 제외

초기 확인 뒤 끝나는 단방향 흐름이 아니라 추천 이후에도 조건 추가·철회·결과 제외·정렬 변경·설명·경로 요청을 계속 처리하는 LangGraph 상태 기계를 사용한다. 시스템 질문은 추천 시도당 최대 2개, 사용자 발화는 무제한이다.

강한 부정은 유사도·관련도보다 먼저 적용한다.

### DR-020 · 카카오싱크 필수 계정

**상태:** `SUPERSEDED` by DR-024

일반 Kakao Login 후 자체 계정만 두는 방식보다 카카오싱크 간편가입을 채택한다. Auth.js Kakao provider를 사용하고 계정별 대화·추천·즐겨찾기·피드백을 저장한다. 비즈 앱·비즈니스 채널·약관 구성이 선행 조건이다.

### DR-021 · 전경 실시간 위치

**상태:** `ACTIVE`

정확 좌표를 저장하지 않되 지도·추천 화면이 전경에 열린 동안 위치를 계속 갱신한다. 100m 이상 이동 또는 사용자 요청 때 경로를 다시 계산하고 백그라운드 추적은 하지 않는다.

### DR-022 · 계정별 대화와 장기 취향 제외

**상태:** `ACTIVE`

과거 대화는 목록·열람·계속하기·삭제를 제공한다. 새 대화는 과거 취향을 자동 상속하지 않는다. 사용자가 `이 조건으로 새 대화 시작`을 선택할 때만 구조화 조건을 복사한다. 빵마다 선호가 달라질 수 있으므로 계정 전체 장기 취향 프로필은 만들지 않는다.

### DR-023 · 문서 모듈화

**상태:** `ACTIVE`

단일 서비스 기획서를 제품·경험·추천·계약·아키텍처·데이터·신뢰·실험·운영·결정 문서로 분리한다. `docs/README.md`가 허브이며 규범은 책임 문서 한 곳에서만 정의한다.

## 2026-07-23 구현 로드맵 결정

### DR-024 · 일반 Kakao Login과 내부 계정

**상태:** `ACTIVE`, DR-020 대체

사업자 등록과 비즈니스 채널이 필요한 KakaoSync 대신 Auth.js Kakao provider의 일반 Kakao Login을 사용한다. 최소 provider account ID만 자체 `user_id`에 연결하고 이메일·전화번호·생일·성별은 요구하지 않는다.

### DR-025 · 순수 데이터 우선 구현

**상태:** `ACTIVE`

서울 실제 데이터의 적재·정규화·적격 판정·Kakao 리뷰 특징·데이터 릴리스를 먼저 완성한 뒤 추천 엔진, 제품 백엔드와 UI를 구현한다. UI/UX는 데이터·추천·API 계약이 안정된 뒤 Codex가 설계서와 로컬 목업을 만들고 사용자 승인을 받는다. Figma MCP는 P0에서 사용하지 않는다.

### DR-026 · Kakao 리뷰 단일 출처와 서울 전체 batch

**상태:** `EXPERIMENT`, DR-009 확장

Naver Map 리뷰는 사용하지 않고 Kakao Map만 대상으로 한다. 관리자가 서울 전체 적격 매장 batch를 로컬에서 명시적으로 시작하며, 브라우저 페이지 1개로 매장별 최근 12개월·최대 20개를 순차 처리한다. PostgreSQL checkpoint로 일시정지·재개·전체 중단·실패 매장 재실행을 지원한다. 초기 전체 수집 뒤 우선순위 증분과 분기별 전체 갱신도 수동 시작한다.

### DR-027 · 리뷰 닉네임 일시 HMAC

**상태:** `ACTIVE`

리뷰 닉네임은 중복 판정 순간에만 메모리로 읽는다. 본문 비식별화 성공 뒤 `provider | store_id | normalized_nickname | published_date | normalized_deidentified_text`의 HMAC-SHA-256 지문을 만들고 원문 닉네임을 즉시 폐기한다. 닉네임은 저장·로그·표시하지 않고 지문으로 다른 매장의 작성자를 연결하지 않는다.

### DR-028 · 리뷰 우선 특징과 리뷰 부족 대체 추천

**상태:** `ACTIVE`, DR-003·DR-015 확장

최근 12개월 리뷰에 180일 반감기를 적용하고 서로 다른 유효 리뷰 3개 이상일 때만 리뷰 기반 특징을 확정한다. 검수된 실제 메뉴 카테고리는 리뷰 추정보다 우선한다. 리뷰가 부족해도 적격 매장을 제외하지 않고 하드 조건, 검수 메뉴, 방문 적합, 이동시간·거리, 데이터 완성도, 보정 별점, `store_id` 순의 대체 경로를 사용한다. 별점은 핵심 관련도에 넣지 않고 마지막 동점 보조값으로만 사용한다.

### DR-029 · 비용과 배포 승인 gate

**상태:** `SUPERSEDED` for local MVP by DR-033

5인 파일럿의 반복 운영비 합계를 월 30,000원 이하로 제한한다. Bread_map은 Kakao Developers 계정의 첫 Map 활성 앱으로 등록해 무료 쿼터 표시를 확인한다. 서울 전체 OpenAI 특징 추출은 실제 리뷰 100개 benchmark로 모델·정확도·비용·시간을 비교하고 사용자 승인을 받은 뒤 실행한다. OpenAI project budget은 soft threshold이므로 worker hard cap과 kill switch를 별도로 둔다.

### DR-030 · Feature 단위 Codex 작업과 브랜치

**상태:** `SUPERSEDED` by DR-034

P0 Epic은 19개 Feature로 나누고 Feature마다 새 Codex 작업과 `codex/...` 브랜치를 사용한다. 구현·직접 검증·수정은 같은 Feature 작업에서 완료하며 사용자 확인 뒤 병합한다. Subagent 사용은 루트 `AGENTS.md`의 main-agent-first 규칙을 따른다.

## 2026-07-24 사용자 UI 결정

### DR-031 · 지도 중심 레이아웃과 빵빵이 FAB 채팅

**상태:** `ACTIVE`, 현재 채팅 동작은 DR-033으로 축소

사용자 웹은 지도를 전체 배경으로 유지하고 가게 검색 결과와 상세 정보를 하나의 왼쪽 드로어에서 전환한다. 소금빵 2D 캐릭터 `빵빵이` 채팅은 우측 하단 FAB로 시작하며, 닫힘 상태에는 FAB만, 열림 상태에는 FAB 대신 비모달 플로팅 채팅창만 표시한다. 채팅을 열고 닫아도 지도 크기와 중심을 불필요하게 바꾸지 않는다. 갈색·연갈색·흰색, 둥근 형태와 WCAG 2.2 AA를 사용자 UI `v0.1` 기준으로 사용한다.

### DR-032 · 로컬 우선 SQLite·Drizzle 저장소

**상태:** `ACTIVE`, DR-004 대체·DR-005 구현 개정

현재 MVP는 사용자 PC의 `127.0.0.1`에서만 실행한다. PostgreSQL·Prisma·Docker를 필수로 보지 않고 SQLite/libSQL 호환 `app.sqlite`와 worker 전용 암호화 `raw.sqlite`, Drizzle migration과 FTS5를 사용한다. web은 `raw.sqlite`에 접근하지 않는다. 공개 배포는 완료 조건에서 제외하며 이후 친구 사용 단계에서 app 데이터만 Turso로 옮기고 Vercel에 web을 배포하는 방식을 별도로 검토한다. crawler와 `raw.sqlite`는 로컬에 유지한다.

### DR-033 · 챗봇 기능 후순위와 OpenAI 비용 0원

**상태:** `ACTIVE`, DR-013·DR-029 대체·DR-019 후순위·DR-031 확장

로컬 MVP는 실제 리뷰 수집·비식별화·FTS5, 구조화 검색·결정론적 추천, Kakao 로그인·지도·가게 상세와 빵빵이 채팅 UI 셸까지 구현한다. 채팅 입력과 제안 행동은 비활성화하고 OpenAI client·챗봇 API·생성형 답변을 연결하지 않는다. OpenAI 사용 비용 목표는 `$0`이다. 비식별 리뷰 corpus와 retrieval 경계는 유지해 후속 독립 Feature에서 재수집 없이 RAG와 멀티턴 챗봇을 연결한다. 후속 Feature 시작 시 모델·호출 수·token·비용 상한을 다시 승인한다.

### DR-034 · 로컬 MVP Feature 재구성

**상태:** `ACTIVE`, DR-030 대체

기존 19개 Feature 로드맵은 PostgreSQL·배포·챗봇 포함 범위를 설명하는 이력으로 남긴다. 로컬 MVP는 SQLite 저장소 전환, 서울 데이터·리뷰, 검색·결정론적 추천, Kakao 인증·지도, 승인된 사용자 UI와 E2E로 다시 나눈다. 각 독립 Feature는 새 Codex 작업에서 구현과 직접 검증을 완료하며 Subagent 사용은 루트 `AGENTS.md`의 main-agent-first 기준을 따른다. 실제 Feature 수와 순서는 새 구현 계획이 소유한다.

### DR-035 · Kakao 빵집 발견과 review 수집 경계

**상태:** `ACTIVE`, DR-007·DR-027·DR-034 확장

서울 Kakao keyword search의 `빵집` 결과 중 마지막 category segment가 정규화 후 정확히 `제과,베이커리`인 장소를 franchise 포함 후보 관측으로 수집한다. Kakao place ID와 locator는 worker-only `raw.sqlite`에서 review navigation·resume에 필요한 동안만 보존하며 permanent catalog identity로 사용하지 않는다. 장소 관측 allowlist는 400일, locator와 encrypted review는 최대 30일 보존한다.

Review 수집은 Feature 3 `catalog_status='published'` 매장에만 수행하고 최근 12개월·최대 20개로 제한한다. Nickname은 HMAC fingerprint 계산 직후 폐기한다. 장소 발견은 공식 API, 동적 review는 local Playwright active page 1개로 수행하며 login·CAPTCHA·401·403·429·access denial·DOM 변경을 우회하지 않는다.

## 결정 변경 절차

1. 바꾸려는 기존 DR과 영향을 받는 기준 문서를 식별한다.
2. 대안, 사용자 영향, 데이터·보안·운영 비용을 기록한다.
3. 새 DR을 만들고 이전 DR을 `SUPERSEDED` 또는 확장 상태로 연결한다.
4. PRD와 해당 책임 문서를 같은 변경에서 갱신한다.
5. 관련 평가 세트·수용 기준·분석 이벤트를 갱신한다.

## 관련 문서

- 제품 범위: [PRD](../00-product/prd.md)
- 계산 결정: [추천 기준](../02-recommendation/recommendation-spec.md)
- 인증·멀티턴: [시스템 구조](../04-architecture/system-architecture.md)
- 개인정보·정책: [보안 설계](../06-trust/security-design.md), [정책 검토](../06-trust/policy-review.md)
