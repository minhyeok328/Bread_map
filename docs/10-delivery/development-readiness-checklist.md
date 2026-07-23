# 개발 준비 체크리스트

[구현·릴리스 안내](README.md) · [마스터 구현 계획](../superpowers/plans/2026-07-23-p0-master-implementation.md) · [보안 설계](../06-trust/security-design.md)

이 문서는 사용자가 개발 시작 전과 각 외부 연동 전에 준비할 항목을 정의한다. 실제 secret 값은 체크 결과로 기록하거나 Codex 대화에 붙이지 않는다. 준비 완료 여부와 비민감 식별자·화면 상태만 공유한다.

## 1. 지금 준비할 항목

### 로컬 개발 도구

- [ ] Windows에서 WSL2가 활성화되어 있다.
- [ ] Docker Desktop이 설치되어 있고 WSL2 backend로 Linux container를 실행할 수 있다.
- [ ] Node.js와 Corepack이 설치되어 있다. 정확한 지원 버전은 Feature 1에서 호환성을 확인한 뒤 저장소에 고정한다.
- [ ] Git이 설치되어 있고 Bread_map 저장소에서 브랜치를 만들 수 있다.
- [ ] 로컬 디스크에 Docker image·PostgreSQL volume·공개 원본 snapshot용 여유 공간이 있다.

확인 명령:

```powershell
wsl --status
docker version
docker compose version
node --version
corepack --version
git --version
```

완료 증거는 각 명령의 성공 여부와 버전 번호다. 전체 환경 변수나 시스템 경로는 공유하지 않는다.

### Kakao Developers

- [ ] Kakao Developers 계정을 준비한다.
- [ ] 이름을 `Bread_map`으로 식별할 수 있는 애플리케이션을 하나 만든다.
- [ ] 일반 Kakao Login을 활성화한다. KakaoSync는 사용하지 않는다.
- [ ] 로컬 callback URI로 `http://localhost:3000/api/auth/callback/kakao`를 등록한다.
- [ ] 로컬 JavaScript SDK 도메인으로 `http://localhost:3000`을 등록한다.
- [ ] REST API key, JavaScript key와 client secret을 확인하되 값은 비밀 저장소에만 보관한다.
- [ ] 이 앱에서 Kakao Map API를 계정 최초로 활성화하고 무료 쿼터 표시가 나타나는지 확인한다.
- [ ] Kakao Map REST API와 JavaScript SDK 사용 가능 상태를 확인한다.

Codex에 공유해도 되는 정보:

- 앱이 생성됐는지 여부
- 일반 Kakao Login 활성화 여부
- 등록한 callback URI와 공개 도메인
- 첫 Map 활성 앱·무료 쿼터 표시 여부

공유하면 안 되는 정보:

- REST API key, JavaScript key와 client secret 실제 값
- OAuth token, session cookie와 Kakao account ID

### 공공데이터포털

- [ ] 공공데이터포털 계정을 준비한다.
- [ ] 행정안전부 `식품_제과점영업` OpenAPI 또는 파일데이터 사용 조건을 확인한다.
- [ ] 공정위 브랜드 목록, 취소 브랜드, 브랜드 가맹점, 가맹·직영점 수 자료에 접근할 수 있게 신청한다.
- [ ] 발급된 service key를 사용자 비밀 저장소에 보관한다.
- [ ] 각 서비스의 승인 상태, 일일 호출 한도와 응답 형식을 기록한다.

Codex에는 서비스명, 승인 상태와 호출 한도만 공유한다. service key 값은 공유하지 않는다.

### OpenAI API

- [ ] Bread_map 전용 OpenAI project를 만든다.
- [ ] project-scoped API key를 발급해 사용자 비밀 저장소에 보관한다.
- [ ] 결제 수단과 사용량 알림을 설정한다.
- [ ] Responses API와 Structured Outputs를 사용할 수 있는지 확인한다.
- [ ] 사용 가능한 후보 모델 목록을 확인한다.

OpenAI project budget은 soft threshold이므로 비용 차단 수단으로 믿지 않는다. Feature 7에서 worker hard cap과 kill switch를 만들고, 실제 리뷰 100개 benchmark 결과를 승인하기 전에는 서울 전체 추출을 실행하지 않는다.

## 2. Feature별 준비 시점

| 필요 시점 | 사용자 준비 | 완료 확인 |
|---|---|---|
| Feature 1 전 | Docker Desktop·WSL2·Node·Corepack·Git | 위 로컬 명령 성공 |
| Feature 2 전 | 공공데이터포털 서비스 승인과 key 보관 | API별 승인 상태·한도 확인 |
| Feature 5 전 | Kakao Map 활성화·무료 쿼터 표시 | Kakao Developers 화면 상태 확인 |
| Feature 6 전 | 없음 | 암호화·HMAC 키는 Codex가 생성 절차를 만들고 사용자가 실행 시 주입 |
| Feature 7 전 | OpenAI project·key·결제·후보 모델 접근 | 100개 benchmark 실행 가능 |
| Feature 11 전 | Kakao Login·local callback·client secret | 로컬 OAuth callback 성공 |
| Feature 13 전 | Kakao JavaScript 도메인·REST 경로 API | 지도·경로 수동 smoke 가능 |
| Feature 15 전 | 없음 | Codex 목업을 사용자가 검토 |
| Feature 18 전 | 파일럿 도메인·배포 공급자·결제 수단 | 월 30,000원 예산안 승인 |
| Feature 19 전 | 파일럿 참여자 5명과 Kakao 계정 | 참여자·테스트 일정 확정 |

## 3. 파일럿 인증·배포 전에 추가 준비

아래 항목은 Feature 11의 로컬 로그인 구현에는 필요하지 않다. Feature 18에서 배포 공급자와 HTTPS 주소를 확정한 뒤 production OAuth smoke 전에 준비한다.

- [ ] 파일럿 HTTPS 주소를 확정한다.
- [ ] `https://<파일럿-도메인>/api/auth/callback/kakao`를 Kakao redirect URI에 추가한다.
- [ ] 파일럿 JavaScript SDK 도메인을 Kakao 플랫폼 설정에 추가한다.
- [ ] 최소 개인정보 처리방침을 공개 URL에 준비한다.
- [ ] 서비스 계정 삭제와 Kakao 연결 해제 동선을 문서로 확인한다.
- [ ] 본인 포함 파일럿 참여자 5명이 일반 Kakao Login을 사용할 수 있다.

`<파일럿-도메인>`은 배포 공급자와 도메인을 선택하기 전까지 문서에 실제 값으로 고정하지 않는다. 선택이 끝나면 Feature 18의 배포 기록에 승인된 URI를 남긴다.

## 4. 배포 Feature 전에 추가 준비

- [ ] 월 반복 비용 30,000원 안에서 web·worker·PostgreSQL·backup을 운영할 공급자를 선택한다.
- [ ] HTTPS와 custom 또는 공급자 기본 도메인을 제공한다.
- [ ] web과 worker를 별도 process 또는 container로 실행할 수 있다.
- [ ] PostgreSQL 두 database 또는 동등한 논리·권한 분리를 지원한다.
- [ ] 매일 `app_db` backup과 월 1회 복구 리허설을 수행할 수 있다.
- [ ] 배포 secret 저장소가 있고 운영자가 값을 직접 주입할 수 있다.

Codex는 Feature 18에서 다음을 만든다.

- `apps/web` production Dockerfile과 image
- `apps/worker` production Dockerfile과 image
- image build·health check·migration·rollback 절차
- 배포용 환경 변수 목록과 secret 주입 가이드

사용자가 Docker image를 미리 만들 필요는 없다.

## 5. secret 이름

Feature 구현 과정에서 `.env.example`에는 이름과 설명만 기록한다.

```text
APP_DATABASE_URL
RAW_DATABASE_URL
AUTH_SECRET
AUTH_KAKAO_ID
AUTH_KAKAO_SECRET
NEXT_PUBLIC_KAKAO_JS_KEY
KAKAO_REST_API_KEY
DATA_GO_KR_SERVICE_KEY
OPENAI_API_KEY
OPENAI_REVIEW_MODEL
REVIEW_ENCRYPTION_KEY_B64
REVIEW_DEDUPE_KEY_B64
```

실제 값은 다음 위치에만 둔다.

- 로컬 실행: Git에서 제외된 사용자 환경 또는 OS 비밀 저장소
- 파일럿: 배포 공급자의 secret 저장소
- CI: 저장소가 지원하는 encrypted secret

## 6. 개발 시작 승인 문구

아래 항목이 준비되면 실제 값 없이 다음처럼 알려주면 된다.

> 로컬 도구, Kakao Developers 앱, 공공데이터포털 접근, OpenAI project 준비 완료. secret은 로컬 비밀 저장소에 보관했고 대화나 Git에는 넣지 않았음.

Feature 1은 외부 key가 아직 없어도 workspace와 Docker 기반을 구현할 수 있다. 다만 Feature 2·5·7·11·13의 실제 연동 smoke test는 해당 준비가 끝나야 완료할 수 있다.
