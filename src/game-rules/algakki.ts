import type { World } from '../physics/world';
import type { EvalResult, PlayerIdx, RuleSet, RuleState, ShotReport } from './RuleSet';

export const BLACK = 8, WHITE = 0;

/**
 * 알까기: 테이블에는 검은 공(8)과 흰 공(0) 단 두 개.
 * 각자 자기 공만 번갈아 치며, 상대 공을 먼저 포켓에 넣으면 승리.
 * 자기 공이 포켓에 빠지면(상대 공과 동시에 빠져도) 패배.
 * 검은 공을 가진 쪽이 선공이며, 누가 검은 공을 갖는지는 가위바위보로 정한다.
 */
export function rackAlgakki(world: World, seed: number) {
  for (const b of world.balls) {
    Object.assign(b, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, pocketed: true, pocketIndex: -1, pocketTime: -1e6 });
  }
  const side = seed % 2 === 0 ? 1 : -1;
  const black = world.balls[BLACK], white = world.balls[WHITE];
  black.pocketed = false; white.pocketed = false;
  black.x = 0.5; black.y = 0.16 * side;
  white.x = -0.5; white.y = -0.16 * side;
}

export const Algakki: RuleSet = {
  id: 'algakki',
  name: '알까기',
  init(): RuleState {
    return {
      game: 'algakki', turn: 0, groups: [null, null], breakDone: true, ballInHand: false, inHandZone: 'any',
      winner: null, endReason: '', pocketed: [], respot: null, shots: 0, log: [], ballOf: [BLACK, WHITE],
    };
  },
  setupRack: rackAlgakki,
  legalTargets(st, onTable) {
    const opp = st.ballOf![st.turn === 0 ? 1 : 0];
    return onTable.includes(opp) ? [opp] : [];
  },
  isOwn: () => true,
  evaluate(prev: RuleState, rep: ShotReport): EvalResult {
    const st: RuleState = { ...prev, groups: [...prev.groups] as RuleState['groups'], pocketed: [...prev.pocketed], log: [...prev.log], ballOf: [...prev.ballOf!] as [number, number] };
    const me = st.turn;
    const opp: PlayerIdx = me === 0 ? 1 : 0;
    const mine = st.ballOf![me], theirs = st.ballOf![opp];
    st.shots++;
    const ownIn = rep.pocketed.includes(mine);
    const oppIn = rep.pocketed.includes(theirs);
    const msgs: string[] = [];
    if (ownIn) {
      st.winner = opp;
      st.endReason = oppIn ? '두 공이 모두 빠졌지만 자기 공이 빠져 패배' : '자기 공이 포켓에 빠졌습니다';
    } else if (oppIn) {
      st.winner = me;
      st.endReason = '상대 공을 포켓에 넣었습니다';
    } else {
      st.turn = opp;
      msgs.push(`${theirs === BLACK ? '검은 공' : '흰 공'} 차례`);
    }
    return { state: st, fouls: [], messages: [], respot: null };
  },
};
