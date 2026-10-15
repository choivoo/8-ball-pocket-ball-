# Pool 3D — 실사형 8볼 · 9볼 포켓볼

Vite + TypeScript + Three.js. 범용 물리엔진 없이 **당구 전용 물리**를 직접 구현했습니다 (이벤트 기반 충돌 예측, 슬라이딩→구름, 스핀/squirt/swerve/점프, 쿠션 높이 접점, 포켓 jaw rattle).

▶ 플레이: GitHub Pages 배포본 (아래 *배포* 참고) · 설치형(PWA) 지원

## 모드
| 모드 | 설명 |
|---|---|
| 연습 | 자유 배치(✋)·재랙, 규칙 알림만, 첫 실행 시 튜토리얼 |
| 로컬 2인 | 한 화면에서 번갈아 |
| AI 대전 | 초급/중급/고급 — 실제 물리 시뮬레이션으로 후보 샷을 평가하고 난이도별 오차를 섞음 |
| 온라인 2인 | 방 코드 공유. 공개 MQTT 중계 + 신뢰 전송 계층(손실/재연결 자동 복구) |
| 알까기 ⚫⚪ | 검은 공(8)+흰 공 두 개만. 가위바위보로 검은 공(선공) 결정 → 번갈아 자기 공으로 상대 공을 포켓에 넣으면 승리 (로컬/AI/온라인) |
| 드릴·챌린지 | 직선·컷·뱅크·스톱샷·끌어치기·포지션·점프·3쿠션·5볼 런아웃·브레이크 (별 3개) |
| 물리 테스트 랩 | 스톱샷, 끌어치기, 밀어치기, 30° 컷(30도 법칙), 쿠션 반사각/사이드 스핀, 점프, 스워브 |

모든 대전 모드에서 **8볼 / 9볼 / 알까기**, **단판~7판 4선승 매치**, **샷 클락(30/45/60초)** 를 고를 수 있습니다.

## 조작
| 입력 | 동작 |
|---|---|
| 드래그 / 한 손가락 | 조준 (Shift = 1/10 미세), 세로 드래그 = 카메라 높이 |
| 우클릭 또는 Space 누른 채 마우스를 **아래로 당겼다 위로** | 스트로크 — 미는 속도 = 파워 |
| 파워 게이지 | 설정에서 선택, 모바일 기본 |
| 타점 원 | 클릭으로 스핀 지정 (점선 밖 = 미스큐) |
| ↑↓ / Alt+휠 / +− | 큐 엘리베이션 (점프·마세) |
| 휠 / 핀치 | 줌 |
| T | 카메라 (조준→탑뷰→추적→레일) |
| P | 리플레이 (0.25×/0.5×/1×) |
| H / F / F2 / Esc / Enter | 도움말 / 전체화면 / 포토 모드 / 일시정지 / 볼 인 핸드 확정 |

## 개발
```
npm i
npm run dev       # 개발 서버 (?debug 로 물리 파라미터 패널, ?q=low|medium|high)
npm test          # 물리·규칙·AI·네트워크·드릴·프로필 단위 테스트
npm run build     # dist/ 정적 배포
npm run gen:drills # (선택) 드릴 배치를 실제 물리로 다시 생성
```

## 구조
```
src/physics     렌더 독립 물리 (world, tableGeometry, scenarios, tests)
src/game-rules  RuleSet 인터페이스 + 8볼/9볼
src/ai          후보 샷 생성 + 물리 시뮬 평가
src/net         reliable(순서·재전송) + online(MQTT 중계)
src/drills      드릴 정의 + 실제 물리로 검증된 배치(configs.json)
src/meta        프로필/업적/레벨, 커스터마이즈 정의
src/rendering   Three.js (PBR, 그림자, 블룸, GTAO, 카메라 리그)
src/audio       Web Audio 합성 SFX + 생성형 배경 음악 (SampleBank 로 샘플 교체 가능)
src/ui, input   DOM UI, 마우스/터치/키보드
docs/PHYSICS.md 물리 모델 노트
CHANGELOG.md    변경 내역
```

## 배포 (GitHub Pages)
Settings → Pages → Source 를 **GitHub Actions** 로. 워크플로(`.github/workflows/deploy.yml`)가 테스트 → 빌드 → 배포합니다.
`github-pages` 환경의 *Deployment branches* 에 `main` 이 허용되어 있어야 `main` 푸시로 자동 배포됩니다. (아니면 Actions 탭에서 *Run workflow*)

## 튜닝 포인트 / 알려진 한계
- 쿠션 반발계수, 천 마찰, squirt, 점프 바운스 계수는 실측 대비 눈으로 튜닝 필요 (디버그 패널).
- 피사계 심도 미구현. 사운드는 합성음이라 실제 샘플로 교체하면 더 좋아짐 (`audio/engine.ts` 의 `SampleBank`).
- 온라인은 공개 MQTT 브로커(emqx/hivemq/mosquitto)에 의존 — 해당 포트(8084/8884/8081)가 막힌 네트워크에서는 연결 실패.
- 계정/서버 랭킹은 없음(프로필·업적은 기기 로컬 저장).
