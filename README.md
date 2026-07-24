# 빵찾깅 (Bread Map)

빵찾깅은 지역·가게명·메뉴·카테고리와 오늘의 방문 조건으로 서울의 검수된 독립 베이커리를 찾고, 지도·목록·상세에서 실제 리뷰 근거를 비교하는 웹 애플리케이션입니다.

현재 단계는 사용자 PC의 `127.0.0.1`에서 실행하는 **로컬 우선 웹 MVP**입니다. 승인 목표 저장소는 SQLite·Drizzle 기반 `app.sqlite`와 worker 전용 `raw.sqlite`이며, 현재 PostgreSQL·Prisma scaffold에서 Feature 1을 통해 전환할 예정입니다. 추천 후보와 순서는 재현 가능한 규칙으로 결정하고 숫자 총점은 공개하지 않습니다.

빵빵이 채팅은 현재 입력할 수 없는 UI 셸이며 OpenAI를 호출하지 않고 비용 목표는 `$0`입니다. 자연어 멀티턴 챗봇, 생성형 설명과 원격 5인 파일럿은 후속 독립 Feature입니다.

## 주요 기능

- 지역·가게명·메뉴·카테고리 기반 구조화 검색과 FTS5 리뷰 검색
- 강한 제외 조건을 우선 적용하는 결정론적 추천
- 전체 후보 지도, 왼쪽 가게 목록과 매장 상세
- 실제 비식별 리뷰 근거와 리뷰 부족 대체 안내
- 일반 카카오 로그인과 계정별 즐겨찾기·검색/선택 기록
- 공공데이터 기반 매장 검수와 관리자 로컬 리뷰 수집
- SQLite checkpoint, app DB snapshot과 로컬 복구

## 문서

- [문서 허브](docs/README.md)
- [제품 요구사항 문서](docs/00-product/prd.md)
- [로컬 우선 SQLite 웹 MVP 설계](docs/superpowers/specs/2026-07-24-local-first-sqlite-web-design.md)
- [로컬 우선 SQLite MVP 마스터 구현 계획](docs/superpowers/plans/2026-07-24-local-first-sqlite-mvp-master.md)
- [Feature 1 SQLite 저장소 기반 상세 계획](docs/superpowers/plans/2026-07-24-local-sqlite-storage-foundation.md)
- [로컬 개발 환경](docs/10-delivery/local-development.md)
- [기술 스택 기준](docs/10-delivery/technology-stack.md)
- [폴더 구조](docs/10-delivery/directory-structure.md)
- [개발 준비 체크리스트](docs/10-delivery/development-readiness-checklist.md)
- [이전 온라인 P0 계획 이력](docs/superpowers/plans/2026-07-23-p0-master-implementation.md)
- [기존 서비스 기획서 이전 안내](docs/service-plan.md)

> 빵찾깅은 빵집 추천 서비스입니다. 재료·알레르기·교차접촉 정보는 검증하지 않으며 안전을 보장하지 않습니다. 주문하거나 방문하기 전에 매장에 직접 확인해 주세요.
