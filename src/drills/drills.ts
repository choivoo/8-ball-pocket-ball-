import { HEAD_X, TABLE } from '../config/table';
import type { World } from '../physics/world';
import type { Shot } from '../physics/types';
import { Rng } from '../physics/rng';
import type { ShotReport } from '../game-rules/RuleSet';
import cfgA from './configs.json';
import cfgB from './configs3.json';

const R = TABLE.ballRadius;

export interface DrillCfg { balls: [number, number, number][]; cue: [number, number]; target?: [number, number, number]; sol: Shot }
export interface Attempt { rep: ShotReport; world: World; contact: { x: number; y: number } | null; cue0: { x: number; y: number }; cfg: DrillCfg | null }
export interface DrillDef {
  id: string; name: string; desc: string;
  attempts: number; maxPoints: number;
  /** 배치를 만든다 (i = 시도 번호). 반환값은 목표 링 등 표시에 사용 */
  setup(w: World, i: number): DrillCfg | null;
  judge(a: Attempt): { points: number; msg: string };
  /** true 면 도중에 조기 종료 */
  done?(w: World, pointsSoFar: number): boolean;
  /** 샷 사이에 판을 리셋하지 않는다 (런아웃) */
  persistent?: boolean;
}

const all = { ...(cfgA as unknown as Record<string, DrillCfg[]>), ...(cfgB as unknown as Record<string, DrillCfg[]>) };

export function placeCfg(w: World, cfg: DrillCfg) {
  for (const b of w.balls) { b.pocketed = true; b.pocketTime = -1e6; b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; b.z = 0; b.qx = b.qy = b.qz = 0; b.qw = 1; }
  for (const [id, x, y] of cfg.balls) { const b = w.balls[id]; b.pocketed = false; b.x = x; b.y = y; }
  const c = w.balls[0]; c.pocketed = false; c.x = cfg.cue[0]; c.y = cfg.cue[1];
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const legalPot = (a: Attempt) => a.rep.firstContact === 1 && a.world.balls[1].pocketed && !a.rep.pocketed.includes(0);

function configDrill(key: string, name: string, desc: string, judge: DrillDef['judge']): DrillDef | null {
  const list = all[key];
  if (!list || list.length === 0) return null;
  return {
    id: key, name, desc, attempts: list.length, maxPoints: list.length,
    setup(w, i) { const c = list[i % list.length]; placeCfg(w, c); return c; },
    judge,
  };
}

export function buildDrills(): DrillDef[] {
  const out: (DrillDef | null)[] = [
    configDrill('straight', '직선 포켓', '코너 포켓 앞 일직선 — 거리가 점점 멀어집니다', (a) => legalPot(a) ? { points: 1, msg: '성공!' } : { points: 0, msg: '실패' }),
    configDrill('cut', '컷샷', '15°~55° 각도 컷샷으로 포켓', (a) => legalPot(a) ? { points: 1, msg: '성공!' } : { points: 0, msg: '실패' }),
    configDrill('bank', '뱅크샷', '쿠션을 한 번 맞고 들어가는 샷', (a) => legalPot(a) && a.rep.railBalls.includes(1) ? { points: 1, msg: '뱅크 성공!' } : a.world.balls[1].pocketed ? { points: 0.4, msg: '들어갔지만 쿠션을 맞지 않았어요' } : { points: 0, msg: '실패' }),
    configDrill('stop', '스톱샷', '포켓하고 큐볼이 그 자리에 멈추게 (12cm 이내)', (a) => {
      if (!legalPot(a) || !a.contact) return { points: 0, msg: '실패' };
      const d = dist(a.world.balls[0], a.contact);
      return d < 0.12 ? { points: 1, msg: `정지 성공! (${(d * 100).toFixed(0)}cm)` } : d < 0.25 ? { points: 0.6, msg: `조금 굴러갔어요 (${(d * 100).toFixed(0)}cm)` } : { points: 0.4, msg: '포켓은 성공, 큐볼이 너무 굴러갔어요' };
    }),
    configDrill('draw', '끌어치기', '포켓하고 큐볼이 30cm 이상 되돌아오게', (a) => {
      if (!legalPot(a) || !a.contact) return { points: 0, msg: '실패' };
      const c = a.world.balls[0];
      const back = (c.x - a.contact.x) * (a.cue0.x - a.contact.x) + (c.y - a.contact.y) * (a.cue0.y - a.contact.y) > 0 ? dist(c, a.contact) : 0;
      return back >= 0.3 ? { points: 1, msg: `끌림 ${(back * 100).toFixed(0)}cm!` } : back >= 0.1 ? { points: 0.6, msg: `조금 끌렸어요 (${(back * 100).toFixed(0)}cm)` } : { points: 0.4, msg: '포켓 성공, 끌림 부족' };
    }),
    configDrill('position', '포지션 플레이', '포켓하고 큐볼을 초록 원 안에 세우기', (a) => {
      if (!legalPot(a)) return { points: 0, msg: '실패' };
      const t = a.cfg?.target; const c = a.world.balls[0];
      if (t && !c.pocketed && Math.hypot(c.x - t[0], c.y - t[1]) < t[2]) return { points: 1, msg: '완벽한 포지션!' };
      return { points: 0.4, msg: '포켓 성공, 포지션이 벗어났어요' };
    }),
    configDrill('jump', '점프샷', '앞의 공을 뛰어넘어 목적구를 맞히기 (큐 각도 ↑)', (a) => a.rep.firstContact === 1 && !a.rep.pocketed.includes(0) ? { points: 1, msg: '점프 성공!' } : a.rep.firstContact === 2 ? { points: 0, msg: '막는 공을 맞혔어요' } : { points: 0, msg: '실패' }),
    configDrill('rails3', '3쿠션', '큐볼이 쿠션 3번 이상 맞고 목적구에 닿게', (a) => {
      if (a.rep.firstContact !== 1) return { points: 0, msg: '목적구를 못 맞혔어요' };
      const n = a.rep.cueRailsBeforeContact;
      return n >= 3 ? { points: 1, msg: `${n}쿠션 성공!` } : n === 2 ? { points: 0.5, msg: '2쿠션 — 한 번 더!' } : { points: 0.2, msg: '쿠션이 부족해요' };
    }),
    {
      id: 'runout', name: '5볼 런아웃', desc: '10샷 안에 5개의 공을 모두 포켓 (샷 사이 배치 유지)', attempts: 10, maxPoints: 5, persistent: true,
      setup(w, i) {
        if (i > 0) return null;
        const rng = new Rng(777 + Math.floor(Date.now() / 86400000)); // 매일 바뀌는 배치
        const pos: [number, number][] = [];
        while (pos.length < 6) {
          const p: [number, number] = [rng.range(-1.0, 1.0), rng.range(-0.46, 0.46)];
          if (pos.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.22)) pos.push(p);
        }
        const cfg: DrillCfg = { balls: pos.slice(1).map((p, k) => [k + 1, p[0], p[1]] as [number, number, number]), cue: pos[0], sol: { angle: 0, speed: 2, a: 0, b: 0, elevation: 0 } };
        placeCfg(w, cfg);
        return cfg;
      },
      judge(a) {
        const n = a.rep.pocketed.filter((id) => id !== 0).length;
        return { points: n, msg: n ? `${n}개 포켓!` : '아쉬워요' };
      },
      done(w) { return w.balls.slice(1, 6).every((b) => b.pocketed); },
    },
    {
      id: 'break', name: '브레이크 챌린지', desc: '3번의 브레이크로 최대한 많은 공을 포켓', attempts: 3, maxPoints: 3,
      setup(w, i) {
        // 랙은 Game 쪽에서 EightBall.setupRack 으로 만든다 (cfg 없음)
        void w; void i; return null;
      },
      judge(a) {
        const n = a.rep.pocketed.filter((id) => id !== 0 && id !== 8).length;
        const sc = a.rep.pocketed.includes(0) ? Math.max(0, n - 1) : n;
        return { points: Math.min(3, sc) / 3 * 1, msg: `${n}개 포켓${a.rep.pocketed.includes(0) ? ' (스크래치 -1)' : ''}` };
      },
    },
  ];
  return out.filter((d): d is DrillDef => !!d);
}

export const starsFor = (points: number, max: number) => {
  const r = points / max;
  return r >= 0.8 ? 3 : r >= 0.6 ? 2 : r >= 0.4 ? 1 : 0;
};

/** 큐볼이 놓일 빈 자리를 찾는다 (스크래치 후 리스폰) */
export function freeSpot(w: World, x = HEAD_X, y = 0): { x: number; y: number } {
  const ok = (px: number, py: number) => w.balls.every((b) => b.id === 0 || b.pocketed || Math.hypot(b.x - px, b.y - py) > 2.2 * R);
  if (ok(x, y)) return { x, y };
  for (let r = 0.06; r < 1.2; r += 0.06) for (let a = 0; a < 6.28; a += 0.5) {
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (Math.abs(px) < TABLE.halfL - 0.1 && Math.abs(py) < TABLE.halfW - 0.1 && ok(px, py)) return { x: px, y: py };
  }
  return { x, y };
}
