import { describe, it, expect } from 'vitest';
import { defaultPhysics, clonePhysics } from '../config/physics';
import { World } from '../physics/world';
import { ShotRecorder } from '../game-rules/report';
import { buildDrills, starsFor } from './drills';

describe('drills', () => {
  const drills = buildDrills();
  it('all 10 drills are available', () => {
    expect(drills.map((d) => d.id).sort()).toEqual(['bank', 'break', 'cut', 'draw', 'jump', 'position', 'rails3', 'runout', 'stop', 'straight']);
  });
  for (const def of drills.filter((d) => !['runout', 'break'].includes(d.id))) {
    it(`${def.id}: every shipped setup is solvable by its reference shot and judged as a success`, () => {
      for (let i = 0; i < def.attempts; i++) {
        const w = new World({ ...clonePhysics(defaultPhysics), dt: 0.001 });
        const cfg = def.setup(w, i)!;
        expect(cfg).toBeTruthy();
        const rec = new ShotRecorder(); rec.attach(w);
        const cue0 = { x: w.balls[0].x, y: w.balls[0].y };
        let contact: { x: number; y: number } | null = null;
        w.listeners.push((e) => { if (e.type === 'ballBall' && (e.a === 0 || e.b === 0) && !contact) contact = { x: w.balls[0].x, y: w.balls[0].y }; });
        w.rng.state = 99;
        w.strike(cfg.sol);
        w.settle(25, 0.001);
        const r = def.judge({ rep: rec.report, world: w, contact, cue0, cfg });
        expect(r.points, `${def.id}#${i}: ${r.msg}`).toBeGreaterThanOrEqual(0.9);
      }
    });
  }
  it('star thresholds', () => {
    expect(starsFor(5, 5)).toBe(3);
    expect(starsFor(3, 5)).toBe(2);
    expect(starsFor(2, 5)).toBe(1);
    expect(starsFor(1, 5)).toBe(0);
  });
});
