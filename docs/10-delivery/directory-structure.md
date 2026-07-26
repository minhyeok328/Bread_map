# 폴더 구조

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 로컬 SQLite MVP의 목표 tree, Feature 1 foundation, Feature 2 source ingestion, Feature 3 store catalog, Feature 4 Kakao 장소·암호화 리뷰 path와 package 소유권·import 경계를 정의한다.

## 1. 로컬 MVP 구조

```text
Bread_map/
├── apps/
│   ├── web/                         # Next.js UI·server route
│   └── worker/                      # source·review·publish
├── packages/
│   ├── contracts/                   # input/output schema·shared type
│   ├── sqlite-core/                 # connection·pragma·transaction·backup
│   ├── app-db/                      # app repository, app schema export
│   ├── raw-db/                      # worker-only raw repository
│   ├── retrieval/                   # FTS5 query·snippet
│   ├── recommendation/              # deterministic filter·sort
│   └── testkit/                     # fixture·test helper
├── drizzle/
│   ├── app/                         # app.sqlite generated migration
│   └── raw/                         # raw.sqlite generated migration
├── var/
│   ├── app.sqlite                   # runtime file, Git-ignore
│   └── raw.sqlite                   # worker-only runtime file, Git-ignore
├── backups/                         # verified app snapshot, Git-ignore
├── scripts/                         # repository·operation helper
├── docs/
├── .github/workflows/
├── AGENTS.md
├── package.json
└── pnpm-workspace.yaml
```

`var/`, SQLite `-wal`·`-shm`과 `backups/`는 runtime data이며 Git에 포함하지 않는다. production에서는 source tree 밖 local user data directory를 실제 path로 사용할 수 있다.

## 2. package 경계

| 소비자 | 허용 | 금지 |
|---|---|---|
| `apps/web` | `contracts`, `app-db`, `retrieval`, `recommendation` | `raw-db`, Kakao locator·review collector, decrypt·HMAC key |
| `apps/worker` | `contracts`, `sqlite-core`, `app-db`, `raw-db`, `retrieval` | user session cookie 처리 |
| `packages/contracts` | Zod·pure TypeScript | DB driver, Next runtime |
| `packages/sqlite-core` | driver·pragma·transaction·backup primitive | domain business rule |
| `packages/app-db` | app repository·schema | raw schema·secret |
| `packages/raw-db` | raw repository·crypto metadata | web import |
| `packages/retrieval` | app repository contract·FTS5 | raw body·raw path |
| `packages/recommendation` | contracts·pure candidate data | UI·direct DB connection |
| `packages/testkit` | test-only fixture | production runtime import |

web의 raw package import와 `RAW_SQLITE_PATH`·`KAKAO_REST_API_KEY`·review secret·locator·collector 참조는 static boundary test가 차단한다.

## 3. Feature 1 구현 tree

현재 저장소의 storage foundation은 다음 path가 소유한다.

```text
packages/sqlite-core/              # local path·PRAGMA·online backup
packages/app-db/                   # app schema·typed handle·migrator
packages/raw-db/                   # worker-only raw schema·typed handle·migrator
drizzle/app.config.ts
drizzle/app/                       # app migration·snapshot·journal
drizzle/raw.config.ts
drizzle/raw/                       # raw migration·snapshot·journal
scripts/migrate-databases.ts
scripts/backup-app-database.ts
scripts/check-workspace-boundaries.ts
var/                               # runtime only, Git-ignore
backups/                           # app snapshot only, Git-ignore
infra/docker/README.md             # 후속 배포 비목표 안내
```

PostgreSQL·Prisma schema와 `infra/compose.yaml`은 SQLite replacement gate 통과 뒤 제거됐다. `packages/retrieval/`과 실제 domain schema는 각각 후속 Feature가 추가하며 storage foundation이 미리 소유하지 않는다.

## 4. 추가 원칙

- Feature code는 소유 package에 둔다. worker logic을 web에 복제하지 않는다.
- service 간 data는 `packages/contracts` validator를 거친다.
- generated Drizzle migration·snapshot은 schema source와 함께 Git에 포함한다.
- operation script는 hidden business rule을 소유하지 않는다.
- SQLite absolute path를 source·error·browser response에 hard-code하지 않는다.
- 후속 production Dockerfile·remote deployment path는 현재 목표 tree에 미리 만들지 않는다.

## 5. Feature 2 구현 tree

```text
packages/contracts/src/catalog.ts              # LOCALDATA row·page·summary 계약
packages/app-db/src/schema/catalog.ts           # source·snapshot·staging·run schema
drizzle/app/0001_catalog_ingestion.sql           # app.sqlite 전용 generated migration
apps/worker/src/catalog/localdata-client.ts      # 주입식 page client
apps/worker/src/catalog/normalize-source-row.ts  # 표현 변환·서울 staging filter
apps/worker/src/catalog/run-ingestion.ts         # checksum·page transaction·checkpoint
apps/worker/src/catalog/__fixtures__/            # CI용 고정 공개 source fixture
apps/worker/src/commands/ingest-catalog.ts       # fixture와 명시적 live mode
```

원본 allowlist row는 `source_snapshot_row`, 정규화 전 typed 후보는 `localdata_bakery_record`에 분리한다. 이 tree는 WGS84 변환, 중복 매장 병합, franchise와 eligibility 판정을 소유하지 않는다.

## 6. Feature 3 구현 tree

```text
packages/contracts/src/store.ts                    # store·match·eligibility·publish 공유 계약
packages/app-db/src/schema/stores.ts               # app catalog·근거·검수·publish schema
packages/testkit/src/store-fixtures.ts             # 고정 정규화·중복·eligibility 정답표
drizzle/app/0002_store_catalog.sql                 # app.sqlite 전용 generated migration
apps/worker/src/catalog/normalize-store.ts          # 주소·전화·상호·EPSG:5174 좌표 정규화
apps/worker/src/catalog/deduplicate-stores.ts       # 4-signal match와 보수적 병합
apps/worker/src/catalog/classify-eligibility.ts     # 독립점·2–5·6·FTC·관리자 판정
apps/worker/src/catalog/publish-catalog.ts          # staging→app catalog 멱등 게시
```

Feature 3은 review 수집·raw 암호화, 비식별·FTS5와 검색·추천을 소유하지 않는다. `admin_review` store와 근거는 app DB에 남지만 `catalog_status='published'` 후보에는 포함되지 않는다.

## 7. Feature 4 구현 tree

```text
packages/contracts/src/review.ts                         # 비민감 discovery·review 상태/요약 계약
packages/raw-db/src/schema/kakao-discovery.ts            # run·allowlist observation·temporary locator
packages/raw-db/src/schema/review-runs.ts                # batch·checkpoint·failure·delete audit
packages/raw-db/src/schema/raw-reviews.ts                # AES-GCM ciphertext·store-scoped fingerprint
drizzle/raw/0001_review_collection.sql                   # raw.sqlite Feature 4 migration
apps/worker/src/reviews/kakao-place-client.ts             # Kakao 공식 keyword search API adapter
apps/worker/src/reviews/run-kakao-discovery.ts            # 서울 tile coverage·후보 관측·catalog match
apps/worker/src/reviews/deidentify-review.ts              # fail-closed 최소 비식별
apps/worker/src/reviews/fingerprint-review.ts             # nickname 일시 HMAC 후 폐기
apps/worker/src/reviews/encrypt-raw-review.ts             # AES-256-GCM row encryption
apps/worker/src/reviews/browser-session.ts                # local Playwright active page 1개
apps/worker/src/reviews/review-dom-contract.ts             # versioned sanitized selector loader
apps/worker/src/reviews/extract-review-page.ts             # sanitized DOM contract parser
apps/worker/src/reviews/collect-store-reviews.ts          # 12개월·20개 매장 pipeline
apps/worker/src/reviews/run-review-batch.ts               # 순차 batch·resume·provider stop
apps/worker/src/reviews/purge-expired-review-data.ts       # 30/400일 raw hard delete·audit
apps/worker/src/commands/discover-kakao-bakeries.ts       # fixture/live discovery command
apps/worker/src/commands/collect-reviews.ts               # fixture/live review command
scripts/check-workspace-boundaries.ts                     # web raw·secret·locator·collector 차단
```

Feature 4는 franchise를 포함한 `제과,베이커리` 후보를 관측하지만, review 수집 대상은 Feature 3 `catalog_status='published'` 매장으로 제한한다. Feature 5는 decrypt 가능한 비식별 payload를 입력받아 `app.sqlite` publish와 FTS5만 소유한다.
