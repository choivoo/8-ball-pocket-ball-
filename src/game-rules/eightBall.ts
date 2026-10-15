import { TABLE, HEAD_X, FOOT_X } from '../config/table';
import { Rng } from '../physics/rng';
import type { World } from '../physics/world';
import { groupOf, type EvalResult, type RuleSet, type RuleState, type ShotReport, type PlayerIdx } from './RuleSet';

const R = TABLE.ballRadius;

export function rackEightBall(world: World, seed: number) {
  const rng = new Rng(seed);
  for (const b of world.balls) {
    Object.assign(b, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, pocketed: false, pocketIndex: -1 });
  }
  // 15개 공을 배치: 8번은 가운데(3행 2열), 뒤 두 모서리는 솔리드/스트라이프 하나씩
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // 위치 인덱스: 행 r, 열 c  (r=0..4)
  const slots: [number, number][] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) slots.push([r, c]);
  const layout = new Array<number>(15).fill(0);
  const idxOf = (r: number, c: number) => slots.findIndex(([rr, cc]) => rr === r && cc === c);
  layout[idxOf(2, 1)] = 8;
  // 뒤쪽 모서리: 하나는 솔리드, 하나는 스트라이프
  const solids = rest.filter((n) => n < 8), stripes = rest.filter((n) => n > 8);
  layout[idxOf(4, 0)] = solids.pop()!;
  layout[idxOf(4, 4)] = stripes.pop()!;
  const others = [...solids, ...stripes];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  for (let i = 0; i < 15; i++) if (layout[i] === 0) layout[i] = others.pop()!;
  const gap = 2 * R * 1.0006;
  const dx = gap * Math.cos(Math.PI / 6);
  slots.forEach(([r, c], i) => {
    const b = world.balls[layout[i]];
    b.x = FOOT_X + r * dx;
    b.y = (c - r / 2) * gap + (rng.next() - 0.5) * 2e-5;
  });
  const cue = world.balls[0];
  cue.x = HEAD_X; cue.y = 0;
}

export const EightBall: RuleSet = {
  id: 'eightball',
  name: '8볼 (WPA)',
  init(): RuleState {
    return {
      game: 'eightball', turn: 0, groups: [null, null], breakDone: false, ballInHand: true, inHandZone: 'head',
      winner: null, endReason: '', pocketed: [], respot: null, shots: 0, log: [],
    };
  },
  setupRack: rackEightBall,
  isOwn(st, id) { const g = st.groups[st.turn]; return !g || id === 8 || groupOf(id) === g; },
  legalTargets(st, onTable) {
    const g = st.groups[st.turn];
    if (!g) return onTable.filter((id) => id !== 8 && id !== 0);
    const own = onTable.filter((id) => groupOf(id) === g);
    return own.length ? own : onTable.includes(8) ? [8] : [];
  },
  evaluate(prev: RuleState, rep: ShotReport): EvalResult {
    const st: RuleState = { ...prev, groups: [...prev.groups] as RuleState['groups'], pocketed: [...prev.pocketed], log: [...prev.log] };
    const me = st.turn;
    const opp: PlayerIdx = me === 0 ? 1 : 0;
    const fouls: string[] = [];
    const msgs: string[] = [];
    const scratch = rep.pocketed.includes(0);
    const objPocketed = rep.pocketed.filter((id) => id !== 0);
    const eightIn = objPocketed.includes(8);
    let respot: number | null = null;
    const myGroup = st.groups[me];
    const onTableBefore = (id: number) => !prev.pocketed.includes(id);
    st.shots++;

    if (!st.breakDone) {
      // ---------------- 브레이크 샷
      const legal = objPocketed.filter((i) => i !== 8).length > 0 || rep.railBalls.length >= 4;
      if (scratch) fouls.push('브레이크 중 큐볼 스크래치');
      if (!legal) fouls.push('불완전 브레이크 (4개 이상의 공이 쿠션에 닿거나 포켓되어야 함)');
      st.breakDone = true;
      if (eightIn) {
        respot = 8;
        msgs.push('브레이크에서 8번 공이 들어가 다시 놓습니다');
      }
      for (const id of objPocketed) if (id !== 8) st.pocketed.push(id);
      if (fouls.length) {
        st.turn = opp; st.ballInHand = true; st.inHandZone = 'any';
      } else if (objPocketed.filter((i) => i !== 8).length > 0 || eightIn) {
        st.ballInHand = false; // 계속 (테이블 오픈 상태)
        msgs.push('오픈 테이블 — 계속 치세요');
      } else {
        st.turn = opp; st.ballInHand = false;
      }
      return finish(st, fouls, msgs, respot);
    }

    // ---------------- 일반 샷
    const first = rep.firstContact;
    const myLeft = (g: 'solid' | 'stripe' | null) => {
      if (!g) return 99;
      let n = 0;
      for (let id = 1; id <= 15; id++) if (id !== 8 && groupOf(id) === g && onTableBefore(id)) n++;
      return n;
    };
    const ownRemainingBefore = myLeft(myGroup);
    const shootingEight = myGroup !== null && ownRemainingBefore === 0;

    if (first === null) fouls.push('아무 공도 맞히지 못했습니다');
    else if (shootingEight) {
      if (first !== 8) fouls.push('8번 공을 먼저 맞혀야 합니다');
    } else if (!myGroup) {
      if (first === 8) fouls.push('오픈 테이블에서 8번 공을 먼저 맞혔습니다');
    } else if (groupOf(first) !== myGroup) {
      fouls.push(first === 8 ? '8번 공을 먼저 맞혔습니다' : '상대 공을 먼저 맞혔습니다');
    }
    if (first !== null && !rep.railAfterContact && objPocketed.length === 0) fouls.push('공이 맞은 뒤 쿠션에 닿지 않았습니다');
    if (scratch) fouls.push('큐볼 스크래치');

    // 8번 공 처리
    if (eightIn) {
      const lostBySetup = !shootingEight;
      if (lostBySetup || fouls.length) {
        st.winner = opp;
        st.endReason = lostBySetup ? '8번 공을 조기에 포켓했습니다' : `8번 공을 넣었지만 파울 (${fouls[0]})`;
      } else {
        st.winner = me;
        st.endReason = '8번 공을 성공적으로 포켓했습니다';
      }
      st.pocketed.push(8);
      for (const id of objPocketed) if (id !== 8) st.pocketed.push(id);
      return finish(st, fouls, msgs, null);
    }

    // 그룹 결정 (오픈 테이블에서 파울 없는 첫 포켓)
    if (!st.groups[me] && !fouls.length) {
      const f = objPocketed.find((id) => groupOf(id));
      if (f !== undefined) {
        const g = groupOf(f)!;
        st.groups[me] = g;
        st.groups[opp] = g === 'solid' ? 'stripe' : 'solid';
        msgs.push(`${me === 0 ? 'P1' : 'P2'}: ${g === 'solid' ? '솔리드(1-7)' : '스트라이프(9-15)'}`);
      }
    }
    for (const id of objPocketed) st.pocketed.push(id);
    const g = st.groups[me];
    const potted = g ? objPocketed.some((id) => groupOf(id) === g) : objPocketed.length > 0;

    if (fouls.length) {
      st.turn = opp; st.ballInHand = true; st.inHandZone = 'any';
    } else if (potted) {
      st.ballInHand = false;
    } else {
      st.turn = opp; st.ballInHand = false;
    }
    return finish(st, fouls, msgs, null);
  },
};

function finish(st: RuleState, fouls: string[], msgs: string[], respot: number | null): EvalResult {
  st.respot = respot;
  for (const f of fouls) st.log.push(`파울: ${f}`);
  return { state: st, fouls, messages: msgs, respot };
}
