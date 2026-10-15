import { describe, it, expect } from 'vitest';
import { EightBall } from './eightBall';
import { NineBall } from './nineBall';
import type { ShotReport } from './RuleSet';

const rep = (o: Partial<ShotReport>): ShotReport => ({ firstContact: null, pocketed: [], railAfterContact: false, railBalls: [], cueRailsBeforeContact: 0, miscue: false, ...o });
const afterBreak = () => {
  const s = EightBall.init();
  s.breakDone = true; s.ballInHand = false;
  return s;
};

describe('8-ball rules', () => {
  it('assigns groups on first legal pocket', () => {
    const r = EightBall.evaluate(afterBreak(), rep({ firstContact: 3, pocketed: [3], railAfterContact: true }));
    expect(r.state.groups[0]).toBe('solid');
    expect(r.state.groups[1]).toBe('stripe');
    expect(r.state.turn).toBe(0);
  });
  it('wrong first contact is a foul with ball in hand', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe'];
    const r = EightBall.evaluate(s, rep({ firstContact: 10, railAfterContact: true }));
    expect(r.fouls.length).toBe(1);
    expect(r.state.turn).toBe(1);
    expect(r.state.ballInHand).toBe(true);
  });
  it('no rail after contact is a foul', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe'];
    const r = EightBall.evaluate(s, rep({ firstContact: 2 }));
    expect(r.fouls[0]).toMatch(/쿠션/);
  });
  it('scratch is a foul', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe'];
    const r = EightBall.evaluate(s, rep({ firstContact: 2, pocketed: [0, 2], railAfterContact: true }));
    expect(r.fouls.length).toBeGreaterThan(0);
    expect(r.state.turn).toBe(1);
  });
  it('early 8 loses', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe'];
    const r = EightBall.evaluate(s, rep({ firstContact: 8, pocketed: [8], railAfterContact: true }));
    expect(r.state.winner).toBe(1);
  });
  it('legal 8 wins after clearing group', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe']; s.pocketed = [1, 2, 3, 4, 5, 6, 7];
    const r = EightBall.evaluate(s, rep({ firstContact: 8, pocketed: [8], railAfterContact: true }));
    expect(r.state.winner).toBe(0);
  });
  it('8 with scratch loses', () => {
    const s = afterBreak(); s.groups = ['solid', 'stripe']; s.pocketed = [1, 2, 3, 4, 5, 6, 7];
    const r = EightBall.evaluate(s, rep({ firstContact: 8, pocketed: [0, 8], railAfterContact: true }));
    expect(r.state.winner).toBe(1);
  });
  it('break without 4 rails is illegal', () => {
    const r = EightBall.evaluate(EightBall.init(), rep({ firstContact: 1, railBalls: [0, 1], railAfterContact: true }));
    expect(r.fouls.length).toBe(1);
    expect(r.state.turn).toBe(1);
  });
  it('legal break pocket keeps turn on open table', () => {
    const r = EightBall.evaluate(EightBall.init(), rep({ firstContact: 1, pocketed: [9], railBalls: [1, 2, 3, 4], railAfterContact: true }));
    expect(r.fouls.length).toBe(0);
    expect(r.state.turn).toBe(0);
    expect(r.state.groups[0]).toBeNull();
  });
});

describe('9-ball rules', () => {
  const st = () => { const s = NineBall.init(); s.breakDone = true; s.ballInHand = false; return s; };
  it('first contact must be the lowest ball', () => {
    const r = NineBall.evaluate(st(), rep({ firstContact: 3, railAfterContact: true }));
    expect(r.fouls.length).toBe(1);
    expect(r.state.ballInHand).toBe(true);
    expect(r.state.turn).toBe(1);
  });
  it('legal pot keeps the turn; lowest advances as balls are potted', () => {
    const s = st(); s.pocketed = [1, 2];
    const r = NineBall.evaluate(s, rep({ firstContact: 3, pocketed: [3], railAfterContact: true }));
    expect(r.fouls.length).toBe(0);
    expect(r.state.turn).toBe(0);
    expect(NineBall.legalTargets(r.state, [0, 4, 5, 9])).toEqual([4]);
  });
  it('legally potting the 9 wins, even on the break', () => {
    const r = NineBall.evaluate(NineBall.init(), rep({ firstContact: 1, pocketed: [9], railBalls: [1, 2, 3, 4], railAfterContact: true }));
    expect(r.state.winner).toBe(0);
  });
  it('9 potted on a foul is re-spotted, not a win', () => {
    const s = st();
    const r = NineBall.evaluate(s, rep({ firstContact: 2, pocketed: [9], railAfterContact: true }));
    expect(r.state.winner).toBeNull();
    expect(r.respot).toBe(9);
  });
  it('combination: pot the 9 via another ball after legal first contact wins', () => {
    const r = NineBall.evaluate(st(), rep({ firstContact: 1, pocketed: [9], railAfterContact: true }));
    expect(r.state.winner).toBe(0);
  });
});
