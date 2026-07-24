# 로컬 MVP 책임 문서 동기화 설계

**작성일:** 2026-07-24

**상태:** 사용자 승인

**대상:** 루트 소개, 제품·경험·추천·계약·아키텍처·데이터·신뢰·실험·운영·전달 책임 문서

**이번 작업의 성격:** 애플리케이션 구현이 아니라 DR-032·DR-033·DR-034와 승인된 로컬 MVP 설계를 기존 책임 문서에 일관되게 반영하는 문서 동기화

## 1. 배경

2026-07-23 기준 문서는 PostgreSQL·Prisma·Docker, 자연어 멀티턴·OpenAI와 5인 HTTPS 파일럿을 하나의 P0로 설명한다. 2026-07-24에 승인된 다음 결정은 현재 완료 목표를 로컬 우선 MVP로 다시 정의했다.

- DR-032: SQLite·Drizzle 저장소와 로컬 `127.0.0.1` 실행
- DR-033: 실제 챗봇과 OpenAI를 후순위로 이동하고 현재 비용을 `$0`으로 제한
- DR-034: 기존 19개 Feature를 이력으로 남기고 로컬 MVP를 10개 Feature로 재구성

[문서 허브](../../README.md)는 최신 설계와 계획을 먼저 읽도록 안내하지만, PRD·시스템 구조·데이터 설계·운영·전달 문서 본문에는 대체된 온라인 P0 표현이 남아 있다. 이 상태에서는 개발자가 책임 문서와 최신 결정 중 무엇을 구현해야 하는지 매번 해석해야 한다.

## 2. 목표와 비목표

### 목표

1. 현재 로컬 MVP와 후속 챗봇·배포 범위를 모든 책임 문서에서 같은 의미로 구분한다.
2. 승인된 목표 구조와 아직 남아 있는 PostgreSQL scaffold를 혼동하지 않게 한다.
3. SQLite·Drizzle·FTS5, 구조화 검색, 결정론적 추천과 OpenAI `$0`을 현재 기준으로 만든다.
4. 기존의 개인정보·정책·추천 품질 기준 중 로컬 MVP에서도 유효한 규칙을 보존한다.
5. 문서 허브에서 현재 기준 문서, 후속 범위와 과거 이력을 명확히 탐색할 수 있게 한다.
6. Feature 1이 문서 해석 없이 승인된 상세 계획대로 시작될 수 있게 한다.

### 비목표

- 애플리케이션 코드, package manifest, schema, migration과 runtime 설정 변경
- SQLite 전환이 이미 구현됐다고 문서에 기록
- 기존 결정 로그와 `docs/superpowers`의 과거 설계·계획 다시 쓰기
- 자연어 멀티턴·RAG·OpenAI·Vercel·Turso 요구사항 삭제
- Kakao 리뷰 수집의 정책 위험을 해결됐다고 표현
- 제품·추천·개인정보 요구사항의 신규 범위 추가

## 3. 기준 우선순위

동기화는 다음 순서의 기준을 따른다.

1. [결정 기록](../../09-decisions/decision-log.md)의 DR-032·DR-033·DR-034
2. [로컬 우선 SQLite 웹 MVP 설계](2026-07-24-local-first-sqlite-web-design.md)
3. [로컬 우선 SQLite MVP 마스터 구현 계획](../plans/2026-07-24-local-first-sqlite-mvp-master.md)
4. 각 영역의 기존 책임 문서에서 위 결정과 충돌하지 않는 규칙
5. 실제 저장소의 현재 PostgreSQL·Prisma 최소 scaffold

1~3은 승인된 목표를 정의하고, 5는 전환 전 구현 상태를 설명한다. 실제 코드가 목표 구조로 바뀌기 전까지 두 상태를 같은 것으로 표현하지 않는다.

## 4. 검토한 접근

### A. 최신 결정 안내문만 추가

각 문서 상단에 “DR-032~034가 우선한다”는 배너만 추가한다. 변경량은 작지만 본문의 기술 스택·실행 절차·완료 조건이 계속 충돌하고, 독자가 매번 대체 관계를 해석해야 한다.

### B. 책임 문서 선택 동기화

최신 결정에 영향을 받는 문장·표·흐름·완료 조건만 현재 로컬 MVP에 맞게 바꾼다. 후속 기능은 별도 절로 이동하고 과거 기록은 보존한다. 실제 코드와 목표 구조가 다른 전달 문서에는 전환 상태를 명시한다.

### C. 전체 문서 재작성

모든 기준 문서를 로컬 MVP만 남도록 새로 쓴다. 표면적인 일관성은 높지만 검증된 추천·보안·정책 규칙을 잃거나 후속 제품 비전을 삭제할 위험이 크다.

**선택:** B. 문서 소유권과 이력을 유지하면서 현재 개발 범위만 명확히 바꾼다.

## 5. 범위 모델

### 현재 로컬 MVP

| 영역 | 현재 기준 |
|---|---|
| 실행 | 사용자 PC의 `127.0.0.1` |
| 사용자 | 우선 본인, Kakao 계정 구조와 계정별 격리 유지 |
| 배포 | 완료 조건에서 제외 |
| 저장소 | SQLite/libSQL 호환 `app.sqlite`, worker 전용 `raw.sqlite` |
| schema·migration | Drizzle |
| 검색 | 구조화 필터와 FTS5 |
| 추천 | 결정론적 필터·정렬, 숫자 총점 비공개 |
| 리뷰 | Kakao Map 정책 위험 관리자 로컬 수동 batch |
| UI | 전체 지도, 왼쪽 가게 드로어, 우측 하단 빵빵이 FAB |
| 채팅 | 비활성 UI 셸만 제공 |
| OpenAI | client·API route·key 요구사항 없음, 비용 `$0` |
| 복구 | SQLite WAL, checkpoint, app DB snapshot |

### 후속 독립 Feature

- 자연어 의도 구조화와 전체 세션 멀티턴
- RAG, 생성형 설명과 실제 빵빵이 답변
- OpenAI 모델·호출 수·token·비용 승인
- Vercel·Turso 기반 친구 사용과 5인 파일럿
- HTTPS production callback과 원격 운영

후속 범위는 삭제하지 않는다. 현재 완료 조건과 섞이지 않도록 각 책임 문서에서 `후속 Feature`로 명시한다.

### 계속 유효한 공통 기준

- 서울의 승인된 독립점과 검수된 소규모 직영 브랜드만 사용
- 강한 제외가 관련도보다 우선
- 별점은 마지막 동점 보조값
- 리뷰가 부족한 매장을 자동 제외하지 않음
- 정확한 사용자 위치 비저장
- web의 raw 저장소 접근 금지
- 리뷰 닉네임은 HMAC 입력 직후 폐기
- 비식별 실패 리뷰는 서비스 DB·검색 색인에서 제외
- 수집 제한·CAPTCHA·403·429 우회 금지
- 재료·알레르기·교차접촉 안전을 판정하지 않음

## 6. 문서별 동기화 책임

### 루트와 허브

- `README.md`: 현재 제품 소개를 구조화 검색 기반 로컬 MVP로 바꾸고 현재 마스터 계획을 우선 링크한다.
- `docs/README.md`: 현재 기준, 전환 중 코드, 후속 범위와 과거 이력을 구분한다.
- `docs/service-plan.md`: 책임 문서 안내에 현재 로컬 MVP 기준 링크를 추가한다.

### 제품과 경험

- `docs/00-product/prd.md`: 현재 P0를 로컬 MVP로 재정의하고 자연어·멀티턴·배포·5인 파일럿을 후속 단계로 이동한다.
- `docs/01-experience/user-journey.md`: 현재 흐름을 지도·검색·필터·상세·즐겨찾기 중심으로 바꾸고 채팅은 비활성 셸로 표시한다.
- `docs/01-experience/ux-states-and-copy.md`: LLM 실패·대화 상태는 후속 범위로 이동하고 FTS·리뷰 부족·지도·OAuth·SQLite 실패 대체를 현재 상태로 정리한다.
- `docs/01-experience/design-system.md`: 승인된 UI는 유지하고 기존 19개 Feature 계획 링크와 LLM 현재 상태 표현만 갱신한다.

### 추천과 계약

- `docs/02-recommendation/recommendation-spec.md`: 현재 입력을 구조화 검색 조건으로 정의하고 `ConversationIntentV2` 의존을 후속 adapter로 이동한다.
- `docs/02-recommendation/evaluation-plan.md`: 대표 검색·필터·결정성·리뷰 부족·UI 상태를 현재 평가 대상으로 바꾸고 멀티턴·LLM·5인 사용성은 후속 평가로 분리한다.
- `docs/03-contracts/llm-contracts.md`: 계약 내용은 보존하되 전체 문서를 후속 챗봇 Feature의 승인 전 계약으로 표시하고 현재 runtime 요구사항에서 제외한다.

### 아키텍처와 데이터

- `docs/04-architecture/system-architecture.md`: SQLite·Drizzle·FTS5와 repository 경계를 현재 구조로 정의하고 LangGraph·OpenAI·원격 배포를 후속 구조로 이동한다.
- `docs/04-architecture/worker-design.md`: SQLite checkpoint·암호화 raw 저장소·비식별화·FTS 게시를 현재 파이프라인으로 바꾸고 LLM 추출·PostgreSQL queue를 후속 또는 대체 이력으로 표시한다.
- `docs/05-data/data-design.md`: PostgreSQL·Prisma 타입과 운영 절차를 SQLite·Drizzle 목표 모델로 갱신한다. 아직 구현되지 않은 domain table은 설계 계약으로 표시하고, 실제 현재 scaffold와 혼동하지 않게 한다.

### 신뢰·실험·운영

- `docs/06-trust/security-design.md`: 파일 기반 이중 저장소와 로컬 secret 경계를 반영하되 계정 소유권·위치·삭제 원칙은 유지한다.
- `docs/06-trust/policy-review.md`: OpenAI 처리를 후속 승인 항목으로, 공개 배포를 별도 재검토 gate로 표시한다.
- `docs/07-experiments/review-collection-experiment.md`: PostgreSQL checkpoint를 SQLite checkpoint로 바꾸고 LLM 특징 추출 대신 비식별 corpus·FTS 게시를 현재 산출물로 정의한다.
- `docs/08-operations/operating-baselines.md`: 단일 PC 로컬 운영, OpenAI `$0`, SQLite snapshot·복구와 외부 연동 수동 smoke 기준으로 바꾼다.

### 전달

- `docs/10-delivery/technology-stack.md`: 승인 목표 스택과 현재 PostgreSQL scaffold를 별도 표로 구분한다.
- `docs/10-delivery/directory-structure.md`: 목표 `drizzle/`, `packages/sqlite-core`, `packages/retrieval`, `var/` 구조와 전환 전 경로를 구분한다.
- `docs/10-delivery/local-development.md`: 존재하지 않는 SQLite 명령을 현재 명령처럼 쓰지 않는다. Feature 1 전환 전 실행 상태와 전환 후 목표 절차를 분리한다.
- `docs/10-delivery/development-readiness-checklist.md`: Docker·OpenAI·배포를 현재 필수 준비에서 제거하고 Feature별 외부 key 준비 시점을 새 10개 Feature에 맞춘다.
- `docs/10-delivery/README.md`: 현재 마스터 계획과 Feature 1 상세 계획을 기본 실행 경로로 유지하고 기존 19개 계획을 이력으로 표시한다.

### 변경하지 않는 기록

- `docs/09-decisions/decision-log.md`
- 기존 `docs/superpowers/specs/*`
- 기존 `docs/superpowers/plans/*`

새 동기화 설계와 실행 계획만 `docs/superpowers`에 추가한다.

## 7. 전환 상태 표현 규칙

문서는 다음 세 상태를 구분한다.

1. **승인된 목표:** 로컬 SQLite MVP가 구현 완료 시 가져야 할 구조
2. **현재 구현:** PostgreSQL·Prisma 기반 최소 scaffold
3. **후속 범위:** 챗봇·OpenAI·원격 배포와 5인 파일럿

현재 코드가 바뀌기 전에는 `SQLite 전환 완료`, `db:migrate 사용 가능`, `app.sqlite가 생성된다`처럼 구현 사실을 단정하지 않는다. 반대로 기술 스택 책임 문서에서 PostgreSQL을 현재 승인 목표로 유지하지 않는다.

Feature 1 완료 시 실제 코드와 명령을 다시 확인하고 전달 문서의 전환 상태를 “구현 완료”로 갱신한다.

## 8. 검증 전략

### 범위 검사

현재 책임 문서의 활성 MVP 설명에서 다음 항목이 필수 요구사항으로 남아 있지 않아야 한다.

- PostgreSQL·Prisma·Docker
- LangGraph·OpenAI client·`OPENAI_API_KEY`
- 자연어 멀티턴과 생성형 답변
- HTTPS 배포·Vercel·Turso
- 5인 파일럿과 월 30,000원 운영비

위 용어는 `현재 scaffold`, `후속 Feature`, `대체된 이력`이라는 문맥에서만 허용한다.

### 존재 검사

관련 책임 문서에는 다음 기준이 확인돼야 한다.

- 로컬 `127.0.0.1`
- SQLite·Drizzle·FTS5
- `app.sqlite`·`raw.sqlite` 경계
- 구조화 검색과 결정론적 추천
- 채팅 입력 비활성
- OpenAI 비용 `$0`
- app DB snapshot·checkpoint 복구

### 구조 검사

- `docs/README.md`에서 모든 책임 문서와 현재 계획에 도달 가능
- 상대 Markdown 파일 링크가 모두 존재
- 과거 `docs/superpowers` 기록에 의도하지 않은 수정 없음
- 애플리케이션·manifest·schema 변경 없음
- `git diff --check` 통과

### 의미 검사

- 같은 기능이 문서마다 현재와 후속으로 다르게 분류되지 않음
- PRD의 현재 P0와 마스터 계획 Feature 1~10이 대응함
- 시스템·worker·데이터의 저장소와 checkpoint 설명이 일치함
- 보안·실험·운영의 raw 보존·위치·로그 금지 규칙이 일치함
- 전달 문서가 아직 존재하지 않는 명령을 실행 가능하다고 주장하지 않음

## 9. 작업 순서

1. 현재/후속/이력 용어와 공통 상태 문구를 고정한다.
2. 루트 README·문서 허브·PRD를 갱신해 범위의 상위 기준을 맞춘다.
3. 경험·추천·LLM 계약을 현재 구조화 검색 흐름에 맞춘다.
4. 시스템·worker·데이터 저장소 설명을 SQLite 목표 구조로 맞춘다.
5. 보안·정책·실험·운영 기준을 로컬 실행에 맞춘다.
6. 전달 문서에 승인 목표와 전환 전 실제 scaffold를 구분한다.
7. 링크·용어·범위·Git 변경 검사를 수행한다.
8. 미해결 충돌이 있으면 조용히 가정하지 않고 문서와 함께 보고한다.

## 10. 완료 조건

- 모든 현재 책임 문서가 DR-032·DR-033·DR-034와 모순되지 않는다.
- 로컬 MVP와 후속 챗봇·배포 범위가 명시적으로 분리된다.
- 승인 목표와 현재 PostgreSQL scaffold가 구분된다.
- Feature 1~10과 PRD·평가·전달 문서가 같은 우선순위를 사용한다.
- OpenAI `$0`과 비활성 채팅 셸이 현재 완료 조건에 반영된다.
- 개인정보·정책·추천 품질의 기존 보호 기준이 유지된다.
- 과거 결정과 계획 이력이 변경되지 않는다.
- 애플리케이션 코드 변경 없이 문서 검증이 통과한다.
