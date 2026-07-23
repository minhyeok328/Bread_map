# 폴더 구조

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 P0 monorepo의 소유권과 import 경계를 정의한다. 빈 폴더 대신 유효한 package, schema 또는 안내 파일을 두어 Git에서 구조가 추적되게 한다.

## 1. 기준 구조

```text
Bread_map/
├── apps/
│   ├── web/                    # Next.js 사용자·관리자 UI와 server API
│   └── worker/                 # 적재·정규화·리뷰·LLM·집계 작업
├── packages/
│   ├── contracts/              # service 간 입력·출력 schema와 공용 type
│   ├── app-db/                 # app_db 전용 Prisma client
│   ├── raw-db/                 # raw_db 전용 Prisma client
│   ├── recommendation/         # 추천 계산과 설명 입력 조립
│   └── testkit/                # fixture builder와 공용 test helper
├── prisma/
│   ├── app/                    # app_db schema와 migration
│   └── raw/                    # raw_db schema와 migration
├── infra/
│   ├── compose.yaml            # 로컬 app-db·raw-db
│   └── docker/                 # production image 정의가 추가될 위치
├── scripts/                    # repository 검증과 운영 보조 명령
├── docs/                       # 제품·기술·구현 기준
├── .github/workflows/          # CI
├── AGENTS.md                   # 이 저장소의 Codex 운영 규칙
├── package.json
└── pnpm-workspace.yaml
```

## 2. 경계 규칙

| 소비자 | 허용 | 금지 |
|---|---|---|
| `apps/web` | `contracts`, `app-db`, `recommendation` | `raw-db`, 리뷰 복호화 key |
| `apps/worker` | `contracts`, `app-db`, `raw-db`, `recommendation` | 사용자 session cookie 처리 |
| `packages/contracts` | Zod와 순수 TypeScript | database client, Next.js runtime |
| `packages/recommendation` | `contracts`와 순수 계산 | UI, 직접 database 연결 |
| `packages/app-db` | app Prisma client와 PG adapter | raw schema/client |
| `packages/raw-db` | raw Prisma client와 PG adapter | web import |
| `packages/testkit` | test 전용 helper | production runtime 의존 |

`apps/web`의 `@bread-map/raw-db` import는 ESLint와 repository 경계 test가 모두 차단한다.

## 3. 추가 원칙

- Feature 구현은 해당 소유 package에 둔다. 편의를 위해 `apps/web`에 worker 코드를 복제하지 않는다.
- service 간 공유 데이터는 `packages/contracts`의 schema를 거친다.
- Prisma generated client는 각 database package 아래에 생성하고 Git에는 포함하지 않는다.
- 운영 script는 숨은 business rule을 소유하지 않는다. 규범 로직은 해당 package로 이동한다.
- production Dockerfile은 배포 Feature에서 `infra/docker`에 추가한다.
