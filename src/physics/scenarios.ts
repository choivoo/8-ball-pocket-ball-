import { TABLE } from '../config/table';
import type { PhysicsConfig } from '../config/physics';
import { World } from './world';
import type { Shot } from './types';

const R = TABLE.ballRadius;

/** 테스트 월드: 공을 모두 포켓 처리해 치우고 필요한 공만 올린다 */
export function emptyWorld(cfg: PhysicsConfig): World {
  const w = new World(cfg);
  for (const b of w.balls) { b.pocketed = true; }
  return w;
}
export function place(w: World, id: number, x: number, y: number) {
  const b = w.balls[id];
  Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, pocketed: false });
}
export function shotOf(angle: number, speed: number, a = 0, b = 0, elevation = 0): Shot {
  return { angle, speed, a, b, elevation };
}

export interface ScenarioResult {
  name: string;
  description: string;
  pass: boolean;
  detail: string;
}

/** 첫 공-공 충돌 이후 T초마다 큐볼/적구 위치를 기록하며 진행 */
function trackAfterContact(w: World, times: number[]) {
  let t0 = -1;
  const out: { t: number; cue: [number, number]; obj: [number, number] }[] = [];
  type Contact = { cue: [number, number]; obj: [number, number]; cueV: [number, number]; objV: [number, number] };
  const hold: { c: Contact | null } = { c: null };
  w.listeners.push((e) => {
    if (e.type === 'ballBall' && t0 < 0) {
      t0 = w.time;
      hold.c = {
        cue: [w.balls[0].x, w.balls[0].y], obj: [w.balls[1].x, w.balls[1].y],
        cueV: [w.balls[0].vx, w.balls[0].vy], objV: [w.balls[1].vx, w.balls[1].vy],
      };
    }
  });
  let k = 0;
  while (w.time < 8 && k < times.length) {
    w.step(w.cfg.dt);
    if (t0 >= 0 && w.time - t0 >= times[k]) {
      out.push({ t: times[k], cue: [w.balls[0].x, w.balls[0].y], obj: [w.balls[1].x, w.balls[1].y] });
      k++;
    }
  }
  return { contact: hold.c, samples: out };
}

/** 스톱샷: 정면 충돌, 슬라이딩 상태(약한 하단 타점으로 구름 전 상태 유지) → 큐볼 거의 정지 */
export function stopShot(cfg: PhysicsConfig): ScenarioResult {
  const w = emptyWorld(cfg);
  place(w, 0, -0.5, 0); place(w, 1, 0.1, 0);
  w.strike(shotOf(0, 2.0, 0, -0.18));
  const r = trackAfterContact(w, [1.0]);
  if (!r.contact) return { name: '스톱샷', description: '', pass: false, detail: '충돌 없음' };
  const cs = Math.hypot(...r.contact.cueV), os = Math.hypot(...r.contact.objV);
  const moved = r.samples[0].cue[0] - r.contact.cue[0];
  return {
    name: '스톱샷', description: '정면 충돌 후 큐볼이 접촉 위치에 멈춰야 함',
    pass: cs < 0.3 && os > 1.5 && Math.abs(moved) < 0.12,
    detail: `충돌 직후 큐볼 ${cs.toFixed(2)} m/s, 적구 ${os.toFixed(2)} m/s, 1초 후 큐볼 이동 ${(moved * 100).toFixed(1)} cm`,
  };
}

/** 끌어치기: 하단 타점 → 충돌 후 큐볼이 뒤로 돌아옴 */
export function drawShot(cfg: PhysicsConfig): ScenarioResult {
  const w = emptyWorld(cfg);
  place(w, 0, -0.35, 0); place(w, 1, 0.0, 0);
  w.strike(shotOf(0, 3.0, 0, -0.4));
  const r = trackAfterContact(w, [1.0]);
  if (!r.contact) return { name: '끌어치기', description: '', pass: false, detail: '충돌 없음' };
  const moved = r.samples[0].cue[0] - r.contact.cue[0];
  return { name: '끌어치기', description: '하단 타점 → 큐볼이 접촉 후 뒤로 되돌아옴', pass: moved < -0.15, detail: `1초 후 큐볼 이동 ${(moved * 100).toFixed(1)} cm (음수 = 후퇴)` };
}

/** 밀어치기: 상단 타점 → 충돌 후에도 전진 */
export function followShot(cfg: PhysicsConfig): ScenarioResult {
  const w = emptyWorld(cfg);
  place(w, 0, -0.6, 0); place(w, 1, 0.0, 0);
  w.strike(shotOf(0, 3.0, 0, 0.5));
  const r = trackAfterContact(w, [1.0]);
  if (!r.contact) return { name: '밀어치기', description: '', pass: false, detail: '충돌 없음' };
  const moved = r.samples[0].cue[0] - r.contact.cue[0];
  return { name: '밀어치기', description: '상단 타점 → 큐볼이 적구를 따라 전진', pass: moved > 0.15, detail: `1초 후 큐볼 이동 ${(moved * 100).toFixed(1)} cm` };
}

/** 컷샷 분리각: 구름 상태 큐볼의 분리각이 약 30° (30도 법칙) */
export function cutShot30(cfg: PhysicsConfig, cutDeg = 30): ScenarioResult {
  const w = emptyWorld(cfg);
  const cut = (cutDeg * Math.PI) / 180;
  place(w, 1, 0.8, 0);
  const gx = 0.8 - 2 * R * Math.cos(cut), gy = 2 * R * Math.sin(cut);
  place(w, 0, gx - 1.5, gy);
  w.strike(shotOf(0, 1.5, 0, 0.0));
  const r = trackAfterContact(w, [0.3, 0.7]);
  const name = `${cutDeg}° 컷샷 (30도 법칙)`;
  if (!r.contact || r.samples.length < 2) return { name, description: '', pass: false, detail: '충돌 없음' };
  const [s1, s2] = r.samples;
  const dev = (Math.atan2(s2.cue[1] - s1.cue[1], s2.cue[0] - s1.cue[0]) * 180) / Math.PI;
  const obj = (Math.atan2(r.contact.objV[1], r.contact.objV[0]) * 180) / Math.PI;
  return {
    name, description: '구름 상태 큐볼의 최종 진행 방향이 원래 조준선에서 약 30° 벗어남 (30도 법칙)',
    pass: Math.abs(dev) > 24 && Math.abs(dev) < 40,
    detail: `큐볼 이탈각 ${Math.abs(dev).toFixed(1)}° (적구 진행각 ${Math.abs(obj).toFixed(1)}°, 큐볼-적구 분리 ${(Math.abs(dev) + Math.abs(obj)).toFixed(0)}°)`,
  };
}

/** 쿠션 반사: 스핀 없는 공이 45° 로 입사 → 반사각 비교, 사이드 스핀 영향 */
export function cushionReflection(cfg: PhysicsConfig, english = 0): ScenarioResult {
  const w = emptyWorld(cfg);
  place(w, 0, -0.3, -0.3);
  const ang = Math.PI / 4;
  w.strike(shotOf(ang, 2.0, english, 0));
  let after: [number, number] | null = null;
  w.listeners.push((e) => {
    if (e.type === 'cushion' && !after) after = [w.balls[0].vx, w.balls[0].vy];
  });
  const before: [number, number] = [w.balls[0].vx, w.balls[0].vy];
  w.settle(4);
  const name = english ? `쿠션 반사각 (사이드 스핀 ${english > 0 ? '우' : '좌'})` : '쿠션 반사각';
  if (!after) return { name, description: '', pass: false, detail: '쿠션 충돌 없음' };
  const [ax, ay] = after as [number, number];
  const inAng = (Math.atan2(Math.abs(before[0]), Math.abs(before[1])) * 180) / Math.PI;
  const outAng = (Math.atan2(Math.abs(ax), Math.abs(ay)) * 180) / Math.PI;
  const sp = Math.hypot(ax, ay) / Math.hypot(before[0], before[1]);
  return {
    name, description: '입사각 45° / 속도 유지율',
    pass: english === 0 ? Math.abs(outAng - inAng) < 12 : Math.abs(outAng - inAng) > 2,
    detail: `입사 ${inAng.toFixed(1)}° → 반사 ${outAng.toFixed(1)}°, 속도 유지 ${(sp * 100).toFixed(0)}%`,
  };
}

export const SCENARIOS: Record<string, (cfg: PhysicsConfig) => ScenarioResult> = {
  stop: stopShot,
  draw: drawShot,
  follow: followShot,
  cut30: (c) => cutShot30(c, 30),
  cushion: (c) => cushionReflection(c, 0),
  cushionEnglish: (c) => cushionReflection(c, 0.5),
};

/** 3D 테스트 랩에서 같은 장면을 눈으로 볼 수 있도록 하는 셋업 */
export interface SceneSetup { name: string; balls: [number, number, number][]; shot: Shot }
export const SCENE_SETUPS: Record<string, SceneSetup> = {
  stop: { name: '스톱샷', balls: [[0, -0.5, 0], [1, 0.1, 0]], shot: shotOf(0, 2.0, 0, -0.18) },
  draw: { name: '끌어치기', balls: [[0, -0.35, 0], [1, 0, 0]], shot: shotOf(0, 3.0, 0, -0.4) },
  follow: { name: '밀어치기', balls: [[0, -0.6, 0], [1, 0, 0]], shot: shotOf(0, 3.0, 0, 0.5) },
  cut30: (() => {
    const cut = Math.PI / 6;
    const gx = 0.8 - 2 * R * Math.cos(cut), gy = 2 * R * Math.sin(cut);
    return { name: '30° 컷샷', balls: [[1, 0.8, 0], [0, gx - 1.5, gy]] as [number, number, number][], shot: shotOf(0, 1.5, 0, 0) };
  })(),
  cushion: { name: '쿠션 반사각 (45°)', balls: [[0, -0.3, -0.3]], shot: shotOf(Math.PI / 4, 2.0, 0, 0) },
  cushionEnglish: { name: '쿠션 + 우측 사이드 스핀', balls: [[0, -0.3, -0.3]], shot: shotOf(Math.PI / 4, 2.0, 0.5, 0) },
  swerve: { name: '마세(엘리베이션 + 사이드 스핀)', balls: [[0, -0.9, -0.2]], shot: shotOf(0.0, 1.6, 0.45, 0, 0.6) },
  jump: { name: '점프샷', balls: [[0, -0.9, 0], [1, -0.35, 0]], shot: shotOf(0, 2.4, 0, -0.1, 0.85) },
  break: { name: '브레이크', balls: [], shot: shotOf(0, 7.2, 0, 0.1) },
};
