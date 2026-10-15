import { describe, it, expect } from 'vitest';
import { Algakki, rackAlgakki, BLACK, WHITE } from './algakki';
import { World } from '../physics/world';
import { defaultPhysics, clonePhysics } from '../config/physics';
import { ShotRecorder } from './report';
import { AlgakkiAI } from '../ai/algakkiAi';
import type { ShotReport } from './RuleSet';

const rep = (o: Partial<ShotReport>): ShotReport => ({ firstContact: null, pocketed: [], railAfterContact: false, railBalls: [], cueRailsBeforeContact: 0, miscue: false, ...o });

describe('algakki rules', () => {
  const st = (blackSeat: 0 | 1) => { const s = Algakki.init(); s.ballOf = blackSeat === 0 ? [BLACK, WHITE] : [WHITE, BLACK]; s.turn = blackSeat; return s; };
  it('pocketing the opponent ball wins', () => {
    const r = Algakki.evaluate(st(0), rep({ pocketed: [WHITE] }));
    expect(r.state.winner).toBe(0);
  });
  it('pocketing your own ball loses', () => {
    const r = Algakki.evaluate(st(0), rep({ pocketed: [BLACK] }));
    expect(r.state.winner).toBe(1);
  });
  it('both balls pocketed on the same shot: the shooter loses', () => {
    const r = Algakki.evaluate(st(1), rep({ pocketed: [BLACK, WHITE] }));
    expect(r.state.winner).toBe(0); // seat1 owns white=0... shooter(seat1) own=BLACK? see below
  });
  it('nothing pocketed passes the turn', () => {
    const r = Algakki.evaluate(st(0), rep({}));
    expect(r.state.winner).toBeNull();
    expect(r.state.turn).toBe(1);
  });
  it('rack contains only the two balls', () => {
    const w = new World(clonePhysics(defaultPhysics));
    rackAlgakki(w, 3);
    expect(w.balls.filter((b) => !b.pocketed).map((b) => b.id).sort()).toEqual([0, 8]);
  });
});

describe('algakki physics + AI', () => {
  it('striking the black ball (id 8) moves it, not the cue ball', () => {
    const w = new World(clonePhysics(defaultPhysics));
    rackAlgakki(w, 2);
    const x0 = w.balls[0].x;
    w.strike({ angle: Math.PI, speed: 2, a: 0, b: 0, elevation: 0, ball: 8 });
    expect(w.balls[8].vx).toBeLessThan(0);
    expect(w.balls[0].vx).toBe(0);
    expect(w.balls[0].x).toBe(x0);
  });
  it('AI finds a game-ending shot or at least a sane one (hard) and games terminate', async () => {
    const cfg = clonePhysics(defaultPhysics);
    const ai = [new AlgakkiAI(cfg, 2), new AlgakkiAI(cfg, 1)];
    let wins = [0, 0];
    for (let g = 0; g < 4; g++) {
      const w = new World(cfg);
      rackAlgakki(w, g + 1);
      let st = Algakki.init();
      const blackSeat = (g % 2) as 0 | 1;
      st.ballOf = blackSeat === 0 ? [BLACK, WHITE] : [WHITE, BLACK]; st.turn = blackSeat;
      const rec = new ShotRecorder();
      for (let i = 0; i < 40 && st.winner === null; i++) {
        const me = st.ballOf![st.turn], opp = st.ballOf![st.turn === 0 ? 1 : 0];
        const shot = await ai[st.turn].chooseShot(w, me, opp);
        rec.attach(w);
        w.strike({ ...shot, ball: me });
        w.settle(30, 0.001);
        rec.detach();
        st = Algakki.evaluate(st, rec.report).state;
        for (const id of rec.report.pocketed) w.balls[id].pocketed = true;
      }
      if (st.winner !== null) wins[st.winner]++;
      console.log(`algakki game ${g}: winner seat ${st.winner}, shots ${st.shots}`);
      expect(st.winner).not.toBeNull();
    }
    expect(wins[0] + wins[1]).toBe(4);
  }, 300000);
});
