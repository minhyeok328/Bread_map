# 구현·릴리스 안내

[문서 허브](../README.md) · [로컬 개발 환경](local-development.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서군은 승인된 로컬 SQLite MVP와 실제 PostgreSQL·Prisma scaffold 사이의 전환을 설명한다. Feature 1이 code·manifest·migration을 바꾸면 실제 명령과 tree를 다시 확인하고 전환 상태를 구현 완료로 갱신해야 한다.

## 현재 실행 경로

1. [로컬 우선 SQLite MVP 마스터 구현 계획](../superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md): 현재 10개 Feature 순서와 공통 gate
2. [Feature 1 SQLite 저장소 기반 상세 계획](../superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md): 첫 Feature의 file·test·commit 절차
3. [기술 스택 기준](technology-stack.md): 승인 target과 전환 전 dependency
4. [폴더 구조](directory-structure.md): target tree와 실제 path
5. [로컬 개발 환경](local-development.md): 현재 가능한 command와 Feature 1 뒤 갱신 절차
6. [개발 준비 체크리스트](development-readiness-checklist.md): Feature 1~10의 external 준비 시점

## 동기화 기록

- [로컬 MVP 책임 문서 동기화 설계](../superpowers/specs/2026-07-24-local-mvp-document-sync-design.md)
- [로컬 MVP 책임 문서 동기화 실행 계획](../superpowers/plans/2026-07-24-local-mvp-document-sync.md)

## 과거 이력

- [이전 온라인 P0 마스터 구현 계획](../superpowers/plans/2026-07-23-p0-master-implementation.md): PostgreSQL·배포·챗봇을 포함한 19개 Feature 이력
- [이전 P0 구현 로드맵 설계](../superpowers/specs/2026-07-23-p0-implementation-roadmap-design.md)
- [Workspace·Docker·테스트 기반 계획](../superpowers/plans/2026-07-23-workspace-foundation.md)

위 문서는 결정 배경과 Git 이력 확인용이며 현재 Feature 순서를 소유하지 않는다.

## 상태 구분

- **승인된 로컬 MVP 목표:** SQLite·Drizzle·FTS5, `127.0.0.1`, 구조화 검색, OpenAI `$0`
- **Feature 1 전환 전 실제 scaffold:** PostgreSQL·Prisma·Docker Compose와 관련 dependency·script
- **후속 Feature:** 자연어·멀티턴·OpenAI·remote deployment·5인 pilot

`db:migrate`, `db:backup:app`, `app.sqlite` 생성은 Feature 1이 구현·검증하기 전에는 현재 가능한 사실이 아니다.

## 실행 원칙

- Epic → Feature → Task 경계를 지키고 독립 Feature는 새 Codex 작업을 권장한다.
- 새 Codex 작업은 사용자가 요청할 때만 만든다.
- Feature 시작 시 실제 code·manifest·tree와 직전 interface를 확인한다.
- 구현과 직접 검증은 같은 Feature에서 완료한다.
- target 문서보다 실제 code가 뒤처진 전환 상태를 숨기지 않는다.
- API key·secret·raw content·exact location을 대화·문서·Git에 넣지 않는다.
- 검증 결과와 남은 risk를 확인한 뒤 다음 Feature로 진행한다.
