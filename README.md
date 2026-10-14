# Pool 3D — 실사형 8볼 포켓볼

Vite + TypeScript + Three.js. 범용 물리엔진 없이 당구 전용 물리를 직접 구현했습니다.

## 실행
```
npm i
npm run dev      # 개발 서버
npm test         # 물리/규칙/AI 단위 테스트
npm run build    # dist/ 정적 배포 (GitHub Pages/Vercel)
```

## 모드
연습(자유 배치) · 로컬 2인 · AI 대전(초/중/고급) · **온라인 2인(P2P, 방 코드)** · 물리 테스트 랩

## 조작
| 입력 | 동작 |
|---|---|
| 드래그 | 조준 (Shift = 1/10 미세) / 세로 드래그 = 카메라 높이 |
| 우클릭 또는 Space 누른 채 마우스를 아래로 당겼다 위로 밀기 | 스트로크 (미는 속도 = 파워) |
| 파워 게이지 | 설정에서 선택, 모바일 기본 |
| 휠 / 핀치 | 줌 |
| ↑↓ 또는 Alt+휠 | 큐 엘리베이션 |
| ←→ | 미세 조준 |
| 타점 원 클릭 | 타점(점선 원 밖은 미스큐) |
| T / P / Esc / Enter | 탑뷰 / 리플레이 / 일시정지 / 큐볼 확정 |

## 구조
`src/physics`(렌더 독립, vitest) · `rendering` · `input` · `audio`(Web Audio 합성, SampleBank 로 샘플 교체) · `game-rules`(RuleSet 인터페이스) · `ai` · `net`(MQTT 중계) · `ui` · `testbench`는 `physics/scenarios.ts`.
자세한 모델은 `docs/PHYSICS.md`.

## 튜닝 포인트 / 알려진 한계
- 쿠션 e, 천 마찰, squirt, 점프 바운스 계수는 실측 대비 눈으로 튜닝 필요(디버그 패널).
- 피사계 심도 미구현. 사운드는 합성음이라 실제 샘플로 교체하면 더 좋아짐.
- 온라인은 공개 MQTT(WebSocket) 브로커를 메시지 중계로 사용(NAT 무관, 8084/8884/8081 포트가 막힌 네트워크에서는 실패 가능).
