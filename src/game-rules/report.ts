import type { World } from '../physics/world';
import type { ShotReport } from './RuleSet';

/** 월드 이벤트를 구독해 한 샷의 규칙 판정에 필요한 정보를 수집한다 */
export class ShotRecorder {
  report: ShotReport = { firstContact: null, pocketed: [], railAfterContact: false, railBalls: [], cueRailsBeforeContact: 0, miscue: false };
  private off: (() => void) | null = null;

  attach(world: World) {
    this.reset();
    const fn = (e: import('../physics/types').PhysEvent) => {
      const r = this.report;
      if (e.type === 'ballBall') {
        if (r.firstContact === null && (e.a === 0 || e.b === 0)) r.firstContact = e.a === 0 ? e.b : e.a;
      } else if (e.type === 'cushion') {
        if (!r.railBalls.includes(e.id)) r.railBalls.push(e.id);
        if (e.id === 0 && r.firstContact === null) r.cueRailsBeforeContact++;
        if (r.firstContact !== null) r.railAfterContact = true;
      } else if (e.type === 'pocket') {
        r.pocketed.push(e.id);
        if (r.firstContact !== null) r.railAfterContact = true;
      } else if (e.type === 'cue') {
        r.miscue = e.miscue;
      }
    };
    world.listeners.push(fn);
    this.off = () => {
      const i = world.listeners.indexOf(fn);
      if (i >= 0) world.listeners.splice(i, 1);
    };
  }
  detach() {
    this.off?.();
    this.off = null;
  }
  reset() {
    this.report = { firstContact: null, pocketed: [], railAfterContact: false, railBalls: [], cueRailsBeforeContact: 0, miscue: false };
  }
}
