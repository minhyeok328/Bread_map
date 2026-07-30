# 폴더 구조

[구현·릴리스 안내](README.md) · [기술 스택 기준](technology-stack.md) · [시스템 구조](../04-architecture/system-architecture.md)

이 문서는 로컬 SQLite MVP의 목표 tree, Feature 1 foundation,
Feature 2 source ingestion, Feature 3 store catalog, Feature 4
Kakao 장소·암호화 리뷰, Feature 5 공개 리뷰·FTS5 retrieval,
Feature 6 검수 근거·결정론적 검색, Feature 7 인증·사용자 데이터,
Feature 8 매장·지도 서버 API path와 package 소유권·import 경계를
정의한다.

## 1. 로컬 MVP 구조

```text
Bread_map/
├── apps/
│   ├── web/                         # Next.js UI·server route
│   └── worker/                      # source·review·catalog/evidence publish
├── packages/
│   ├── contracts/                   # input/output schema·shared type
│   ├── sqlite-core/                 # connection·pragma·transaction·backup
│   ├── app-db/                      # app repository, app schema export
│   ├── raw-db/                      # worker-only raw repository
│   ├── retrieval/                   # FTS5·versioned search snapshot·service
│   ├── recommendation/              # pure deterministic filter·sort·explain
│   └── testkit/                     # fixture·search scenario·test helper
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
| `apps/web` | `contracts`, `app-db`, `retrieval`, `recommendation` | `raw-db`, Kakao locator·review collector·publisher, decrypt·HMAC key |
| `apps/worker` | `contracts`, `sqlite-core`, `app-db`, `raw-db`, `retrieval`, `recommendation` | user session cookie 처리 |
| `packages/contracts` | Zod·pure TypeScript | DB driver, Next runtime |
| `packages/sqlite-core` | driver·pragma·transaction·backup primitive | domain business rule |
| `packages/app-db` | app repository·schema | raw schema·secret |
| `packages/raw-db` | raw repository·crypto metadata | web import |
| `packages/retrieval` | app repository contract·FTS5 | raw body·raw path |
| `packages/recommendation` | contracts·pure candidate data | UI·direct DB connection |
| `packages/testkit` | test-only fixture | production runtime import |

web의 raw package import와 `RAW_SQLITE_PATH`·`KAKAO_REST_API_KEY`·review
secret·locator·collector·publisher 참조는 static boundary test가
차단한다. local MVP 금지 dependency 검사는 retrieval을 포함한 모든
workspace manifest에 적용한다. web의 `@bread-map/retrieval` import는
`executeSqliteStoreSearch`, `resolveCurrentSqliteSearchDataVersion`,
`StoreSearchError` named facade만 허용하고 deep·dynamic·namespace
import를 거부한다.

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

PostgreSQL·Prisma schema와 `infra/compose.yaml`은 SQLite replacement
gate 통과 뒤 제거됐다. Feature 5가 `packages/retrieval/`과 공개
review domain schema를 추가했으며 storage foundation은 이 규칙을
소유하지 않는다.

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
packages/raw-db/src/schema/review-sync.ts                # 400일 seen ledger·store sync anchor
drizzle/raw/0001_review_collection.sql                   # raw.sqlite Feature 4 migration
drizzle/raw/0002_review_year_sync.sql                    # 전량 backfill·incremental migration
apps/worker/src/reviews/kakao-place-client.ts             # Kakao 공식 keyword search API adapter
apps/worker/src/reviews/run-kakao-discovery.ts            # 서울 tile coverage·후보 관측·catalog match
apps/worker/src/reviews/deidentify-review.ts              # fail-closed 최소 비식별
apps/worker/src/reviews/fingerprint-review.ts             # nickname 일시 HMAC 후 폐기
apps/worker/src/reviews/encrypt-raw-review.ts             # AES-256-GCM row encryption
apps/worker/src/reviews/browser-session.ts                # local Playwright active page 1개
apps/worker/src/reviews/review-dom-contract.ts             # versioned sanitized selector loader
apps/worker/src/reviews/extract-review-page.ts             # sanitized DOM contract parser
apps/worker/src/reviews/review-sync-state.ts              # dedupe ledger·성공 anchor 저장
apps/worker/src/reviews/collect-store-reviews.ts          # 12개월 전량·증분 매장 pipeline
apps/worker/src/reviews/run-review-batch.ts               # 순차 batch·budget resume·provider stop
apps/worker/src/reviews/purge-expired-review-data.ts       # 30/400일 raw hard delete·audit
apps/worker/src/commands/discover-kakao-bakeries.ts       # fixture/live discovery command
apps/worker/src/commands/collect-reviews.ts               # fixture/live review command
scripts/check-workspace-boundaries.ts                     # web raw·secret·locator·collector 차단
```

Feature 4는 franchise를 포함한 `제과,베이커리` 후보를 관측하지만, review 수집 대상은 Feature 3 `catalog_status='published'` 매장으로 제한한다. Feature 5는 decrypt 가능한 비식별 payload를 입력받아 `app.sqlite` publish와 FTS5만 소유한다.

## 8. Feature 5 구현 tree

```text
packages/app-db/src/schema/reviews.ts                    # 공개 문서·publish/index version
packages/app-db/src/schema/review-search.ts              # publish·FTS contract version
drizzle/app/0003_review_publish_fts.sql                  # review table·FTS5·동기화 trigger
packages/retrieval/src/review-repository.ts              # Feature 6 소비 계약
packages/retrieval/src/normalize-review-search.ts        # Unicode 정규화·안전한 FTS query
packages/retrieval/src/sqlite-review-repository.ts       # app-only SQLite adapter·fallback
apps/worker/src/reviews/publish-review.ts                # worker-only decrypt·transactional publish
scripts/check-workspace-boundaries.ts                    # web publisher/raw·금지 dependency 차단
```

publisher는 `raw.sqlite`에서 terminal `SUCCEEDED`·`PARTIAL` run을
읽고 모든 검증과 복호화를 app transaction 전에 끝낸다. 공개 corpus는
nickname·fingerprint·ciphertext·nonce·tag·key version·locator를
저장하지 않는다. `packages/retrieval`은 `app-db`만 의존하며
`raw-db`나 복호화 코드를 import하지 않는다.

## 9. Feature 6 구현 tree

```text
packages/contracts/src/search.ts                         # strict input/result·version·safe error 계약
packages/app-db/src/schema/search-evidence.ts            # active catalog pointer·검수 근거 publish/schema
drizzle/app/0004_search_evidence.sql                     # Feature 6 app migration·기존 catalog pointer backfill
apps/worker/src/catalog/publish-catalog.ts               # stale guard·active pointer·후보 demotion
apps/worker/src/search-evidence/publish-search-evidence.ts # MANUAL_VERIFIED batch 검증·atomic active swap
apps/worker/src/commands/publish-search-evidence.ts      # 명시적 로컬 JSON importer
packages/recommendation/src/search-types.ts              # repository→pure engine fact 경계
packages/recommendation/src/normalize-query.ts           # 정규화·승인 synonym
packages/recommendation/src/derive-candidate.ts          # 영업·거리·review 상태·보정값
packages/recommendation/src/filter-candidates.ts         # hard filter·reason count
packages/recommendation/src/rank-candidates.ts           # 안정 비교 key·store_id tie-break
packages/recommendation/src/explain-result.ts            # 공개 item·warning·완화 옵션
packages/retrieval/src/store-search-repository.ts        # snapshot repository 계약·safe error
packages/retrieval/src/sqlite-store-search-repository.ts # active component·composite hash·candidate graph
packages/retrieval/src/execute-store-search.ts           # repository+pure engine orchestration·partial fallback
packages/retrieval/src/search-evaluation.ts              # 18+2 품질·결정성·p95 gate
packages/testkit/src/search-scenarios.ts                 # 30-store·50-menu·20 search-only fixture
package.json                                             # test:search:feature6 root gate
```

`catalog_publish_state(state_id='active')`는 catalog publish와 source
snapshot identity·basis date·download time을 함께 고정한다. retrieval은
pointer metadata가 source row와 일치하는지 확인하고, 정렬된 활성 공개
후보 facts를 canonical SHA-256으로 계산한다. 이 content hash와 활성
검수 근거·일관된 review/FTS component가 opaque
`search-data-v1_<sha256>`를 구성하므로 같은 ID 아래 후보 facts의
변경도 version mismatch로 감지된다.

검수 검색 근거는 worker-only JSON importer가 활성 catalog의
published·active store에 대해서만 게시한다. recommendation은 DB를
열지 않는 pure package이고 retrieval은 `app-db`만 읽으며,
`packages/testkit`의 고정 평가 fixture는 production runtime에
import하지 않는다.

## 10. Feature 7 구현 tree

```text
packages/contracts/src/user-data.ts                       # favorite·normalized history·탈퇴 strict 계약
packages/app-db/src/schema/auth.ts                        # 최소 user/account·hashed session registry
packages/app-db/src/schema/user-data.ts                   # ownership favorite·search/selection history
drizzle/app/0005_auth_user_data.sql                       # Feature 7 app migration
apps/web/src/auth-config.ts                               # Kakao 최소 profile/account mapper·절대 6시간 JWT callback
apps/web/src/auth.ts                                      # NextAuth production 초기화
apps/web/src/server/auth-adapter.ts                       # 공식 Drizzle adapter 최소 저장 wrapper
apps/web/src/server/session-registry.ts                   # SHA-256 session revocation
apps/web/src/server/authenticated-request.ts              # cookie decode·registry principal 검증
apps/web/src/server/user-repository.ts                    # user_id-scoped favorite·history·탈퇴 transaction
apps/web/src/server/kakao-unlink.ts                       # timeout이 있는 token-header-only unlink
apps/web/src/server/favorite-route.ts                     # testable favorite handler factory
apps/web/src/server/history-route.ts                      # testable normalized history handler factory
apps/web/src/server/account-route.ts                      # testable recent-auth withdrawal handler factory
apps/web/src/app/api/auth/[...nextauth]/route.ts           # exact 127.0.0.1 origin Auth.js delegate
apps/web/src/app/api/favorites/route.ts                   # authenticated favorite GET·POST·DELETE
apps/web/src/app/api/history/route.ts                     # normalized history GET·POST·DELETE
apps/web/src/app/api/account/route.ts                     # recent-auth local-first withdrawal
package.json                                              # test:auth:feature7 root gate
```

web route는 `raw.sqlite`를 열지 않으며 request body·query의 `user_id`를
소유권 근거로 사용하지 않는다. OAuth access token은 account table이
아니라 현재 Auth.js encrypted cookie 안에서만 갱신 없이 절대 6시간 유지되고
public session/API response에 노출되지 않는다.

## 11. Feature 8 구현 tree

```text
packages/contracts/src/api/store-search.ts                # Feature 6 query wrapper·map presentation state
packages/contracts/src/api/store-detail.ts                # snapshot 상세·review pagination·traceability
packages/retrieval/src/execute-store-search.ts             # safe current snapshot version facade
packages/testkit/src/sqlite-search-fixture.ts              # migrated API integration fixture
apps/web/src/server/search-service.ts                      # authenticated strict search·safe error mapping
apps/web/src/server/store-detail-service.ts                # snapshot-consistent public detail transaction
apps/web/src/app/api/stores/route.ts                       # POST /api/stores
apps/web/src/app/api/stores/[storeId]/route.ts             # GET /api/stores/{storeId}
scripts/check-workspace-boundaries.ts                      # safe retrieval facade allowlist
package.json                                               # test:map:feature8 root gate
```

검색 API의 `items` 하나가 지도와 목록의 완전한 후보 집합을 소유한다.
상세만 review page·limit을 적용하며 검색 candidate를 임의로 자르지
않는다. production web은 `packages/testkit`을 import하지 않고
runtime에서는 위 retrieval facade만 사용한다. Kakao Route,
`/api/routes`와 외부 REST 호출은 이 tree에 없다.
