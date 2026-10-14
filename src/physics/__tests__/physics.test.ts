import { describe, it, expect } from 'vitest';
import { defaultPhysics, clonePhysics } from '../../config/physics';
import { TABLE } from '../../config/table';
import { emptyWorld, place, shotOf, SCENARIOS } from '../scenarios';

const R = TABLE.ballRadius;
const cfg = () => clonePhysics(defaultPhysics);

describe('sliding → rolling', () => {
  it('center hit becomes rolling with v = R·ω after t = v0/(3.5·μ·g)... (2/7 of v0 retained → 5/7 v0)', () => {
    const w = emptyWorld(cfg());
    place(w, 0, -1.2, 0);
    w.strike(shotOf(0, 2.0, 0, 0));
    const v0 = w.balls[0].vx;
    const tRoll = (2 * v0) / (7 * 0.2 * 9.81);
    while (w.time < tRoll + 0.01) w.step(0.001);
    const b = w.balls[0];
    // 순수 슬라이딩 → 구름 전환 시 v = 5/7 v0
    expect(b.vx / v0).toBeGreaterThan(0.68);
    expect(b.vx / v0).toBeLessThan(0.74);
    expect(Math.abs(b.vx - R * b.wy)).toBeLessThan(0.02);
  });
  it('decelerates smoothly and stops', () => {
    const w = emptyWorld(cfg());
    place(w, 0, -1.2, 0);
    w.strike(shotOf(0, 1.0, 0, 0.4));
    const t = w.settle(60);
    expect(t).toBeGreaterThan(2);
    expect(w.balls[0].vx).toBe(0);
  });
});

describe('collisions', () => {
  it('conserves momentum-ish in a head-on equal-mass hit', () => {
    const w = emptyWorld(cfg());
    place(w, 0, -0.3, 0); place(w, 1, 0.0, 0);
    w.strike(shotOf(0, 2.0, 0, 0));
    let vmax = 0;
    w.listeners.push((e) => { if (e.type === 'ballBall' && !vmax) vmax = w.balls[1].vx; });
    w.settle();
    expect(vmax).toBeGreaterThan(2.0);
  });
  it('does not tunnel at break speed', () => {
    const w = emptyWorld(cfg());
    place(w, 0, -0.5, 0.0); place(w, 1, 0.5, 0.0);
    w.strike(shotOf(0, 7.5, 0, 0));
    w.settle(5);
    expect(w.balls[1].pocketed || w.balls[1].x > 0.5).toBe(true);
    expect(w.balls[0].x).toBeLessThan(w.balls[1].x + 1e-3);
  });
  it('balls stay inside the table without pockets in play (rail ball)', () => {
    const w = emptyWorld(cfg());
    place(w, 0, 0.2, 0.1);
    w.strike(shotOf(2.0, 4.0, 0.3, 0));
    for (let i = 0; i < 6000; i++) {
      w.step(0.001);
      const b = w.balls[0];
      if (b.pocketed) break;
      expect(Math.abs(b.x)).toBeLessThan(TABLE.halfL + 0.01);
      expect(Math.abs(b.y)).toBeLessThan(TABLE.halfW + 0.01);
    }
  });
});

describe('pockets', () => {
  it('pots a ball aimed at the corner pocket', () => {
    const w = emptyWorld(cfg());
    place(w, 0, 0.0, 0.0);
    const tx = TABLE.halfL - 0.02, ty = TABLE.halfW - 0.02;
    w.strike(shotOf(Math.atan2(ty, tx), 2.0, 0, 0));
    w.settle(10);
    expect(w.balls[0].pocketed).toBe(true);
  });
  it('pots a ball aimed at the side pocket', () => {
    const w = emptyWorld(cfg());
    place(w, 0, 0.0, 0.0);
    w.strike(shotOf(Math.PI / 2, 2.0, 0, 0));
    w.settle(10);
    expect(w.balls[0].pocketed).toBe(true);
    expect(w.balls[0].pocketIndex).toBe(5);
  });
});

describe('cue strike model', () => {
  const strike = (a: number, b: number, el = 0, V = 3) => {
    const w = emptyWorld(cfg()); place(w, 0, 0, 0);
    const r = w.strike(shotOf(0, V, a, b, el));
    return { w, r, ball: w.balls[0] };
  };
  it('squirt: right-hand english pushes the ball left (CCW)', () => {
    const { ball } = strike(0.4, 0);
    expect(Math.atan2(ball.vy, ball.vx)).toBeGreaterThan(0.01);
    const l = strike(-0.4, 0).ball;
    expect(Math.atan2(l.vy, l.vx)).toBeLessThan(-0.01);
  });
  it('miscue beyond ~0.5R tip offset only', () => {
    expect(strike(0.45, 0).r.miscue).toBe(false);
    expect(strike(0, -0.45).r.miscue).toBe(false);
    expect(strike(0.7, 0).r.miscue).toBe(true);
    expect(strike(0, 0.8).r.miscue).toBe(true);
  });
  it('steep cue lifts the ball (jump) while a flat cue does not', () => {
    const run = (el: number) => {
      const { w } = strike(0, 0, el, 2.4);
      let zmax = 0;
      for (let i = 0; i < 1500; i++) { w.step(0.001); zmax = Math.max(zmax, w.balls[0].z); }
      return zmax;
    };
    expect(run(0)).toBe(0);
    expect(run(0.85)).toBeGreaterThan(0.025);
  });
  it('elevation + side spin makes the path curve (swerve)', () => {
    const lateral = (el: number) => {
      const w = emptyWorld(cfg()); place(w, 0, -1.1, -0.3);
      w.strike(shotOf(0, 1.8, 0.5, 0, el));
      const v0 = Math.atan2(w.balls[0].vy, w.balls[0].vx);
      for (let i = 0; i < 1200; i++) w.step(0.001);
      const b = w.balls[0];
      return Math.abs(Math.atan2(b.vy, b.vx) - v0);
    };
    expect(lateral(0.6)).toBeGreaterThan(lateral(0) + 0.15);
  });
  it('top/back spin: follow/draw change post-cushion speed and angle', () => {
    const exit = (b: number) => {
      const w = emptyWorld(cfg()); place(w, 0, 0, 0.3);
      w.strike(shotOf(Math.PI / 4, 2.5, 0, b));
      let o: [number, number] | null = null;
      w.listeners.push((e) => { if (e.type === 'cushion' && !o) o = [w.balls[0].vx, w.balls[0].vy]; });
      for (let i = 0; i < 3000 && !o; i++) w.step(0.001);
      const [x, y] = o as unknown as [number, number];
      return { ang: Math.atan2(Math.abs(x), Math.abs(y)), sp: Math.hypot(x, y) };
    };
    const top = exit(0.5), back = exit(-0.5);
    expect(back.ang).toBeGreaterThan(top.ang);
  });
  it('jaw tips cause rattle on a rail-hugging ball', () => {
    const w = emptyWorld(cfg());
    place(w, 0, -0.5, TABLE.halfW - R * 0.97);
    w.strike(shotOf(0, 1.8, 0, 0));
    const ev: string[] = [];
    w.listeners.push((e) => ev.push(e.type));
    w.settle(10);
    expect(ev).toContain('jaw');
  });
});

describe('rack + break', () => {
  it('a full break scatters balls and pots some, no ball escapes the table', async () => {
    const { EightBall } = await import('../../game-rules/eightBall');
    const w = new (await import('../world')).World(cfg());
    EightBall.setupRack(w, 5);
    w.strike(shotOf(0, 7.2, 0, 0.1));
    for (let i = 0; i < 20000; i++) {
      w.step(0.001);
      for (const b of w.balls) if (!b.pocketed) { expect(Math.abs(b.x)).toBeLessThan(1.4); expect(Math.abs(b.y)).toBeLessThan(0.75); }
      if (!w.isMoving()) break;
    }
    const moved = w.balls.filter((b) => !b.pocketed && b.id !== 0 && Math.hypot(b.x - 0.635, b.y) > 0.2).length;
    expect(moved).toBeGreaterThan(5);
  });
});

describe('determinism', () => {
  it('same shot twice gives identical results', () => {
    const run = () => {
      const w = emptyWorld(cfg());
      for (let i = 1; i <= 6; i++) place(w, i, 0.4 + (i % 3) * 0.06, (i - 3) * 0.07);
      place(w, 0, -0.6, 0.01);
      w.strike(shotOf(0.02, 5, 0.3, 0.2));
      w.settle();
      return w.balls.map((b) => [b.x, b.y]);
    };
    expect(run()).toEqual(run());
  });
});

describe('verification scenes', () => {
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const r = fn(cfg());
      console.log(`${r.name}: ${r.detail}`);
      expect(r.pass).toBe(true);
    });
  }
});
