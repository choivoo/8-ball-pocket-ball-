import { TABLE, HEAD_X } from '../config/table';
import type { PhysicsConfig } from '../config/physics';
import { World } from '../physics/world';
import { ShotRecorder } from '../game-rules/report';
import type { RuleSet, RuleState } from '../game-rules/RuleSet';
import type { Shot, Ball } from '../physics/types';
import { Rng } from '../physics/rng';

const R = TABLE.ballRadius;
export type AiLevel = 0 | 1 | 2;

const LEVELS = [
  { name: '초급', candidates: 8, angleSigma: 2.4, speedSigma: 0.14, english: false, mistakeChance: 0.3 },
  { name: '중급', candidates: 26, angleSigma: 0.7, speedSigma: 0.06, english: true, mistakeChance: 0.08 },
  { name: '고급', candidates: 70, angleSigma: 0.14, speedSigma: 0.025, english: true, mistakeChance: 0 },
];
export const AI_LEVEL_NAMES = LEVELS.map((l) => l.name);

interface Candidate { shot: Shot; label: string }
interface Scored extends Candidate { score: number }

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function lineClear(balls: Ball[], ax: number, ay: number, bx: number, by: number, ignore: number[], margin = 2 * R * 0.98): boolean {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (const b of balls) {
    if (b.pocketed || ignore.includes(b.id)) continue;
    const t = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.y - ay) * dy) / len2));
    const px = ax + dx * t - b.x, py = ay + dy * t - b.y;
    if (px * px + py * py < margin * margin) return false;
  }
  return true;
}

export class PoolAI {
  private sim: World;
  private rng = new Rng(Date.now() & 0xffff);
  constructor(private cfg: PhysicsConfig, public level: AiLevel, private rules: RuleSet) {
    this.sim = new World({ ...cfg, dt: 0.002 });
  }

  /** 후보 샷 생성 */
  private candidates(world: World, state: RuleState, cuePos: { x: number; y: number }, includeSpin: boolean): Candidate[] {
    const balls = world.balls;
    const onTable = balls.filter((b) => !b.pocketed).map((b) => b.id);
    const targets = this.rules.legalTargets(state, onTable);
    const out: Candidate[] = [];
    const geom = world.geom;
    const bs = balls.map((b) => ({ ...b }));
    bs[0].x = cuePos.x; bs[0].y = cuePos.y;
    for (const tid of targets) {
      const t = bs[tid];
      for (let pi = 0; pi < geom.pockets.length; pi++) {
        const p = geom.pockets[pi];
        const px = p.mx + p.ax * 0.015, py = p.my + p.ay * 0.015;
        let ux = px - t.x, uy = py - t.y;
        const dTP = Math.hypot(ux, uy);
        ux /= dTP; uy /= dTP;
        const gx = t.x - ux * 2 * R, gy = t.y - uy * 2 * R;
        // 컷 각도
        let cx = gx - cuePos.x, cy = gy - cuePos.y;
        const dCG = Math.hypot(cx, cy);
        if (dCG < 1e-4) continue;
        cx /= dCG; cy /= dCG;
        const cos = cx * ux + cy * uy;
        if (cos < 0.26) continue; // 컷 각도 > 75°
        if (Math.abs(gx) > TABLE.halfL - R || Math.abs(gy) > TABLE.halfW - R) continue;
        if (!lineClear(bs, cuePos.x, cuePos.y, gx, gy, [0, tid])) continue;
        if (!lineClear(bs, t.x, t.y, px, py, [0, tid], 2 * R * 0.95)) continue;
        const ang = Math.atan2(cy, cx);
        const dist = dCG + dTP;
        const v = Math.min(7.2, 1.15 + dist * 1.45 + (1 - cos) * 1.4);
        const cueV = v / 1.37; // 큐 스피드
        const variants: [number, number][] = [[0, 0]];
        if (includeSpin) variants.push([0, 0.35], [0, -0.35], [0.25, 0], [-0.25, 0]);
        for (const [a, b] of variants) out.push({ shot: { angle: ang, speed: cueV, a, b, elevation: 0 }, label: `${tid}→P${pi}` });
      }
    }
    // 폴백: 가장 가까운 합법 공을 직접 맞히기 (안전 샷)
    const sorted = targets.slice().sort((a, b) => Math.hypot(bs[a].x - cuePos.x, bs[a].y - cuePos.y) - Math.hypot(bs[b].x - cuePos.x, bs[b].y - cuePos.y));
    for (const tid of sorted.slice(0, 3)) {
      const t = bs[tid];
      const ang = Math.atan2(t.y - cuePos.y, t.x - cuePos.x);
      for (const sp of [1.3, 2.4]) out.push({ shot: { angle: ang, speed: sp, a: 0, b: 0, elevation: 0 }, label: `safe${tid}` });
    }
    return out;
  }

  private evaluate(world: World, state: RuleState, cand: Candidate, cuePos: { x: number; y: number }): number {
    const sim = this.sim;
    sim.restore(world.snapshot());
    sim.balls[0].x = cuePos.x; sim.balls[0].y = cuePos.y; sim.balls[0].pocketed = false;
    sim.rng.state = 777;
    const rec = new ShotRecorder();
    rec.attach(sim);
    sim.strike(cand.shot);
    sim.settle(18, 0.002);
    rec.detach();
    const res = this.rules.evaluate(state, rec.report);
    const me = state.turn;
    let score = 0;
    if (res.state.winner === me) return 10000;
    if (res.state.winner !== null) return -10000;
    const objPot = rec.report.pocketed.filter((id) => id !== 0);
    for (const id of objPot) {
      const own = this.rules.isOwn(state, id);
      score += own ? 100 : -45;
    }
    if (res.fouls.length) score -= 320;
    else if (res.state.turn !== me) score -= 40;
    else {
      // 다음 샷 포지션: 큐볼에서 합법 공까지 가까움 + 막히지 않음
      const cue = sim.balls[0];
      if (!cue.pocketed) {
        const onTable = sim.balls.filter((b) => !b.pocketed).map((b) => b.id);
        const targets = this.rules.legalTargets(res.state, onTable);
        let best = 0;
        for (const tid of targets) {
          const t = sim.balls[tid];
          const d = Math.hypot(t.x - cue.x, t.y - cue.y);
          const clear = lineClear(sim.balls, cue.x, cue.y, t.x, t.y, [0, tid]);
          best = Math.max(best, (clear ? 30 : 8) * (1 - Math.min(1, d / 2.4)));
        }
        score += best;
      }
    }
    // 큐볼이 포켓 근처에서 정지하면 감점 (미세)
    return score;
  }

  /** 최적 샷 선택 (비동기, 프레임을 막지 않도록 조각내어 실행) */
  async chooseShot(world: World, state: RuleState, cuePos: { x: number; y: number }, onProgress?: (p: number) => void): Promise<Shot> {
    const L = LEVELS[this.level];
    this.sim.cfg = { ...this.cfg, dt: 0.002 }; this.sim.refresh();
    if (!state.breakDone) {
      return { angle: Math.atan2(0 - cuePos.y, TABLE.halfL / 2 - cuePos.x) + (this.rng.next() - 0.5) * 0.01, speed: this.level === 0 ? 4.3 : this.level === 1 ? 5.3 : 5.9, a: 0, b: 0.15, elevation: 0 };
    }
    let cands = this.candidates(world, state, cuePos, L.english);
    // 후보가 모두 걸러졌다면 무작위 안전 샷
    if (cands.length === 0) {
      return { angle: this.rng.next() * Math.PI * 2, speed: 1.6, a: 0, b: 0, elevation: 0 };
    }
    // 후보 수 제한: 샷 난이도(컷각 작고 거리 짧은) 순으로 정렬하지 않고 균등 추출
    if (cands.length > L.candidates) {
      const step = cands.length / L.candidates;
      cands = Array.from({ length: L.candidates }, (_, i) => cands[Math.floor(i * step)]);
    }
    const scored: Scored[] = [];
    for (let i = 0; i < cands.length; i++) {
      scored.push({ ...cands[i], score: this.evaluate(world, state, cands[i], cuePos) });
      if (i % 2 === 1) { onProgress?.(i / cands.length); await tick(); }
    }
    scored.sort((a, b) => b.score - a.score);
    let pick = scored[0];
    if (this.rng.next() < L.mistakeChance && scored.length > 2) pick = scored[Math.min(scored.length - 1, 1 + Math.floor(this.rng.next() * 3))];
    // 난이도별 오차
    const sh = { ...pick.shot };
    sh.angle += (this.rng.gauss() * L.angleSigma * Math.PI) / 180;
    sh.speed *= 1 + this.rng.gauss() * L.speedSigma;
    sh.speed = Math.max(0.4, Math.min(this.cfg.maxCueSpeed, sh.speed));
    return sh;
  }

  /** 볼 인 핸드 위치 선택 */
  chooseCuePosition(world: World, state: RuleState, zone: 'head' | 'any'): { x: number; y: number } {
    const balls = world.balls.map((b) => ({ ...b }));
    const onTable = balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
    const targets = state.breakDone ? this.rules.legalTargets(state, [0, ...onTable]) : [];
    const geom = world.geom;
    const valid = (x: number, y: number) => {
      if (Math.abs(x) > TABLE.halfL - R * 1.2 || Math.abs(y) > TABLE.halfW - R * 1.2) return false;
      if (zone === 'head' && x > HEAD_X) return false;
      for (const b of balls) if (b.id !== 0 && !b.pocketed && Math.hypot(b.x - x, b.y - y) < 2.1 * R) return false;
      return true;
    };
    if (zone === 'head' || targets.length === 0) {
      return { x: HEAD_X, y: zone === 'head' ? (this.rng.next() - 0.5) * 0.3 : 0 };
    }
    let best: { x: number; y: number } | null = null, bestScore = -1;
    for (const tid of targets) {
      const t = balls[tid];
      for (const p of geom.pockets) {
        const px = p.mx + p.ax * 0.015, py = p.my + p.ay * 0.015;
        let ux = px - t.x, uy = py - t.y;
        const d = Math.hypot(ux, uy);
        ux /= d; uy /= d;
        for (const back of [0.35, 0.55, 0.8]) {
          const cx = t.x - ux * (2 * R + back), cy = t.y - uy * (2 * R + back);
          if (!valid(cx, cy)) continue;
          if (!lineClear(balls, cx, cy, t.x - ux * 2 * R, t.y - uy * 2 * R, [0, tid])) continue;
          if (!lineClear(balls, t.x, t.y, px, py, [0, tid], 2 * R * 0.95)) continue;
          const sc = 1 / (0.5 + d) + back * 0.1;
          if (sc > bestScore) { bestScore = sc; best = { x: cx, y: cy }; }
        }
      }
    }
    return best ?? { x: HEAD_X, y: 0 };
  }
}
