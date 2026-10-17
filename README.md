# 2026 연천피지컬 서바이벌 · 경기 기록관리 v1.0

GitHub Pages에서 구동되는 모바일·PC 대응 웹앱입니다. **장애물 레이스는 개인 1명씩**, **계주는 4명 1팀씩** 출발하고, 출발/종료 두 버튼으로 기록합니다.

## 들어 있는 기능

- 로고 카피 **2026 연천피지컬 서바이벌**, 행사형 대시보드 및 대형 타이머
- 개인 참가자 등록·수정, 남자부/여자부 구분, CSV 대량 업로드(200명 이상 가능)
- 계주팀 등록·수정(팀당 4명), CSV 대량 업로드
- 시작/종료, 미완주(DNF), 실격(DSQ), 재경기 허용, 수동 기록 수정 및 변경 이력
- 경기 종료 시 기기 내 IndexedDB 저장 → Firebase 서버 저장 요청 → 실시간 MC/운영본부 반영
- 미전송 기록 자동 재전송, 관리자 단독 계측 제어권(35초 갱신), 상태 표시
- 순위 자동 정렬(동시간 기록은 동순위), 잠정/확정 상태 분리
- 참가자, 팀, 전체 결과, 원본 계측 시도 이력, 감사 이력 CSV 다운로드
- `?view=mc`를 포함한 조회 전용 MC 화면(별도 viewer 계정 사용 권장)

## 바로 체험해 보려면

1. 이 압축파일을 풀고 **폴더 안의 파일을 GitHub 저장소 루트에 업로드**합니다.
2. GitHub 저장소에서 **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**를 선택합니다.
3. 표시되는 GitHub Pages 주소로 들어가면 기본 상태에서는 **이 기기 전용 체험 모드**로 실행됩니다.
4. 참가자 및 팀을 등록하고, 계측→기록→순위→CSV 저장까지 테스트합니다.

**주의: 체험 모드는 다른 기기와 실시간 공유하지 않습니다.** 실제 행사 운영을 하려면 `docs/SETUP_GUIDE.md`에 따라 Firebase Realtime Database와 Firebase Authentication을 먼저 연결해야 합니다.

## GitHub에 올리는 폴더 구조

```text
index.html
style.css
database.rules.json
.nojekyll
README.md
js/
  app.js
  core.js
  cloud.js
  storage.js
  firebase-config.js
assets/
  favicon.svg
docs/
  SETUP_GUIDE.md
  TEST_CHECKLIST.md
```

## 중요 사항

- GitHub Pages는 웹화면을 배포할 뿐, **여러 기기간 데이터 공유 기능을 제공하지 않습니다.** 실시간 공유는 Firebase 연결 후 가능합니다.
- Firebase API key는 일반적인 웹 클라이언트 설정값입니다. **Firebase 서비스 계정 비밀키·관리자 비밀번호를 GitHub에 넣지 마세요.** 데이터 접근 통제는 별도로 적용한 `database.rules.json`에서 합니다.
- 타이머 화면에서 시간은 `performance.now()`로 측정하며, 브라우저가 강제로 종료되거나 새로고침되면 정확한 단조시계 상태를 복구할 수 없습니다. 이 경우 벽시계 기준 추정값으로 표시하고 영상 또는 보조계측 확인 후 승인해야 합니다.
- 페이지를 열어 둔 상태에서 네트워크가 끊어지면 저장 대기열을 기기 내부에 보관합니다. **인터넷 없는 상태에서 새로고침 후 앱 전체가 반드시 실행된다고 보장하지는 않습니다.** 공식행사는 백업 기기를 운용하세요.
- 서버 저장 ACK 이전 기록은 ‘미전송’이며, 기기 저장 성공과 **서버에 반영된 상태는 서로 다릅니다.**
- 보안 규칙은 임의의 웹 접근을 막기 위한 최소 관리자/조회자 권한 구분입니다. 실제 행사의 보안·접근권한 및 동시제어·복구 시나리오는 배포 환경에서 별도 점검해야 합니다.
- 화면 표시가 0.01초 단위여도 사람의 버튼 누르기 반응 오차가 있으며, 이 시스템을 전자식 공식 계측기로 간주해서는 안 됩니다.

## Firebase 공식 문서

- https://firebase.google.com/docs/database/web/start
- https://firebase.google.com/docs/database/security
- https://firebase.google.com/docs/auth/web/password-auth
- https://firebase.google.com/docs/database/web/offline-capabilities
