# 보안과 개인정보 설계

[문서 허브](../README.md) · [PRD](../00-product/prd.md) · [시스템 구조](../04-architecture/system-architecture.md) · [데이터 설계](../05-data/data-design.md) · [정책 검토](policy-review.md)

이 문서는 카카오 계정 기반 5인 비공개 MVP의 인증, 계정 격리, 위치·대화 개인정보, 비밀과 삭제 기준을 정의한다.

## 1. 보호 목표

1. 한 사용자가 다른 사용자의 대화·추천·즐겨찾기·피드백을 보거나 바꾸지 못한다.
2. 정확한 현재 위치가 계정·대화·로그·분석·OpenAI에 남지 않는다.
3. OAuth token, session, API key와 리뷰 암호화 키가 브라우저·DB·Git·로그에 노출되지 않는다.
4. 메시지·리뷰 원문이 분석·오류 추적으로 복제되지 않는다.
5. 대화 삭제와 탈퇴가 문서화된 범위를 실제로 제거한다.
6. 외부 공급자 실패가 개인정보 삭제를 지연하거나 안전하지 않은 대체를 만들지 않는다.

## 2. 데이터 분류

| 등급 | 예 | 저장 위치 | 원칙 |
|---|---|---|---|
| 계정 식별 | 자체 `user_id`, Kakao provider account ID | `app_db` | 접근 최소화, 탈퇴 시 삭제 |
| 인증 비밀 | OAuth token, session token, cookie | 서버 세션·암호화 저장 | 평문 로그·클라이언트 노출 금지 |
| 대화 데이터 | 메시지, 구조화 조건, 추천 결과 | 계정별 `app_db` | 대화별 삭제, 탈퇴 시 삭제 |
| 일시 위치 | GPS 위도·경도 | 브라우저·현재 경로 요청 메모리 | 영구 저장·로그·분석 금지 |
| 거친 위치 | 사용자가 선택한 역·동·구 | 대화·추천 스냅숏 선택 저장 | 화면 표시와 삭제 범위 적용 |
| 공개 매장 데이터 | 매장 주소·좌표·영업 상태 | `app_db` | 출처·최신성 추적 |
| 리뷰 원문 | PII 제거 후 AES-GCM 암호문 | worker 전용 `raw_db` | 30일 hard delete, 웹 접근 금지 |
| 일시 리뷰 식별자 | 작성자 닉네임 | 수집 프로세스 메모리 | 매장 범위 HMAC 지문 생성 직후 폐기, 저장·표시·로그 금지 |
| 구조화 리뷰 특징 | 축·태그·근거 해시 | `app_db` | 원문 인용 금지 |
| 운영 로그 | 요청 ID, 오류 코드, 소요 시간 | 로그 저장소 | 메시지·좌표·토큰 금지 |

사용자가 자유 입력에 건강·알레르기 내용을 쓸 수 있으므로 대화 원문은 민감할 수 있는 사용자 생성 데이터로 취급한다. 해당 표현을 구조화 추천 상태, 분석 이벤트와 오류 로그로 옮기지 않는다.

## 3. 카카오 로그인

### 구현 기준

- Auth.js의 Kakao provider를 사용한다.
- Authorization Code 흐름, state와 provider callback 검증을 직접 축약하지 않는다.
- 데이터베이스 세션과 `HttpOnly`, `Secure`, 적절한 `SameSite` cookie를 사용한다.
- production callback은 HTTPS와 Kakao에 등록된 정확한 redirect URI만 허용한다.
- callback URL의 임의 host·scheme을 신뢰하지 않는다.

### 최소 동의

- 필수: Kakao provider account ID
- 선택: 화면 인사용 닉네임
- 요청하지 않음: 이메일, 전화번호, 생일, 성별

provider account ID는 자체 `user_id`로 직접 노출하지 않고 `auth_account`에 연결한다. 닉네임·프로필 이미지는 인증·계정 병합·권한 판정에 사용하지 않는다.

### 세션

- session token 원문 대신 안전한 hash 또는 Auth.js가 요구하는 보호 형식으로 저장한다.
- 로그인, 로그아웃, 비밀번호·계정 보안 변화에 해당하는 provider 이벤트 후 세션 폐기 정책을 적용한다.
- 장기 미사용·만료 세션을 정리한다.
- 회원탈퇴 시작 시 모든 세션을 먼저 무효화한다.

## 4. 카카오 동의와 GPS 권한 분리

다음은 서로 다른 동의다.

| 단계 | 처리 주체 | 허용하는 것 |
|---|---|---|
| 카카오 로그인 | Kakao OAuth | 로그인, 계정 식별과 최소 제공 정보 |
| 서비스 위치 선택 동의 | 빵찾깅 | 위치 이용 목적·Kakao 전송·비저장 안내 확인 |
| 브라우저 위치 권한 | 브라우저·OS | 실제 GPS 센서 접근 |

카카오 로그인 동의가 GPS 접근을 허용한다고 설명하지 않는다. 위치는 선택이며 거부해도 역·동·구 입력으로 추천을 완료할 수 있다.

위치 안내는 반드시 다음을 포함한다.

1. 거리·이동시간 계산 목적
2. 정확 출발 좌표가 Kakao 경로 API로 전송될 수 있음
3. 계정·대화·분석·로그에 저장하지 않음
4. 거부 시 직접 출발지 입력 가능

## 5. 전경 위치 보호

- 사용자가 현재 위치 사용을 선택한 뒤에만 브라우저 권한을 요청한다.
- 지도·추천 화면이 전경에 있을 때만 위치 watcher를 유지한다.
- 화면 숨김, 로그아웃, 권한 철회와 사용 중지에서 watcher와 메모리 좌표를 폐기한다.
- 100m 이상 이동 또는 사용자 요청 때만 경로 재계산한다.
- Kakao 호출용 request body를 애플리케이션·proxy·APM 로그에서 제거한다.
- 오류 추적 breadcrumb와 replay에 위치 API 반환값을 기록하지 않는다.
- service worker, localStorage, IndexedDB와 analytics SDK에 좌표를 전달하지 않는다.

Kakao가 전송된 좌표를 어떻게 처리하는지는 Kakao의 정책 적용 대상이다. 서비스는 이를 자체 비저장과 같은 의미로 표현하지 않는다.

## 6. 계정 소유권과 IDOR 방지

모든 사용자 자원은 서버 세션의 `user_id`로 범위를 제한한다.

```text
conversation.user_id = session.user.id
favorite.user_id = session.user.id
user_feedback.user_id = session.user.id
recommendation_run.conversation.user_id = session.user.id
```

- URL·body의 `user_id`를 권한 근거로 사용하지 않는다.
- 다른 계정 자원과 존재하지 않는 ID는 기본적으로 같은 404로 처리한다.
- batch 조회·삭제에도 소유권 조건을 각 쿼리에 포함한다.
- `store_id`는 공개 카탈로그 ID지만 숨김·제외 매장은 사용자 API에서 반환하지 않는다.
- 관리자 권한은 일반 사용자 세션과 분리하고 role, 재인증과 감사 기록을 요구한다.

권한 테스트에는 연속·임의 UUID, 다른 계정의 유효 ID, 삭제된 ID와 batch 혼합을 포함한다.

## 7. CSRF, XSS와 입력 보호

- Auth.js login·callback의 CSRF/state 보호를 유지한다.
- 대화·즐겨찾기·삭제·탈퇴의 상태 변경 요청은 same-site cookie와 CSRF 방어를 적용한다.
- 사용자 메시지와 외부 메뉴·리뷰 문자열은 HTML로 렌더링하지 않고 이스케이프한다.
- Markdown을 허용한다면 raw HTML, 위험 URL scheme과 이미지 추적을 차단한다.
- 관리자에게 표시하는 외부 URL은 `https` 허용 목록과 host 검증을 통과해야 한다.
- CSP, frame-ancestors, referrer policy와 MIME sniffing 방지를 배포 기준에 포함한다.

## 8. LLM·프롬프트 주입 경계

- 사용자 메시지는 현재 대화 의도 구조화 입력일 뿐 시스템 명령을 바꾸지 못한다.
- 리뷰 텍스트는 untrusted data로 분리하고 본문 명령을 따르지 않는다.
- 허용 enum·JSON Schema와 결정론적 사후 검증을 통과하지 못한 출력은 폐기한다.
- LLM은 자체 DB·외부 도구·인증 정보에 접근하지 않는다.
- 사용자 정확 위치와 Kakao token을 프롬프트에 포함하지 않는다.

프롬프트 전문과 모델 응답 원문을 오류 로그에 남기지 않는다.

## 9. `app_db`와 `raw_db`

- 웹 role: `app_db`의 필요한 읽기·제한 쓰기만
- worker app role: 적재·집계·작업 상태
- worker raw role: `raw_db` 암호문 쓰기·복호화·삭제
- web 프로세스: `raw_db` DSN·암호화 키 없음
- backup role: `app_db`와 공개 원본의 필요한 읽기만

리뷰 암호문은 AES-256-GCM, 중복 지문은 별도 HMAC-SHA-256을 사용한다. 지문은 `provider`, `store_id`, 메모리의 정규화 닉네임, 게시일과 비식별 본문으로 만든 뒤 닉네임을 즉시 폐기한다. 지문으로 다른 매장의 작성자를 연결하지 않는다. encryption key와 dedupe key를 분리하고 OS 비밀 저장소에서 버전 관리한다. nonce 재사용 0건과 tag 검증 실패 즉시 중단을 검사한다.

## 10. 비밀 관리

다음은 환경 변수 또는 배포 비밀 저장소에 둔다.

- Auth.js secret
- Kakao client ID·client secret과 관리자 자격 정보
- Kakao Maps REST API key
- OpenAI API key
- DB 연결 문자열
- 리뷰 암호화·HMAC 키

비밀은 Git, Markdown, DB 일반 열, 브라우저 bundle, CI 로그와 스크린샷에 넣지 않는다. 개발·파일럿·운영 값을 분리하고 노출 의심 시 즉시 회전한다.

## 11. 로그와 분석

### 허용

- 비민감 `request_id`, 이벤트 이름, 성공 여부와 오류 코드
- 후보·필터 개수, 소요 시간, 공급자 상태
- 내부 버전, 토큰 수, 비용과 쿼터 사용량
- 사용자 자원 접근 거부 횟수

### 금지

- 메시지·조건·프롬프트·리뷰 원문
- 정확 좌표, 상세 주소와 Kakao 경로 request body
- provider account ID, OAuth token, session token·cookie
- API key, 암호문, nonce, tag와 HMAC
- 건강·알레르기 표현

세션 replay를 사용한다면 로그인·대화·위치·계정 설정 화면을 기본 마스킹하거나 제외한다.

## 12. 삭제

### 대화 삭제

소유권을 확인하고 메시지, 구조화 state/checkpoint, 추천 실행·항목과 연결 피드백을 한 트랜잭션으로 삭제한다. 즐겨찾기는 유지한다. 삭제 후 원문을 로그나 분석에서 복원할 수 없어야 한다.

### 회원탈퇴

1. 최근 인증 확인
2. 계정을 `DELETING`으로 전환하고 새 요청 차단
3. 세션 폐기
4. 대화·추천·피드백·즐겨찾기 삭제
5. auth 연결과 사용자 삭제
6. Kakao unlink 요청

Kakao unlink 실패는 서비스 데이터 삭제를 rollback하지 않는다. provider token을 담지 않은 제한된 재시도 상태만 남긴다.

### 백업

`app_db` 백업 복구 후 400일 tombstone을 먼저 재적용해 삭제 데이터가 부활하지 않게 한다. `raw_db`는 기본 백업하지 않는다.

## 13. 위협과 통제

| 위협 | 통제 |
|---|---|
| 다른 계정 대화 ID 추측 | 서버 세션 소유권, 404 통일, IDOR 회귀 테스트 |
| OAuth callback 변조 | Auth.js provider 검증, 등록 redirect URI, HTTPS |
| session 탈취 | HttpOnly·Secure cookie, 만료·회전, CSP·XSS 방어 |
| 정확 위치 유출 | 메모리 한정, body·APM 마스킹, 영구 필드 금지 검사 |
| 프롬프트 주입 | strict schema, 도구 없음, 결정론적 업무 검증 |
| 리뷰 원문 유출 | raw DB 분리, AES-GCM, 30일 삭제, web 접근 거부 |
| 삭제 불완전 | cascade 통합 테스트, tombstone 재적용, unlink 분리 |
| 관리자 오용 | 별도 role·재인증·감사·로컬 실험 제한 |
| 비용·쿼터 공격 | 계정별 rate limit, 공급자별 예산·soft stop |

## 14. 필수 보안 검사

- Kakao callback state·redirect URI 실패 케이스
- 비로그인·만료 session의 추천·대화 API 차단
- 사용자 A가 사용자 B의 모든 자원 ID에 접근하는 IDOR 행렬
- CSRF 없는 삭제·탈퇴·즐겨찾기 변경 차단
- exact coordinate 키·숫자가 DB·로그·분석에 없는지 검사
- 위치 권한 철회 후 watcher·메모리 정리
- 대화 삭제·회원탈퇴 후 연결 행 0건
- unlink 실패에서 서비스 데이터 삭제 유지
- web role의 `raw_db` 접근 거부
- 로그에 token·cookie·API key·review text·message text 없음
- XSS payload가 사용자·관리자 화면에서 실행되지 않음

## 관련 문서

- 인증·대화 런타임: [시스템 구조](../04-architecture/system-architecture.md)
- 필드·보존·삭제: [데이터 설계](../05-data/data-design.md)
- 외부 공급자 조건: [정책 검토](policy-review.md)
- 운영·사고 대응: [운영 기준](../08-operations/operating-baselines.md)
