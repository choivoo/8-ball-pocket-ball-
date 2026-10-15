import { TABLE } from '../config/table';
import type { PhysicsConfig } from '../config/physics';
import { World } from '../physics/world';
import { Rng } from '../physics/rng';
import type { Shot } from '../physics/types';
import type { AiLevel } from './ai';

const R = TABLE.ballRadius;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const LEVELS = [
  { candidates: 14, angleSigma: 2.2, speedSigma: 0.14, mistake: 0.3 },
  { candidates: 40, angleSigma: 0.7, speedSigma: 0.06, mistake: 0.08 },
  { candidates: 110, angleSigma: 0.15, speedSigma: 0.025, mistake: 0 },
];

/** 알까기 AI: 후보 샷(직접 조준 + 포켓 방향 고스트볼)을 실제 물리로 시뮬레이션해 평가한다 */
export class AlgakkiAI {
  private sim: World;
  private rng = new Rng((Date.now() ^ 0x5a5a) & 0xffff);
  constructor(private cfg: PhysicsConfig, public level: AiLevel) {
    this.sim = new World({ ...cfg, dt: 0.002 });
  }

  private pocketDist(x: number, y: number, world: World) {
    let d = 1e9;
    for (const p of world.geom.pockets) d = Math.min(d, Math.hypot(p.mx - x, p.my - y));
    return d;
  }

  private evaluate(world: World, shot: Shot, myId: number, oppId: number): number {
    const sim = this.sim;
    sim.restore(world.snapshot());
    sim.rng.state = 4242;
    let pocketed: number[] = [];
    sim.listeners = [(e) => { if (e.type === 'pocket') pocketed.push(e.id); }];
    sim.strike({ ...shot, ball: myId });
    sim.settle(20, 0.002);
    if (pocketed.includes(myId)) return -10000;
    if (pocketed.includes(oppId)) return 10000;
    const me = sim.balls[myId], op = sim.balls[oppId];
    // 내 공은 포켓에서 멀수록, 상대 공은 포켓에 가까울수록 좋다. 두 공이 너무 가까우면(상대가 쉽게 밀어 넣음) 감점
    const dMe = this.pocketDist(me.x, me.y, sim);
    const dOp = this.pocketDist(op.x, op.y, sim);
    const gap = Math.hypot(me.x - op.x, me.y - op.y);
    let score = 120 * Math.min(dMe, 0.8) + 220 * (1 - Math.min(1, dOp));
    if (dMe < 0.3) score -= 150;
    if (gap < 0.5 && dMe < 0.6) score -= 60; // 내 공이 상대 앞에서 노출
    return score;
  }

  async chooseShot(world: World, myId: number, oppId: number): Promise<Shot> {
    const L = LEVELS[this.level];
    this.sim.cfg = { ...this.cfg, dt: 0.002 };
    this.sim.refresh();
    const me = world.balls[myId], op = world.balls[oppId];
    const direct = Math.atan2(op.y - me.y, op.x - me.x);
    const angles: number[] = [direct];
    // 포켓 방향 고스트볼: 상대 공이 포켓으로 가도록 맞히는 각
    for (const p of world.geom.pockets) {
      let ux = p.mx - op.x, uy = p.my - op.y;
      const d = Math.hypot(ux, uy) || 1;
      ux /= d; uy /= d;
      const gx = op.x - ux * 2 * R, gy = op.y - uy * 2 * R;
      angles.push(Math.atan2(gy - me.y, gx - me.x));
    }
    // 쿠션을 먼저 맞히는 뱅크 후보 (각도 스캔)
    for (let k = 0; k < 12; k++) angles.push(direct + ((k - 5.5) * 6 * Math.PI) / 180);
    const speeds = [1.4, 2.2, 3.2, 4.4, 5.8, 7.2];
    const cands: Shot[] = [];
    for (const a of angles) for (const v of speeds) for (const b of this.level === 0 ? [0] : [0, 0.3, -0.3]) cands.push({ angle: a, speed: v, a: 0, b, elevation: 0 });
    // 후보 수 제한 (균등 추출)
    let pick = cands;
    if (cands.length > L.candidates) {
      const step = cands.length / L.candidates;
      pick = Array.from({ length: L.candidates }, (_, i) => cands[Math.floor(i * step)]);
    }
    const scored: { shot: Shot; score: number }[] = [];
    for (let i = 0; i < pick.length; i++) {
      scored.push({ shot: pick[i], score: this.evaluate(world, pick[i], myId, oppId) });
      if (i % 3 === 2) await tick();
    }
    scored.sort((x, y) => y.score - x.score);
    let best = scored[0];
    if (this.rng.next() < L.mistake && scored.length > 3) best = scored[1 + Math.floor(this.rng.next() * 3)];
    const sh = { ...best.shot };
    sh.angle += (this.rng.gauss() * L.angleSigma * Math.PI) / 180;
    sh.speed = Math.max(0.5, Math.min(this.cfg.maxCueSpeed, sh.speed * (1 + this.rng.gauss() * L.speedSigma)));
    return sh;
  }
}
