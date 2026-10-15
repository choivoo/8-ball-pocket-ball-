import { describe, it, expect } from 'vitest';
import { World } from '../physics/world';
import { defaultPhysics, clonePhysics } from '../config/physics';
import { EightBall } from '../game-rules/eightBall';
import { NineBall } from '../game-rules/nineBall';
import type { RuleSet } from '../game-rules/RuleSet';
import { ShotRecorder } from '../game-rules/report';
import { PoolAI, type AiLevel } from './ai';

async function playGame(levels: [AiLevel, AiLevel], seed: number, maxShots = 90, rules: RuleSet = EightBall) {
  const cfg = clonePhysics(defaultPhysics);
  const w = new World(cfg);
  rules.setupRack(w, seed);
  w.rng.state = seed;
  let st = rules.init();
  const ais = [new PoolAI(cfg, levels[0], rules), new PoolAI(cfg, levels[1], rules)];
  const rec = new ShotRecorder();
  let pots = 0, fouls = 0, shots = 0;
  while (st.winner === null && shots < maxShots) {
    const ai = ais[st.turn];
    const cue = w.balls[0];
    if (st.ballInHand) {
      const p = ai.chooseCuePosition(w, st, st.inHandZone);
      cue.pocketed = false; cue.x = p.x; cue.y = p.y; st.ballInHand = false;
    }
    const shot = await ai.chooseShot(w, st, { x: cue.x, y: cue.y });
    rec.attach(w);
    w.strike(shot);
    w.settle(40, 0.001);
    rec.detach();
    const res = rules.evaluate(st, rec.report);
    pots += rec.report.pocketed.filter((i) => i !== 0).length;
    fouls += res.fouls.length;
    st = res.state;
    if (cue.pocketed) { cue.pocketed = false; cue.x = -0.63; cue.y = 0; }
    if (res.respot !== null) { const b = w.balls[res.respot]; b.pocketed = false; b.x = 0.635; b.y = 0; }
    shots++;
  }
  return { winner: st.winner, shots, pots, fouls, reason: st.endReason };
}

describe('AI', () => {
  it('plays 9-ball to completion', async () => {
    const r = await playGame([2, 1], 7, 80, NineBall);
    console.log('9-ball hard vs mid:', JSON.stringify(r));
    expect(r.winner).not.toBeNull();
  }, 200000);
  it('plays a full game vs itself and pots balls', async () => {
    const r = await playGame([2, 2], 11);
    console.log('AI(hard) vs AI(hard):', JSON.stringify(r));
    expect(r.pots).toBeGreaterThan(4);
  }, 180000);
  it('hard AI beats easy AI more often', async () => {
    let hardWins = 0;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const r = await playGame([2, 0], 100 + i);
      console.log('hard vs easy', JSON.stringify(r));
      if (r.winner === 0) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(2);
  }, 400000);
});
