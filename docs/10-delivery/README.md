# 구현·릴리스 안내

[문서 허브](../README.md) · [로컬 개발 환경](local-development.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서군은 구현된 로컬 SQLite foundation과 후속 로컬 MVP Feature의 실행·검증 경계를 설명한다. PostgreSQL·Prisma scaffold는 Feature 1 replacement gate 통과 뒤 제거됐다.

## 현재 실행 경로

1. [로컬 우선 SQLite MVP 마스터 구현 계획](../superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md): 현재 10개 Feature 순서와 공통 gate
2. [Feature 1 SQLite 저장소 기반 상세 계획](../superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md): 첫 Feature의 file·test·commit 절차
3. [Feature 2 서울 source 적재 상세 계획](../superpowers/plans/2026-07-26-seoul-source-ingestion.md): LOCALDATA fixture·계약·staging·멱등 적재 절차
4. [Feature 3 매장 정규화·적격 판정 상세 계획](../superpowers/plans/2026-07-26-store-normalization-eligibility.md): 정규화 table, 중복 근거, 1·2·5·6 경계와 멱등 app catalog 게시
5. [기술 스택 기준](technology-stack.md): 현재 SQLite·Drizzle dependency와 대체된 이력
6. [폴더 구조](directory-structure.md): target tree와 구현된 foundation·source ingestion·catalog publish path
7. [로컬 개발 환경](local-development.md): install·migration·fixture 적재·Feature 3 고정 fixture·수동 live smoke·검증 command
8. [개발 준비 체크리스트](development-readiness-checklist.md): Feature 1~10의 external 준비 시점

## 동기화 기록

- [로컬 MVP 책임 문서 동기화 설계](../superpowers/specs/2026-07-24-local-mvp-document-sync-design.md)
- [로컬 MVP 책임 문서 동기화 실행 계획](../superpowers/plans/2026-07-24-local-mvp-document-sync.md)

## 과거 이력

- [이전 온라인 P0 마스터 구현 계획](../superpowers/plans/2026-07-23-p0-master-implementation.md): PostgreSQL·배포·챗봇을 포함한 19개 Feature 이력
- [이전 P0 구현 로드맵 설계](../superpowers/specs/2026-07-23-p0-implementation-roadmap-design.md)
- [Workspace·Docker·테스트 기반 계획](../superpowers/plans/2026-07-23-workspace-foundation.md)

위 문서는 결정 배경과 Git 이력 확인용이며 현재 Feature 순서를 소유하지 않는다.

## 현재 상태

- **구현 완료 foundation:** `app.sqlite`·`raw.sqlite`, 독립 Drizzle migration, app-only backup, web/raw 자동 경계
- **구현 완료 Feature 2:** LOCALDATA fixture 계약·pagination, source snapshot/staging 분리, page checkpoint, 멱등 서울 후보 적재
- **구현 완료 Feature 3:** 주소·전화·상호·EPSG:5174 좌표 정규화, 4-signal 중복 근거, 독립점·2–5개 직영 브랜드 적격 판정, `admin_review` 격리와 app catalog 멱등 게시
- **후속 로컬 MVP:** 리뷰, FTS5, 결정론적 추천, 인증·지도·UI·E2E
- **현재 범위 밖:** 자연어·멀티턴·OpenAI, remote deployment와 5인 pilot

`db:migrate`, `db:backup:app`, `ingest:catalog:fixture`와 `test:catalog:feature3`는 현재 root script다. 자동 검증은 Docker나 외부 API key 없이 실행하며, key가 필요한 `smoke:catalog:live`와 실제 FTC·운영 주체 검증은 operator가 명시적으로만 실행한다. 자세한 순서는 [로컬 개발 환경](local-development.md)을 따른다.

## 실행 원칙

- Epic → Feature → Task 경계를 지키고 독립 Feature는 새 Codex 작업을 권장한다.
- 새 Codex 작업은 사용자가 요청할 때만 만든다.
- Feature 시작 시 실제 code·manifest·tree와 직전 interface를 확인한다.
- 구현과 직접 검증은 같은 Feature에서 완료한다.
- target 문서보다 실제 code가 뒤처진 전환 상태를 숨기지 않는다.
- API key·secret·raw content·exact location을 대화·문서·Git에 넣지 않는다.
- 검증 결과와 남은 risk를 확인한 뒤 다음 Feature로 진행한다.
