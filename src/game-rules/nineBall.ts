import { TABLE, HEAD_X, FOOT_X } from '../config/table';
import { Rng } from '../physics/rng';
import type { World } from '../physics/world';
import type { EvalResult, PlayerIdx, RuleSet, RuleState, ShotReport } from './RuleSet';

const R = TABLE.ballRadius;

export function rackNineBall(world: World, seed: number) {
  const rng = new Rng(seed);
  for (const b of world.balls) {
    Object.assign(b, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, pocketed: false, pocketIndex: -1 });
  }
  // 9볼에서 쓰지 않는 10~15번 공은 테이블에서 치운다
  for (let id = 10; id <= 15; id++) { world.balls[id].pocketed = true; world.balls[id].pocketTime = -1e6; }
  // 다이아몬드: 1(꼭짓점), 9(중앙), 나머지는 무작위
  const rows = [1, 2, 3, 2, 1];
  const others = [2, 3, 4, 5, 6, 7, 8];
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const gap = 2 * R * 1.0006, dx = gap * Math.cos(Math.PI / 6);
  let k = 0;
  rows.forEach((n, r) => {
    for (let c = 0; c < n; c++) {
      let id: number;
      if (r === 0) id = 1; else if (r === 2 && c === 1) id = 9; else id = others[k++];
      const b = world.balls[id];
      b.x = FOOT_X + r * dx;
      b.y = (c - (n - 1) / 2) * gap + (rng.next() - 0.5) * 2e-5;
    }
  });
  world.balls[0].x = HEAD_X; world.balls[0].y = 0;
}

const lowest = (pocketed: number[]) => { for (let i = 1; i <= 9; i++) if (!pocketed.includes(i)) return i; return 9; };

export const NineBall: RuleSet = {
  id: 'nineball',
  name: '9볼',
  init(): RuleState {
    return {
      game: 'nineball', turn: 0, groups: [null, null], breakDone: false, ballInHand: true, inHandZone: 'head',
      winner: null, endReason: '', pocketed: [], respot: null, shots: 0, log: [],
    };
  },
  setupRack: rackNineBall,
  legalTargets(st, onTable) {
    const low = lowest(st.pocketed);
    return onTable.includes(low) ? [low] : [];
  },
  isOwn: () => true,
  evaluate(prev: RuleState, rep: ShotReport): EvalResult {
    const st: RuleState = { ...prev, groups: [...prev.groups] as RuleState['groups'], pocketed: [...prev.pocketed], log: [...prev.log] };
    const me = st.turn;
    const opp: PlayerIdx = me === 0 ? 1 : 0;
    const fouls: string[] = [];
    const msgs: string[] = [];
    const scratch = rep.pocketed.includes(0);
    const objPocketed = rep.pocketed.filter((id) => id !== 0 && id <= 9);
    const nineIn = objPocketed.includes(9);
    const low = lowest(prev.pocketed);
    st.shots++;

    if (rep.firstContact === null) fouls.push('아무 공도 맞히지 못했습니다');
    else if (rep.firstContact !== low) fouls.push(`가장 낮은 공(${low}번)을 먼저 맞혀야 합니다`);
    if (rep.firstContact !== null && !rep.railAfterContact && objPocketed.length === 0) fouls.push('공이 맞은 뒤 쿠션에 닿지 않았습니다');
    if (scratch) fouls.push('큐볼 스크래치');

    if (!st.breakDone) {
      const legal = objPocketed.length > 0 || rep.railBalls.length >= 4;
      if (!legal) fouls.push('불완전 브레이크 (4개 이상의 공이 쿠션에 닿거나 포켓되어야 함)');
      st.breakDone = true;
    }

    let respot: number | null = null;
    for (const id of objPocketed) if (id !== 9 || !fouls.length) st.pocketed.push(id);
    if (nineIn) {
      if (fouls.length) { respot = 9; msgs.push('파울 중 9번 공이 들어가 다시 놓습니다'); }
      else { st.winner = me; st.endReason = '9번 공을 포켓했습니다'; }
    }
    if (st.winner === null) {
      if (fouls.length) { st.turn = opp; st.ballInHand = true; st.inHandZone = 'any'; }
      else if (objPocketed.length > 0) st.ballInHand = false;
      else { st.turn = opp; st.ballInHand = false; }
    }
    st.respot = respot;
    for (const f of fouls) st.log.push(`파울: ${f}`);
    return { state: st, fouls, messages: msgs, respot };
  },
};
