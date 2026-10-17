# Firebase 설정 가이드 v1.3 — 계정 로그인 없이 자동 접속

## 확인된 프로젝트 정보

- Firebase 프로젝트: `YC2026-TIMER`
- Project ID: `yc2026-timer`
- Realtime Database URL: `https://yc2026-timer-default-rtdb.asia-southeast1.firebasedatabase.app`
- GitHub 저장소: `https://github.com/anjihun545-wq/175_YC2610_ADMIN`
- 예상 GitHub Pages 주소(활성화 후): `https://anjihun545-wq.github.io/175_YC2610_ADMIN/`

## 1. Authentication 익명 인증 켜기

Firebase 콘솔 → **빌드 / 보안 → Authentication → 시작하기 → 로그인 방법** → **익명(Anonymous)** 을 **사용 설정**하고 저장합니다.

이 기능은 **사용자에게 이메일·비밀번호 입력을 요구하지 않습니다.** 페이지가 열리면 Firebase SDK가 익명 사용자로 자동 연결합니다. 단, Firebase 보안 규칙에서는 익명 사용자에게 쓰기를 허용하기 때문에 **누구나 조작할 수 있습니다**. 운영자 보호가 필요하면 추후 관리자 인증으로 전환해야 합니다.

## 2. Realtime Database 규칙 적용

Firebase Console → Realtime Database → **규칙(Rules)** → 프로젝트의 `database.rules.json` 내용 전체를 붙여넣고 **게시(Publish)**.

```
{
  "rules": {
    ".read": false,
    ".write": false,
    "events": {
      "$eventId": {
        ".read": "auth != null && auth.provider === 'anonymous' && $eventId === 'yeoncheon-physical-2026'",
        ".write": "auth != null && auth.provider === 'anonymous' && $eventId === 'yeoncheon-physical-2026'"
      }
    }
  }
}
```

이 규칙은 단순한 비로그인 편의용이며, **기록 변조 방지용 관리권한 규칙이 아닙니다.** 다른 Firebase 데이터 경로는 기본적으로 막습니다. Realtime Database의 `Data` 탭의 초기 `null` 상태는 정상입니다.

## 3. Firebase 웹 앱 등록

프로젝트 설정 → 일반 → 내 앱 → 웹 앱(`</>`) → 앱 별명 `YC2026-WEB` → 앱 등록.
Firebase Hosting 별도 활성화는 불필요합니다.
Firebase 콘솔에 표시되는 SDK `firebaseConfig`에서 **apiKey**, **appId**를 복사해 `js/firebase-config.js`의 빈 값에 입력합니다. `authDomain`, `projectId`, `databaseURL`은 이미 확인된 값을 미리 입력했습니다. Firebase 콘솔의 값과 대조하고 차이가 있으면 콘솔값을 우선하세요.

```js
export const firebaseConfig = {
  apiKey: "Firebase 콘솔의 실제 apiKey",
  authDomain: "yc2026-timer.firebaseapp.com",
  databaseURL: "https://yc2026-timer-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "yc2026-timer",
  appId: "Firebase 콘솔의 실제 appId"
};
export const EVENT_ID = "yeoncheon-physical-2026";
```

**클라이언트 `apiKey`는 서비스 계정 비밀키와 다릅니다.** 관리용 JSON 서비스계정 키는 GitHub에 절대 업로드하지 마세요.

## 4. GitHub 업데이트

GitHub Pages 웹앱 파일을 `main` 브랜치 최상위에 업로드한 뒤 `js/firebase-config.js`까지 변경해 커밋하세요. 동일 이름을 가진 기존 파일은 교체해야 합니다. 사용 중인 기록이 있다면 업데이트 전 CSV·JSON 백업을 받으세요. **Firebase 데이터베이스는 별도 삭제하거나 import 하지 마세요.**

## 5. 실시간 검증

1. **운영 노트북**에서 앱을 열고 `서버 동기화 정상` 상태 확인 후 `계측 제어권 획득`.
2. **MC 휴대전화**로 같은 주소에 `?view=mc`를 붙여 열어 기록 대기 확인.
3. 운영 노트북에서 개인전 `001번` 시작·종료, 종료 기록이 서버 저장됐는지 확인.
4. MC 화면에 `001번`, 기록, 잠정 순위가 반영되는지 확인.
5. 단체전 `01팀`도 동일하게 시험.
6. 운영·백업에서 전체 JSON 백업 → 개인전만 초기화 → 단체전 기록이 남는지 확인. 이후 전체 초기화 시험.
7. 인터넷 일시 중단 뒤 경기 종료 → 재연결 후 전송 대기열이 줄어드는지 확인. 리허설 후 백업 파일 저장.

**주의:** 실시간 반영 지연, Firebase 규칙의 실제 적용, 휴대전화 Safari/Chrome, 250회 연속 현장 계측은 실제 연결 후 검증해야 합니다. 모의 시험 결과만으로 실전 안전을 보장하지 않습니다.
