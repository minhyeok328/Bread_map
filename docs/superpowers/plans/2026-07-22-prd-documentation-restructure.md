# PRD Documentation Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 두 개의 대형 기획 문서를 책임별 위키 문서로 분리하고, 2026-07-22까지 승인된 제품·멀티턴·카카오싱크·위치·추천·검증 결정을 일관되게 반영한다.

**Architecture:** `docs/README.md`를 단일 문서 허브로 두고 제품, 경험, 추천, 계약, 아키텍처, 데이터, 신뢰, 실험, 운영, 결정 기록을 번호 폴더로 나눈다. 기존 `service-plan.md`는 이전 안내문으로 바꾸고, 기존 데이터 설계는 상세 내용을 보존한 채 `05-data/data-design.md`로 이동하여 충돌 항목만 갱신한다.

**Tech Stack:** Markdown, Mermaid, PowerShell 기반 문서 검증, Git

## Global Constraints

- 문서는 한국어로 작성하고 코드 식별자와 경로는 원문을 유지한다.
- MVP 주 사용자는 특정 메뉴 탐색형 사용자다.
- 승인된 넓은 P0 범위를 축소하지 않는다.
- 사용자 화면에 숫자형 추천 점수를 표시하지 않는다.
- 의료·알레르기 상태를 추천 필터나 점수에 사용하지 않고 매장 직접 확인을 안내한다.
- 카카오싱크 로그인은 필수이며 계정 전체 장기 취향 기억은 만들지 않는다.
- 위치 사용은 선택 동의이고 앱 전경에서만 갱신하며 정확 좌표는 영구 저장하지 않는다.
- Kakao 경로 API는 2026-07-21 출시된 P0 통합 대상으로 기술한다.
- 새 대화는 과거 조건을 자동 상속하지 않으며 과거 대화는 열람·계속하기·삭제할 수 있다.
- 리뷰 수집은 관리자 전용 로컬 정책 위험 실험으로 격리한다.
- 모든 문서는 `docs/README.md`에서 도달 가능해야 한다.
- 애플리케이션 코드는 생성하거나 수정하지 않는다.

---

### Task 1: 문서 허브와 제품 기준

**Files:**
- Create: `docs/README.md`
- Create: `docs/00-product/prd.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-22-prd-restructure-design.md`의 승인 결정
- Produces: 모든 후속 문서가 링크하는 제품 범위, 요구사항 ID, 지표와 문서 탐색 경로

- [ ] **Step 1: 문서 허브 작성**

`docs/README.md`에 권장 읽기 순서, 각 기준 문서의 책임, 상태 표와 전체 상대 링크를 작성한다. 설계·실행 계획은 `superpowers` 작업 기록으로 별도 묶는다.

- [ ] **Step 2: 간결한 PRD 작성**

`docs/00-product/prd.md`에 문서 상태, 사용자·JTBD, 문제, 제품 가설, P0·후순위·비목표, 핵심 흐름, `FR-*`/`NFR-*` 요구사항, 성공 지표, 로드맵과 세부 문서 링크를 작성한다. 알고리즘 수식, JSON Schema와 DB 테이블 사전은 넣지 않는다.

- [ ] **Step 3: 루트 README 갱신**

`README.md`의 `로컬 MVP`, `100점 취향 적합도`, 기존 문서 직접 링크 표현을 카카오 계정 기반 비공개 MVP, 이유·시간·거리 중심 결과, 문서 허브 링크로 교체한다.

- [ ] **Step 4: 제품 문서 검사**

Run:

```powershell
rg -n "특정 메뉴|JTBD|FR-|NFR-|80%|85%|카카오싱크" docs/00-product/prd.md docs/README.md README.md
```

Expected: 각 핵심 기준이 최소 한 번 나타나고 기존 `100점 취향 적합도` 표현은 나타나지 않는다.

### Task 2: 사용자 경험과 카피

**Files:**
- Create: `docs/01-experience/user-journey.md`
- Create: `docs/01-experience/ux-states-and-copy.md`

**Interfaces:**
- Consumes: PRD의 `FR-AUTH-*`, `FR-CONV-*`, `FR-LOC-*`, `FR-REC-*`, `FR-DATA-*`
- Produces: 화면 흐름, 사용자 행동, 상태별 UI와 제품의 공식 안내 문구

- [ ] **Step 1: 전체 사용자 여정 작성**

로그인, 카카오싱크 동의, 별도 위치 선택 동의, 자연어 입력, 최대 2개 확인 질문, 조건 요약, 지도·목록, 추천 후 멀티턴 수정, 상세·경로, 즐겨찾기, 과거 대화, 조건 복사, 삭제와 탈퇴까지의 흐름을 작성한다.

- [ ] **Step 2: 대화 기억 경계 작성**

새 대화는 빈 상태, 과거 대화는 재개 가능, `이 조건으로 새 대화 시작`은 명시적 복사, 계정 전체 장기 취향은 없음이라는 네 기준을 사용자 여정에 명시한다.

- [ ] **Step 3: 상태와 카피 작성**

로그인 실패, 위치 거부·시간 초과·철회, 경로 API 실패, LLM 분석·설명 실패, 빈 결과, 오래된 데이터, 비용 상한, 삭제 확인과 과거 추천 재열기 상태를 표로 정의한다. 위치 고지, 의료 안전 고지와 빈 결과 문구는 완성된 한국어 문장으로 작성한다.

- [ ] **Step 4: 경험 문서 검사**

Run:

```powershell
rg -n "선택 동의|브라우저|100m|새 대화|이 조건으로 새 대화 시작|직접 확인|경로 API 실패" docs/01-experience
```

Expected: 위치 권한과 카카오 동의가 분리되고 모든 대체 흐름이 문서화된다.

### Task 3: 추천 규칙과 평가 계획

**Files:**
- Create: `docs/02-recommendation/recommendation-spec.md`
- Create: `docs/02-recommendation/evaluation-plan.md`

**Interfaces:**
- Consumes: PRD의 추천 요구사항과 기존 `service-plan.md`의 후보·필터·점수·동점·최신성 규칙
- Produces: 결정론적 추천 계약, 정렬 계약, 대표 평가 세트와 요구사항 추적표

- [ ] **Step 1: 후보와 필터 규칙 이동**

서울 독립 베이커리 포함 정책, 영업·체인·게시 상태, 특징 근거, 강한 제외 우선 적용, 완화 가능·불가능 조건을 추천 기준서에 작성한다. 의료 상태를 필터에서 제거하고 안전 고지를 연결한다.

- [ ] **Step 2: 내부 관련도와 결과 정렬 작성**

기존 맛·메뉴·방문 맥락·근거·거리 구성의 결정론적 내부 관련도를 정의하되 숫자 총점은 UI 계약에서 금지한다. 기본 `이동시간순`, 대안 `관련도순`, 전체 적격 지도 마커, 정렬별 선두 후보 재구성, 전체 경로 대안의 짧은 시간순을 명시한다.

- [ ] **Step 3: 평가 계획 작성**

20개 대표 취향 시나리오, 개발자+독립 평가자 1명의 정답 후보 합의 절차, Hit Rate@5 85%, 강한 제외 0건, 결정성 100%, 5인 사용성 파일럿 지표와 실패 대체 흐름을 작성한다.

- [ ] **Step 4: 추적성 표 작성**

PRD 요구사항마다 수용 기준, 단위·통합·E2E·수동 평가, 측정 증거를 연결한다. 강한 부정, 정렬 전환, 위치 거부, 0개 결과, 과거 대화와 삭제를 반드시 포함한다.

- [ ] **Step 5: 추천 문서 검사**

Run:

```powershell
rg -n "hardExcluded|강한 제외|이동시간순|관련도순|Hit Rate@5|결정성|직접 확인" docs/02-recommendation
```

Expected: 제외 선필터, 두 정렬, 수치 목표와 안전 경계가 모두 나타난다.

### Task 4: LLM 계약과 전체 세션 멀티턴 아키텍처

**Files:**
- Create: `docs/03-contracts/llm-contracts.md`
- Create: `docs/04-architecture/system-architecture.md`
- Create: `docs/04-architecture/worker-design.md`

**Interfaces:**
- Consumes: 추천 기준서의 결정론적 경계와 기존 `TasteIntentV1`, `VisitContextV1`, `BakeryTasteFeatureV1` 계약
- Produces: LangGraph 상태·전이, LLM 입출력·금지사항, 앱·worker·DB·외부 공급자 경계

- [ ] **Step 1: LLM 계약 작성**

`ConversationIntentV2`, 확인 질문, 추천 설명과 리뷰 특징 추출의 JSON 계약을 작성한다. `wanted`, `avoided`, `hardExcluded`, `visitContext`, `resultControls`를 분리하고 추가 속성 금지, 기권, 한 번 재시도와 템플릿 대체를 명시한다.

- [ ] **Step 2: 부정 조건 검증 작성**

원문 부정 표현과 구조화 결과의 불일치를 결정론적으로 검사하고, `hardExcluded`가 임베딩·후보 관련도보다 먼저 적용되는 계약을 작성한다. 의료 상태는 구조화 추천 필드로 만들지 않는다.

- [ ] **Step 3: 시스템 아키텍처 작성**

Next.js web, Auth.js Kakao provider, KakaoSync, LangGraph, PostgreSQL/Prisma, `app_db`, `raw_db`, worker, Kakao Maps API와 OpenAI의 흐름을 Mermaid로 작성한다. 대화별 checkpoint와 계정 소유권, 전경 위치 갱신, 저장 금지 경계를 표시한다.

- [ ] **Step 4: 전체 세션 그래프 작성**

`WAIT_USER → classify → update → validate → clarify 또는 hard-filter → recommend → explain → persist → WAIT_USER` 반복과 사용자 수정·취소·결과 제외·정렬 변경·경로 요청을 작성한다. 시스템 확인 질문은 추천 시도당 2회, 사용자 후속 발화는 무제한이다.

- [ ] **Step 5: worker 설계 분리**

LOCALDATA·공정위 적재, 정규화, 체인 판정, 리뷰 수집, PII 제거, 특징 추출, 집계, 작업 테이블, 멱등성과 실패 격리를 `worker-design.md`로 옮긴다.

- [ ] **Step 6: 계약·아키텍처 검사**

Run:

```powershell
rg -n "ConversationIntentV2|additionalProperties|WAIT_USER|Auth.js|Kakao|LangGraph|FOR UPDATE SKIP LOCKED" docs/03-contracts docs/04-architecture
```

Expected: 계약, 반복 그래프, 인증과 worker 작업 경계가 모두 나타난다.

### Task 5: 데이터 설계 이동과 계정·대화 모델 반영

**Files:**
- Move: `docs/data-design.md` → `docs/05-data/data-design.md`
- Modify: `docs/05-data/data-design.md`

**Interfaces:**
- Consumes: 기존 데이터 설계 전체와 인증·대화·위치의 새 기준
- Produces: 상세 데이터 기준서, 계정별 다중 대화 모델, 보존·삭제와 Kakao 경로 데이터 경계

- [ ] **Step 1: 파일을 새 책임 위치로 이동**

Git 이동으로 전체 기존 내용을 보존하고 제목 아래에 문서 허브 및 관련 기준서 링크를 추가한다.

- [ ] **Step 2: 오래된 실행 전제 교체**

`개인 로컬 MVP`, `local_profile_id`, `2026-07-21 예정`, 요청 단위 위치 사용, 추천 이력 90일 중심 표현을 비공개 5인 다중 사용자, 카카오 계정, 출시된 경로 API, 전경 위치 사용, 대화 수명 연동으로 교체한다.

- [ ] **Step 3: 인증·대화 테이블 반영**

`user_account`, `auth_account`, `auth_session`, `conversation`, `conversation_message`, `conversation_state`, `recommendation_run`, `recommendation_item`의 키·소유권·보존·삭제 규칙을 ERD와 테이블 사전에 추가한다. 이메일·전화번호·생일·성별과 정확 위치 열을 만들지 않는다.

- [ ] **Step 4: 위치·경로 경계 반영**

정확 좌표는 세션 메모리에서만 사용하고 Kakao 경로 요청으로 전송될 수 있으며 DB·로그·분석·OpenAI에는 저장하지 않는다고 작성한다. 위치 변화 100m 또는 사용자 요청 시 재계산하고 Kakao 원본 경로 응답을 보존하지 않는다.

- [ ] **Step 5: 삭제·테스트 규칙 갱신**

대화 삭제 cascade, 탈퇴 삭제, Kakao unlink 재시도, 계정 간 IDOR 차단, 새 대화 상태 격리, 정확 위치 비저장을 데이터 테스트에 추가한다.

- [ ] **Step 6: 데이터 문서 검사**

Run:

```powershell
rg -n "user_account|auth_account|conversation_message|conversation_state|Kakao|100m|정확.*좌표|cascade|IDOR" docs/05-data/data-design.md
```

Expected: 새 모델과 위치·삭제 경계가 모두 나타나고 원본 상세 설계가 유지된다.

### Task 6: 신뢰, 정책, 실험과 운영 기준 분리

**Files:**
- Create: `docs/06-trust/security-design.md`
- Create: `docs/06-trust/policy-review.md`
- Create: `docs/07-experiments/review-collection-experiment.md`
- Create: `docs/08-operations/operating-baselines.md`
- Create: `docs/09-decisions/decision-log.md`

**Interfaces:**
- Consumes: 기존 보안·리뷰 수집·오류·비용·결정 기록과 승인된 카카오·위치 결정
- Produces: 개인정보·인증 기준, 플랫폼 위험 판정, 격리 실험, 운영 수치와 변경 이력

- [ ] **Step 1: 보안 기준 작성**

Auth.js 세션, Kakao provider ID 최소 수집, 카카오 동의와 브라우저 권한 분리, 위치 좌표 금지, 계정 소유권, CSRF·IDOR·비밀 관리, 대화·탈퇴 삭제와 외부 unlink 실패 처리를 작성한다.

- [ ] **Step 2: 정책 검토 작성**

카카오싱크 도입 선행 조건, Kakao 경로 좌표 전송, 네이버·카카오 리뷰 자동 수집 허용 근거 미확인, 공개 전 제거·라이선스 전환 조건과 공식 출처를 작성한다.

- [ ] **Step 3: 리뷰 수집 실험 작성**

관리자 로컬 수동 실행, 장소·플랫폼별 30건, 실행당 5개 장소, 2~5초 간격, 즉시 중단 조건, 금지 우회, PII 제거·암호화·30일 원문 삭제, kill switch와 종료 기준을 작성한다.

- [ ] **Step 4: 운영 기준 작성**

주당 5시간, 비공개 5명, 공공 원장 7일 경고·30일 차단, LLM 비용 상한, Kakao 쿼터 관찰, 위치·경로 호출 합치기, 장애별 대체 흐름과 운영 체크리스트를 작성한다.

- [ ] **Step 5: 결정 기록 작성**

기존 DR을 보존·정리하고 2026-07-22의 P0 유지, 안전 고지, 숫자 점수 비표시, 경로 P0, 전체 세션 멀티턴, 카카오싱크 필수, 위치 선택·전경 사용, 계정별 대화와 장기 취향 제외 결정을 추가한다.

- [ ] **Step 6: 신뢰·운영 문서 검사**

Run:

```powershell
rg -n "카카오싱크|선택 동의|IDOR|30건|5개 장소|주당 5시간|DR-" docs/06-trust docs/07-experiments docs/08-operations docs/09-decisions
```

Expected: 승인·정책·실험·운영 기준이 책임 문서별로 존재한다.

### Task 7: 기존 문서 이전 안내와 교차 링크

**Files:**
- Replace: `docs/service-plan.md`
- Modify: all pages under `docs/00-product` through `docs/09-decisions`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: 완성된 모든 기준 문서 경로
- Produces: 중복 규범 없는 이전 안내와 양방향 위키 탐색

- [ ] **Step 1: 기존 서비스 기획서를 이전 안내로 교체**

파일을 삭제하지 않고 새 PRD, 문서 허브, 설계 기록 링크와 2026-07-22 이전 사실을 안내하는 짧은 문서로 바꾼다.

- [ ] **Step 2: 상호 참조 추가**

각 문서 상단에 허브 링크, 하단에 관련 문서 링크를 두고 알고리즘·스키마·카피·정책의 기준 문서를 명시한다.

- [ ] **Step 3: 허브 도달성 갱신**

최종 파일 목록과 `docs/README.md` 링크가 일치하도록 갱신한다. `superpowers/specs`와 `superpowers/plans`도 작업 기록으로 연결한다.

- [ ] **Step 4: Git 상태 확인**

Run:

```powershell
git status --short
git diff --stat
```

Expected: 계획에 명시된 Markdown 파일만 생성·이동·수정된다.

### Task 8: 전체 문서 검증과 커밋

**Files:**
- Verify: `README.md`
- Verify: every tracked Markdown file under `docs/`

**Interfaces:**
- Consumes: Task 1~7의 전체 결과
- Produces: 링크와 승인 결정의 정합성 증거 및 최종 Git 변경 이력

- [ ] **Step 1: 로컬 Markdown 링크 검사**

PowerShell에서 모든 Markdown의 상대 파일 링크를 추출하고 anchor·웹 URL을 제외한 대상이 실제로 존재하는지 검사한다. 누락 링크가 있으면 파일과 링크를 수정한 후 다시 실행한다.

- [ ] **Step 2: 오래된 충돌 표현 검사**

Run:

```powershell
rg -n "MVP는 계정을 만들지 않는다|local_profile_id|2026-07-21 예정|화면에는.*100점|의료 안전.*하드 필터" README.md docs -g "*.md" -g "!docs/superpowers/**"
```

Expected: 이전 충돌 표현이 0건이다.

- [ ] **Step 3: 승인된 기준 존재 검사**

Run:

```powershell
rg -l "카카오싱크" docs/00-product docs/01-experience docs/04-architecture docs/06-trust
rg -l "장기 취향" docs/00-product docs/01-experience docs/04-architecture docs/05-data
rg -l "정확.*좌표" docs/01-experience docs/04-architecture docs/05-data docs/06-trust
```

Expected: 제품·경험·아키텍처·데이터·신뢰 문서에서 각 교차 기준이 확인된다.

- [ ] **Step 4: 형식과 범위 검사**

Run:

```powershell
git diff --check
git diff --name-status
git status --short
```

Expected: 공백 오류가 없고 애플리케이션 파일 변경이 없으며 계획된 문서만 변경된다.

- [ ] **Step 5: 요구사항 자체 검토**

설계 기준서 2~18절을 다시 읽고 각 결정이 PRD 또는 해당 책임 문서에 반영됐는지 표로 대조한다. 빠진 항목이 있으면 책임 문서에 추가하고 Step 1~4를 반복한다.

- [ ] **Step 6: 변경사항 커밋**

Run:

```powershell
git add README.md docs
git commit -m "docs: restructure product specification"
```

Expected: 문서 개편 전체가 하나의 검증된 커밋으로 생성되고 작업 트리가 깨끗하다.
