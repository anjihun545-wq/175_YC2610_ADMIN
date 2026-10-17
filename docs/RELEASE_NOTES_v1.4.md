# v1.4 변경 이력

- Firebase 의존성 제거, Apps Script + Google Sheets 도입
- 브라우저에서 POST form 전송 후 JSONP로 서버 기록 확인(서버 ACK)
- 약 5초 간격의 MC 데이터 갱신으로 UI 명확화
- 한 대만 계측하도록 Apps Script 잠금 사용, 50초 제어권 임대
- 요청 ID의 중복 적용 차단 / 초기화 세대 확인 / 서버 동시 수정 LockService 적용
- Google Sheet에 2중 스냅샷 슬롯 사용(저장 중단 시 이전 스냅샷 보존 시도)
- v1.3의 개인/단체/전체 초기화 및 200/50 고정 슬롯 보존
- Apps Script 설정 및 배포 설명서 동봉

주의: Apps Script 웹 앱을 공개 배포하면 기록 접근과 변경을 통제하지 못합니다.
