# 추천 및 로컬 MVP 평가 계획

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [추천 기준](recommendation-spec.md) · [운영 기준](../08-operations/operating-baselines.md)

이 문서는 현재 Feature 6 구조화 검색·추천의 고정 fixture 평가와 후속 cross-feature E2E 경계를 정의한다. 계산 규칙은 [추천 기준](recommendation-spec.md), 실행 가능한 시나리오와 gate는 `packages/testkit/src/search-scenarios.ts`와 `packages/retrieval/src/search-evaluation.ts`가 소유한다.

## 1. 현재 평가 범위

Feature 6 자동 평가는 search-only 범위다.

- strict `StructuredSearchInput`과 공개 결과 계약
- 활성 catalog·검수 검색 근거·공개 review/FTS로 구성한 versioned snapshot
- 지역·가게명·메뉴·카테고리·영업·거리·리뷰 상태 필터
- 하드 제외, 결정론적 정렬, 리뷰 부족과 FTS unavailable 대체
- 안전한 version mismatch·stale source 오류
- 고정 fixture 품질·결정성·in-process 성능

인증, 계정 소유권, 지도 SDK, 지도·목록·상세 동기화, web API와 UI는 Feature 6의 20개 시나리오에 넣지 않는다. 해당 항목은 [후속 cross-feature E2E](#7-후속-cross-feature-e2e)에서 검증한다.

## 2. 고정 fixture

`search-evaluation-v1` fixture는 다음 형태를 고정한다.

| 항목 | 값 |
|---|---:|
| store | 정확히 30개 |
| menu | 정확히 50개 |
| search-only scenario | 정확히 20개, ID 중복 0건 |
| Hit Rate@5 분모 | 성공 실행 시나리오 18개 |
| 안전 오류 | `version-mismatch`, `stale-source` 2개 |
| source basis date | `2026-07-30` |

매장·메뉴·alias·영업시간·review는 비민감 결정론적 fixture다. request time도 시나리오별로 고정하며 외부 API, browser, Docker, OpenAI와 live provider를 호출하지 않는다.

## 3. 정확한 20개 시나리오

아래 18개 성공 시나리오는 모두 Hit Rate@5 분모에 포함한다. 마지막 2개는 기대한 safe error 자체를 통과 조건으로 삼고 Hit Rate 분모에서는 제외한다.

| ID | 그룹 | 기대 핵심 | 절대 제외 또는 안전 결과 | Hit Rate 분모 |
|---|---|---|---|---|
| `region-district` | region | `store_01` | `store_11` 제외 | 포함 |
| `region-neighborhood-alias` | region | `store_01` | `store_02` 제외 | 포함 |
| `region-station-alias` | region | `store_01` | `store_02` 제외 | 포함 |
| `store-exact` | store | `store_01` | `store_02` 제외 | 포함 |
| `store-approved-alias` | store | `store_01` | `store_02` 제외 | 포함 |
| `menu-exact` | menu | `store_01`, rating guard | 고별점 `store_05`가 명시 메뉴 일치를 역전하지 않음 | 포함 |
| `menu-synonym` | menu | `store_01` | 승인 synonym 적용 | 포함 |
| `menu-review-fallback` | menu | FTS 근거의 `store_05` | `store_01` 제외 | 포함 |
| `category-include` | category | `store_01` | `store_02` 제외 | 포함 |
| `category-exclude` | category | `store_02` | `store_01` 제외 | 포함 |
| `open-now` | visit | `store_01` | 고정 KST 영업시간 적용 | 포함 |
| `overnight-open` | visit | `store_02` | 자정 이월 영업시간 적용 | 포함 |
| `distance-boundary` | visit | `store_01` | `store_02` 제외 | 포함 |
| `distance-sort` | visit | `store_01` | exact distance는 내부 정렬에만 사용 | 포함 |
| `reviews-available` | evidence | `store_01` | `store_02` 제외 | 포함 |
| `reviews-insufficient` | evidence | `store_02` | `store_01` 제외 | 포함 |
| `combined-hard-filters` | combined | `store_01` | `store_05` 제외, 성능 측정 대상 | 포함 |
| `fts-unavailable-fallback` | degradation | `store_01` | `store_05` 제외, truthful `PARTIAL` | 포함 |
| `version-mismatch` | expected error | 결과 없음 | `SEARCH_DATA_VERSION_MISMATCH` | 제외 |
| `stale-source` | expected error | 결과 없음 | `SEARCH_DATA_STALE` | 제외 |

각 시나리오는 입력, 고정 request time, 기대 상위 5개 후보 ID, 전체 결과에서 금지할 ID, 기대 status와 오류 code를 source fixture에 직접 고정한다.

## 4. 자동 gate

`runSearchEvaluation`은 다음 조건을 모두 만족할 때만 `passed=true`를 반환한다.

| Gate | 정확한 통과 기준 |
|---|---|
| fixture shape | scenario 20개·고유 ID 20개·Hit Rate 분모 18개·기대 오류 2개 |
| 성공 실행 | 18개 성공 시나리오가 모두 결과를 반환 |
| 안전 오류 | 기대 오류 2개가 각각 정확한 `StoreSearchError.code`로 실패 |
| Hit Rate@5 | `floor(hitCount * 10000 / 18) >= 8500` basis points |
| 필수 hit | `menu-review-fallback`·`fts-unavailable-fallback`이 각각 기대 상위 5개 후보를 반환하고 `requiredHitViolationCount === 0` |
| 하드 제외 | 모든 반환 item에서 `forbiddenStoreIds` 위반 0건 |
| status | 별도 `PARTIAL` 선언이 없는 모든 성공 시나리오는 `COMPLETE`, 기대 status 위반과 예상 밖 실행 오류 0건 |
| 결정성 | 성공 시나리오별 전체 result fingerprint가 총 100회 동일 |
| 별점 역전 | `ratingOnlyInversionCount === 0` |
| FTS fallback | truthful fallback 조건 전부 충족 |
| 성능 | `combined-hard-filters` 10회 warm-up 뒤 100회 측정, p95 `<1500ms` |

결정성 fingerprint는 `status`, `partialReason`, `items`, `metadata`, `filterSummary`, `relaxationOptions` 전체를 비교한다. 따라서 `store_id` 순서뿐 아니라 공개 근거·warning·filter count·version metadata의 차이도 실패다.

집계 Hit Rate가 특정 핵심 경로의 회귀를 가리지 않도록
`menu-review-fallback`과 `fts-unavailable-fallback`은 필수 hit로 별도
검사한다. report에는 입력이나 민감 근거 대신
`requiredHitViolationCount` 집계만 기록한다.

## 5. truthful FTS fallback

`fts-unavailable-fallback`은 단순히 예외가 없으면 통과하는 시나리오가 아니다. 다음을 모두 만족해야 한다.

- `status === 'PARTIAL'`
- `partialReason === 'FTS_UNAVAILABLE'`
- `metadata.ftsIndexVersion === null`
- 모든 item의 `review.snippet === null`
- 모든 item이 `REVIEW_EVIDENCE` reason을 포함하지 않음
- 모든 item이 `FTS_UNAVAILABLE` warning을 포함
- 검수 메뉴·카테고리·지역·영업·거리 하드 필터와 금지 후보 제외는 계속 적용

가짜 review snippet, FTS score, review 근거 reason을 만들지 않는다.

## 6. 개인정보·공개 계약 검사

- 요청 origin은 검증된 process memory에서만 exact distance 계산에 사용한다.
- 공개 결과는 exact distance 대신 250m 단위 상한 `distanceUpperBoundM`만 반환한다.
- request origin, exact distance, FTS rank, completeness, adjusted rating과 numeric total score는 공개 결과 schema가 거부한다.
- `dataSnapshotVersion`은 활성 catalog/source identity·metadata, canonical 공개 후보 facts hash, 검수 근거와 일관된 review/FTS component를 묶은 `search-data-v1_<64 lowercase hex>` 형식의 opaque composite hash이며 소비자는 내부를 해석하지 않고 전체 값을 비교한다.
- 평가 report는 fixture ID와 집계값만 담고 scenario input, request origin, review body·snippet, rank와 rating을 직렬화하지 않는다.

## 7. 후속 cross-feature E2E

다음은 Feature 6 gate와 분리해 관련 Feature가 구현된 뒤 검증한다.

| 후속 범위 | 검증 |
|---|---|
| Feature 7 계정 | Kakao Login, 즐겨찾기·검색/선택 기록의 계정별 격리와 삭제 |
| Feature 8 API·지도 | 지도 marker·목록·상세의 동일 `store_id` 집합, 지도 실패 시 목록·주소 유지 |
| Feature 9 UI | 검색·필터·상세, 리뷰 부족·partial 상태, 비활성 채팅과 network 0건 |
| Feature 10 release | restore 뒤 대표 검색, 정확 위치·비밀·raw 노출 0건, 전체 로컬 E2E |

지도 실패나 계정 격리를 현재 20개 search-only fixture에 성공으로 섞지 않는다.

## 8. fixture와 live 품질 경계

현재 gate는 고정 기대값에 대한 구현 회귀를 검증한다. 즉 다음을 증명한다.

- 같은 code·fixture·version에서 필터와 순서가 결정론적이다.
- fixture의 기대 후보와 금지 후보에 대해 자동 지표가 통과한다.
- 안전 오류와 FTS fallback이 계약대로 동작한다.

다음은 증명하지 않는다.

- 실제 서울 전체 source의 메뉴·alias·영업시간 완성도
- Kakao live review 수집 성공이나 현재 provider 품질
- 독립 평가자가 판정한 실제 추천 품질
- 실제 사용자 장비·web·지도까지 포함한 end-to-end latency

live source와 독립-human 품질을 검증할 때는 현재 fixture 기대값을 덮어쓰지 않고 별도 versioned 평가 세트와 cross-feature E2E 결과를 만든다.

## 9. 실행과 추적

Feature 6 자동 gate:

```powershell
corepack pnpm test:search:feature6
```

주요 추적 경로:

- 계약: `packages/contracts/src/search.ts`
- 후보 snapshot·version·freshness: `packages/retrieval/src/sqlite-store-search-repository.ts`
- 검색 orchestration·fallback: `packages/retrieval/src/execute-store-search.ts`
- 순수 필터·정렬·공개 설명: `packages/recommendation/src/`
- fixture: `packages/testkit/src/search-scenarios.ts`
- evaluator와 gate: `packages/retrieval/src/search-evaluation.ts`

## 10. 현재 Feature 6 판정

Feature 6은 다음을 모두 통과해야 완료다.

- 20개 fixture shape와 18+2 분모 경계
- Hit Rate@5 `>=8500bp`
- 하드 제외 0건
- 전체 결과 fingerprint 100회 결정성
- 별점 단독 역전 0건
- truthful FTS fallback
- 10회 warm-up + 100회 측정 p95 `<1500ms`
- strict 공개 계약과 안전 오류

실패 결과를 숨기지 않고 scenario ID, 집계 gate와 재현 명령을 기록한다. live 품질과 후속 지도·계정 E2E를 이 자동 gate의 완료 주장에 포함하지 않는다.

## 관련 문서

- 목표와 요구사항: [PRD](../00-product/prd.md)
- 계산 기준: [추천 기준](recommendation-spec.md)
- 화면 상태: [화면 상태와 카피](../01-experience/ux-states-and-copy.md)
- 운영 임계값: [운영 기준](../08-operations/operating-baselines.md)
