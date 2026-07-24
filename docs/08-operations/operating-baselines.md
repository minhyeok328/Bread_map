# 로컬 MVP 운영 기준

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [평가 계획](../02-recommendation/evaluation-plan.md) · [보안 설계](../06-trust/security-design.md)

이 문서는 owner가 자신의 PC에서 `127.0.0.1` 로컬 MVP를 운영할 때의 실행·비용·최신성·snapshot·관측과 장애 대응 기준을 정의한다.

## 1. 현재 운영 범위

- 사용자: owner 본인
- 지역: 서울특별시
- web: local `127.0.0.1`
- data file: `app.sqlite`, worker 전용 `raw.sqlite`
- hosting: 없음
- remote database: 없음
- OpenAI: 호출 없음, 비용 `$0`
- source·review run: operator가 명시적으로 수동 실행
- cron·상시 daemon·public deployment: 없음
- 운영 capacity: 주당 최소 5시간을 확보하되 release gate가 아닌 계획 상한으로 사용

## 2. 우선순위와 시간

| 업무 | 권장 주간 상한 |
|---|---:|
| security·delete·raw retention 확인 | 1시간 |
| source·eligibility·quality 확인 | 1.5시간 |
| search·recommendation 평가 | 1시간 |
| snapshot·restore·log 점검 | 0.5시간 |
| 개선·문서·결정 기록 | 1시간 |

보안 사고, 삭제 실패, raw retention 초과와 source 30일 초과는 기능 개선보다 우선한다. review 실험이 capacity를 반복 초과하면 실험을 멈춘다.

## 3. 서비스 기준

| 항목 | 목표·임계값 |
|---|---:|
| input 후 진행 표시 | 100ms 이내 |
| 외부 호출 제외 검색·filter·sort p95 | 1.5초 이하 |
| LLM 없는 검색 응답 p95 | 2초 이하 |
| 위치 획득 대기 | 5초 후 지역 직접 입력 |
| source freshness 경고 | 마지막 성공 7일 초과 |
| 새 검색 차단 | 마지막 성공 30일 초과 |
| 100회 순서 결정성 | 100% |
| 강한 제외 위반 | 0 |
| OpenAI cost | `$0` |

부분 실패에서는 사용할 수 있는 menu·category·목록·주소·detail을 유지한다. 최신 영업 상태를 확인할 수 없으면 오래된 값을 현재 사실로 새 검색에 사용하지 않는다.

## 4. 로컬 실행

- web은 loopback에만 bind한다.
- 외부 network interface와 public tunnel을 기본 사용하지 않는다.
- browser·worker가 사용하는 SQLite absolute path를 UI·log에 표시하지 않는다.
- user data directory, snapshot directory와 secret permission을 시작 전에 확인한다.
- user service와 review experiment의 Playwright config·command·fixture를 분리한다.
- 종료 전 active transaction과 worker run 상태를 확인한다.

실제 install·검증 command는 [로컬 개발 환경](../10-delivery/local-development.md)이 소유한다. Feature 1 전에는 존재하지 않는 SQLite command를 실행 가능한 것으로 가정하지 않는다.

## 5. external integration smoke

외부 key가 필요한 smoke는 관련 Feature에 도달했을 때만 수행한다.

| Feature | smoke |
|---|---|
| Feature 2 | public source access와 snapshot checksum |
| Feature 4 | local browser review experiment, policy gate와 one-page limit |
| Feature 7 | Kakao Login local callback·최소 동의·unlink |
| Feature 8 | Kakao Map key·marker·failure fallback |
| Feature 10 | operator가 허용한 live smoke 전체 |

Feature 1의 SQLite foundation에는 Kakao·public source·OpenAI key가 필요하지 않다.

## 6. 비용

### 현재

| 항목 | 목표 |
|---|---:|
| hosting | 없음 |
| remote database | 없음 |
| OpenAI | `$0` |
| Kakao paid overage | 자동 승인 없음 |
| public source | provider 정책·quota 안에서 수동 검증 |

월 30,000원 gate는 원격 5인 pilot의 과거 기준이며 현재 local release에 적용하지 않는다. 유료 API·상위 plan·초과 quota로 자동 전환하지 않는다.

### 비용 이상

- 예상하지 않은 OpenAI request가 1건이라도 있으면 release blocker다.
- provider dashboard에 유료 전환·overage가 보이면 관련 integration을 중지한다.
- live key smoke는 최소 요청으로 제한하고 결과·secret를 log에 남기지 않는다.

## 7. source 운영

- scheduler 없이 operator가 수동 실행한다.
- run 전에 app snapshot과 source contract를 확인한다.
- failed snapshot으로 이전 성공 publish를 교체하지 않는다.
- 성공 시 basis date, download time, checksum, row count와 quality result를 기록한다.
- 마지막 성공 7일 초과는 user warning, 30일 초과는 새 search 차단이다.
- FTC 보조 data 실패는 uncertain candidate를 manual review로 보낸다.

권장 확인 cadence:

- LOCALDATA: 개발 중 필요 시, release 전 freshness 확인
- FTC: eligibility 변경 또는 release 전 확인
- manual review queue: source run 뒤 확인

자동 daily/weekly cron은 현재 운영 범위가 아니다.

## 8. review 실험 운영

- Kakao Map one source
- 최근 12개월·store당 최대 20개
- 서울 적격 store snapshot
- active run 1개·browser page 1개
- local SQLite checkpoint 기반 pause·resume·stop
- failed store 격리와 operator 선택 재실행
- login·CAPTCHA·401·403·429·access denial·DOM change 전체 stop
- raw 30일 hard delete, long-term raw snapshot 없음
- app review·FTS5 일치와 duplicate 0

run 시작 전에 policy snapshot, kill switch, retention, key와 app snapshot을 확인한다. 정책·access stop은 자동 retry하지 않는다.

다음은 즉시 global kill switch를 활성화한다.

- nickname·PII·raw 평문 노출 1건
- raw retention 초과 1건
- AES auth failure 1건
- duplicate publish 1건
- app review·FTS active document 불일치 1건

## 9. SQLite snapshot과 restore

### snapshot

- 큰 source/review publish와 migration 전에 SQLite app snapshot을 만든다.
- SQLite backup API로 일관된 `app.sqlite` snapshot을 만든다.
- 최근 몇 개의 검증된 snapshot만 보존한다.
- `raw.sqlite`, `-wal`, `-shm`, secret와 log를 snapshot bundle에 넣지 않는다.
- snapshot 실패 시 큰 작업을 시작하지 않는다.

### restore rehearsal

1. active file을 덮지 않고 새 file로 restore
2. `PRAGMA integrity_check`
3. foreign key와 migration history
4. table·row·FTS document count와 checksum
5. 필요한 forward migration
6. 대표 구조화 search와 100회 결정성
7. delete tombstone·retention replay
8. checkpoint resume와 duplicate 0

검증 전 restore file을 active path로 swap하지 않는다. raw loss는 restore하지 않고 영향을 받은 review 검증 범위를 점검한다.

## 10. 현재 event

event에는 search 원문, exact location, detailed user address, health 표현, provider ID·token, review body·nickname·SQLite path를 넣지 않는다.

| event | 시점 | 허용 property |
|---|---|---|
| `login_started` | Kakao 이동 전 | request ID |
| `login_succeeded` | session 생성 | duration ms |
| `login_failed` | callback 실패 | error code |
| `location_notice_viewed` | 위치 안내 | 없음 |
| `location_consent_result` | 선택 | granted boolean |
| `location_fallback_used` | 지역 직접 입력 | origin type |
| `search_requested` | 구조화 입력 검증 | filter presence bitset, sort mode |
| `search_completed` | 결과 반환 | result count, duration ms, partial reason |
| `search_empty` | 후보 0 | filter count band |
| `filter_changed` | filter 변경 | filter enum, enabled |
| `sort_changed` | sort 변경 | from, to, top changed |
| `store_opened` | marker·list·detail 선택 | source surface, rank band |
| `favorite_changed` | add·remove | action |
| `history_deleted` | delete commit | history type |
| `chat_shell_opened` | FAB open | store selected boolean |

message·conversation·clarification·LLM event는 current schema에 만들지 않는다.

## 11. dashboard

### product·quality

- representative search Hit Rate@5
- hard exclusion violation
- 100-run determinism
- empty·partial search count
- review-poor store coverage
- FTS fallback과 map fallback

### trust

- account ownership denial
- exact location·nickname·raw·secret prohibited pattern
- favorite·history·withdrawal delete result
- raw retention와 AES verification
- kill switch

### data·recovery

- source basis date와 publish version
- eligible·manual review·quality blocker count
- review collected·rejected·published·duplicate count
- app review·FTS document count
- SQLite lock retry
- snapshot·restore last result

## 12. 장애 대응

### Kakao Login

1. local callback과 provider 상태 확인
2. 기존 session은 검증되는 경우에만 유지
3. secret·registered URI change 확인
4. provider account·token 없이 error code 기록

### 위치

1. browser request와 server memory coordinate 폐기
2. 지역 직접 입력 제공
3. exact coordinate log·history scan

### map

1. candidate·sort를 유지
2. list·address·distance·detail 제공
3. key·quota·SDK contract 확인
4. 가짜 marker·시간 생성 금지

### FTS5

1. review relevance·snippet 제외
2. menu·category·region result 유지
3. index version·count·integrity 확인
4. 새 version rebuild·verify 뒤 active swap

### source delay

1. 이전 성공 snapshot 유지
2. 7일 초과 warning
3. 30일 초과 new search block
4. failed snapshot은 격리

### SQLite corruption

1. web·worker write stop
2. active file 보존과 copy
3. verified app snapshot을 새 file로 restore
4. integrity·migration·FTS·representative search
5. 원인 확인 뒤 explicit swap

### delete failure

1. 대상 account mutation 차단
2. idempotency key로 local delete 재실행
3. Kakao unlink failure는 별도 retry
4. body·token 없는 operation ID·error code만 기록

### review safety failure

1. global kill switch
2. browser·collection·decrypt·publish stop
3. exposure·retention·encryption 영향 확인
4. delete·index removal·검증 뒤에만 resume 검토

## 13. 로컬 release checklist

- loopback bind와 file permission
- SQLite migration·WAL·`busy_timeout`
- app/raw process·package·path separation
- source freshness와 eligibility quality
- review policy gate·one-page·limit·stop
- deidentification·30일 raw delete·FTS consistency
- structured search Hit Rate@5 85% 이상
- hard exclusion 0·100-run determinism
- map·FTS·review-poor·SQLite failure fallback
- account IDOR·CSRF·session expiry
- exact location·nickname·raw·secret exposure 0
- chat input·submit·OpenAI request 0
- app snapshot·new-file restore rehearsal

## 14. 후속 원격 파일럿

다음은 별도 Feature의 운영 기준으로 다시 작성한다.

- remote participant 5명과 support time
- hosting·remote DB와 monthly cost
- public domain·HTTPS·production callback
- provider quota·billing·paid overage
- remote secret·backup·incident response
- Kakao Route와 OpenAI model·token·cost
- conversation·LLM event와 usability metrics

현재 local release가 이 항목을 기다리지 않는다.

## 관련 문서

- product target: [PRD](../00-product/prd.md)
- evaluation: [평가 계획](../02-recommendation/evaluation-plan.md)
- data worker: [Worker 설계](../04-architecture/worker-design.md)
- trust: [보안 설계](../06-trust/security-design.md), [정책 검토](../06-trust/policy-review.md)
