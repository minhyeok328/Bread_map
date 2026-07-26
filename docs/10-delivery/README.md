# 구현·릴리스 안내

[문서 허브](../README.md) · [로컬 개발 환경](local-development.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서군은 구현된 로컬 SQLite foundation과 후속 로컬 MVP Feature의 실행·검증 경계를 설명한다. PostgreSQL·Prisma scaffold는 Feature 1 replacement gate 통과 뒤 제거됐다.

## 현재 실행 경로

1. [로컬 우선 SQLite MVP 마스터 구현 계획](../superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md): 현재 10개 Feature 순서와 공통 gate
2. [Feature 1 SQLite 저장소 기반 상세 계획](../superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md): 첫 Feature의 file·test·commit 절차
3. [기술 스택 기준](technology-stack.md): 현재 SQLite·Drizzle dependency와 대체된 이력
4. [폴더 구조](directory-structure.md): target tree와 구현된 foundation path
5. [로컬 개발 환경](local-development.md): install·migration·dev·app backup·검증 command
6. [개발 준비 체크리스트](development-readiness-checklist.md): Feature 1~10의 external 준비 시점

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
- **후속 로컬 MVP:** 서울 source 수집, 정규화·리뷰, FTS5, 결정론적 추천, 인증·지도·UI·E2E
- **현재 범위 밖:** 자연어·멀티턴·OpenAI, remote deployment와 5인 pilot

`db:migrate`와 `db:backup:app`은 현재 root script다. Docker나 외부 API key 없이 실행하며 자세한 순서는 [로컬 개발 환경](local-development.md)을 따른다.

## 실행 원칙

- Epic → Feature → Task 경계를 지키고 독립 Feature는 새 Codex 작업을 권장한다.
- 새 Codex 작업은 사용자가 요청할 때만 만든다.
- Feature 시작 시 실제 code·manifest·tree와 직전 interface를 확인한다.
- 구현과 직접 검증은 같은 Feature에서 완료한다.
- target 문서보다 실제 code가 뒤처진 전환 상태를 숨기지 않는다.
- API key·secret·raw content·exact location을 대화·문서·Git에 넣지 않는다.
- 검증 결과와 남은 risk를 확인한 뒤 다음 Feature로 진행한다.
