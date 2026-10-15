import type { World } from '../physics/world';

export type Group = 'solid' | 'stripe';
export type PlayerIdx = 0 | 1;

export interface RuleState {
  game: 'eightball' | 'nineball';
  turn: PlayerIdx;
  groups: [Group | null, Group | null];
  breakDone: boolean;
  ballInHand: boolean;
  /** 'head' = 헤드스트링 뒤 (브레이크) / 'any' = 어디든 */
  inHandZone: 'head' | 'any';
  winner: PlayerIdx | null;
  endReason: string;
  pocketed: number[]; // 포켓된 오브젝트 볼 (큐볼 제외), 순서대로
  respot: number | null; // 다시 놓아야 하는 공 (8볼: 8번, 9볼: 9번)
  shots: number;
  log: string[];
}

/** 한 번의 샷 동안 월드에서 수집한 사실들 */
export interface ShotReport {
  firstContact: number | null;
  pocketed: number[]; // 포켓된 순서 (0 = 큐볼 포함)
  railAfterContact: boolean;
  railBalls: number[]; // 쿠션에 닿은 서로 다른 공 (브레이크 판정)
  cueRailsBeforeContact: number; // 첫 접촉 전에 큐볼이 맞은 쿠션 수 (3쿠션 등)
  miscue: boolean;
}

export interface EvalResult {
  state: RuleState;
  fouls: string[];
  messages: string[];
  respot: number | null; // 다시 놓아야 하는 공 (8볼: 8번, 9볼: 9번)
}

/** 9볼 등 다른 규칙을 추가하기 위한 인터페이스 */
export interface RuleSet {
  id: string;
  name: string;
  init(): RuleState;
  setupRack(world: World, seed: number): void;
  evaluate(state: RuleState, report: ShotReport): EvalResult;
  /** 현재 플레이어가 맞혀야 하는 공 id 목록 (AI/힌트용) */
  legalTargets(state: RuleState, onTable: number[]): number[];
  /** 현재 플레이어에게 이득이 되는 포켓인가 (AI 평가용) */
  isOwn(state: RuleState, id: number): boolean;
}

export const isSolid = (id: number) => id >= 1 && id <= 7;
export const isStripe = (id: number) => id >= 9 && id <= 15;
export const groupOf = (id: number): Group | null => (isSolid(id) ? 'solid' : isStripe(id) ? 'stripe' : null);
