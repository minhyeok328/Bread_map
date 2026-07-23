# 구현·릴리스 안내

[문서 허브](../README.md) · [로컬 개발 환경](local-development.md) · [기술 스택 기준](technology-stack.md) · [폴더 구조](directory-structure.md)

이 문서군은 승인된 제품·기술 기준을 실제 개발 순서와 사용자 준비사항으로 연결한다.

## 문서

- [기술 스택 기준](technology-stack.md): runtime, framework, database와 test 도구의 exact version
- [폴더 구조](directory-structure.md): monorepo package 소유권과 import 경계
- [로컬 개발 환경](local-development.md): 설치, 환경변수, 실행과 검증 명령
- [P0 마스터 구현 계획](../superpowers/plans/2026-07-23-p0-master-implementation.md): 19개 Feature의 순서, 의존성, 산출물, 검증과 승인 gate
- [개발 준비 체크리스트](development-readiness-checklist.md): 사용자가 외부 계정·도구·배포 환경에서 준비할 항목
- [P0 구현 로드맵 설계](../superpowers/specs/2026-07-23-p0-implementation-roadmap-design.md): 구현 순서와 주요 결정의 설계 근거

## 실행 원칙

- 새 Feature는 새 Codex 작업과 해당 `codex/...` 브랜치에서 시작한다.
- 사용자가 새 작업 생성을 요청하기 전에는 Codex가 자동으로 만들지 않는다.
- Feature 시작 시 현재 코드와 직전 인터페이스를 읽고 파일·함수·테스트 수준 상세 계획을 작성한다.
- 구현과 직접 검증은 같은 Feature 작업에서 끝낸다.
- 관련 검증 결과와 남은 위험을 사용자가 확인한 뒤 병합한다.
- 실제 API key와 비밀은 대화·문서·Git에 넣지 않는다.
