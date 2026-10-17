# Firebase 연결과 GitHub Pages 배포 매뉴얼

### 1단계. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 에서 프로젝트를 새로 만듭니다.
2. **Realtime Database**를 만듭니다. **Firestore가 아니라 Realtime Database**입니다.
3. 데이터베이스 생성 시 가까운 위치를 선택하고, 모든 사람에게 읽기/쓰기를 허용하는 테스트 규칙을 운영환경에서 사용하지 마세요.
4. **Authentication → Sign-in method → 이메일/비밀번호**를 활성화합니다.
5. **Authentication → Users → 사용자 추가**에서 계측 운영자 계정과 MC 조회 계정을 만듭니다. **비밀번호는 파일에 기록하거나 GitHub에 올리지 마세요.**

### 2단계. 계정별 권한 등록

1. Authentication → Users 화면에서 각 계정의 UID를 확인합니다.
2. Realtime Database → **Data**에서 다음 위치에 역할을 지정합니다. 최상위 `roles` 키 아래에 UID를 키로, 문자열을 값으로 입력합니다.

```json
{
  "roles": {
    "운영자_UID_실제값": "admin",
    "MC_UID_실제값": "viewer"
  }
}
```

> **주의:** 위 JSON은 설명용 예시입니다. `운영자_UID_실제값`과 `MC_UID_실제값`을 Firebase Authentication의 실제 UID로 교체하고, `roles`만 기존 데이터에 병합하세요. 데이터베이스 전체를 가져오기(import)하면 기존 기록을 덮어쓸 수 있습니다.

**admin** 계정은 참가자·계주팀·계측 기록을 변경할 수 있고, **viewer** 계정은 MC 조회 및 결과 읽기만 가능합니다.

### 3단계. Firebase 보안 규칙 적용

Realtime Database → **Rules** 탭에서 제공된 `database.rules.json` 내용을 그대로 붙여 넣고 Publish합니다. 역할 없이 접근하거나, MC 계정으로 쓰는 요청은 서버가 거부합니다.

**보안 규칙을 공개 read/write로 설정해서 문제를 우회하면 안 됩니다.**

### 4단계. 웹 앱 등록과 설정

Firebase 프로젝트 설정(톱니바퀴) → 내 앱 → **웹 앱(</>)** 등록 → SDK 설정의 `firebaseConfig` 값을 확인합니다.

압축파일의 `js/firebase-config.js` 파일을 열어서 다음 속성에 값을 붙여 넣습니다.

```js
export const firebaseConfig = {
  apiKey: "Firebase 콘솔의 apiKey",
  authDomain: "프로젝트ID.firebaseapp.com",
  databaseURL: "https://...firebasedatabase.app", // 또는 지역별 URL
  projectId: "프로젝트ID",
  appId: "Firebase 콘솔의 appId"
};
export const EVENT_ID = "yeoncheon-physical-2026";
```

`databaseURL`은 **Firebase Realtime Database → Data 화면의 실제 URL**을 확인하여 정확히 입력합니다. 위 주석은 설명용이므로 작성된 파일에서 문자열 값만 바꾸면 됩니다.

이 파일의 설정값은 일반 Firebase 클라이언트용 공개값으로 사용하지만, **비밀번호·서비스 계정 JSON 등은 절대 여기에 넣지 마세요.**

### 5단계. Authentication 허용 도메인

Firebase Authentication → Settings → Authorized domains에서 실제 GitHub Pages 호스트인 `계정명.github.io`가 허용되어 있는지 확인합니다. 실제 주소에 따라 필요한 호스트가 다릅니다. 일반 이메일/비밀번호 로그인은 프로젝트 설정 및 브라우저 조건에 따라 별도 검증이 필요합니다.

### 6단계. GitHub 업로드

1. GitHub에 새 **Public repository**를 만듭니다. 무료 GitHub Pages 사용 시 저장소 공개 범위와 계정 플랜 정책을 확인하세요.
2. ZIP을 압축 해제하고 폴더 안의 내용을 저장소 최상단(`index.html`이 루트)에 올립니다.
3. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.
4. 안내된 `https://계정명.github.io/저장소명/` 주소에 접속해 화면을 확인합니다. **이 주소는 예시이며 실제 사용자 계정·저장소 이름으로 변경됩니다.**
5. 운영 계정으로 로그인 → **계측 제어권 획득** → 출발·종료 → MC 계정으로 다른 브라우저/기기에서 `.../?view=mc`를 열어 기록 동기화 여부를 확인합니다.

### 7단계. 꼭 확인할 상태

- 초록 `실시간 연결 정상` = Firebase 연결이 있고 미전송 큐가 없는 상태 (기록의 공식 확정과는 다름)
- 노랑 `미전송 N건` = IndexedDB에 보관된 아직 서버 반영되지 않은 데이터가 있음
- 빨강 `서버 연결 끊김` = MC의 화면은 최신 상태가 아닐 수 있음
- 선수 기록 `잠정` = 정상 종료 후 아직 결과 확인 전
- 선수 기록 `확정` = 운영자가 공식 기록으로 승인함

### 8단계. 현장 네트워크 중단 시

1. **계측 중인 탭을 닫지 말고** 종료 버튼을 누릅니다.
2. 현장 측정기 화면에서 기기 저장 여부와 미전송 건수를 확인합니다.
3. 연결이 돌아오면 전송 대기열이 순서대로 자동 재전송되는지 확인합니다.
4. 운영본부·MC 화면에 결과가 반영되면 심판이 순위와 기록을 확인합니다.
5. 타이머 도중 앱이 종료되어 추정 시간이 발생하면, 결승선 영상과 보조 계측기를 기준으로 수동 수정하고 사유를 남깁니다.

**실전 권장 운영:** 공식 계측 전용 노트북 1대 + MC 조회 노트북 1대 + 운영본부 조회/관리 1대. 같은 종목을 여러 기기에서 동시에 계측하지 마세요. 운영 중 네트워크를 차단·복구하는 리허설이 반드시 필요합니다.
