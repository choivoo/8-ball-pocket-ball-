// 드릴 구성 생성기: 실제 물리로 "풀 수 있는" 배치만 골라 configs.json 으로 저장한다 (npm run gen:drills)
import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { defaultPhysics, clonePhysics } from '../src/config/physics';
import { TABLE } from '../src/config/table';
import { World } from '../src/physics/world';
import { Rng } from '../src/physics/rng';
import { ShotRecorder } from '../src/game-rules/report';
import type { Shot } from '../src/physics/types';

const R = TABLE.ballRadius;
const rng = new Rng(2026);
const cfg = clonePhysics(defaultPhysics);

interface Cfg { balls: [number, number, number][]; cue: [number, number]; target?: [number, number, number]; sol: Shot }

function run(balls: [number, number, number][], cue: [number, number], shot: Shot) {
  const w = new World({ ...cfg, dt: 0.002 });
  for (const b of w.balls) b.pocketed = true;
  for (const [id, x, y] of balls) { const b = w.balls[id]; b.pocketed = false; b.x = x; b.y = y; }
  w.balls[0].pocketed = false; w.balls[0].x = cue[0]; w.balls[0].y = cue[1];
  w.rng.state = 99;
  const rec = new ShotRecorder(); rec.attach(w);
  const contactPos: { x: number; y: number } = { x: 0, y: 0 };
  let got = false;
  w.listeners.push((e) => { if (e.type === 'ballBall' && !got && (e.a === 0 || e.b === 0)) { got = true; contactPos.x = w.balls[0].x; contactPos.y = w.balls[0].y; } });
  w.strike(shot);
  w.settle(25, 0.002);
  rec.detach();
  return { w, rep: rec.report, contactPos };
}
const free = (x: number, y: number, others: [number, number, number][], cue: [number, number]) =>
  Math.abs(x) < TABLE.halfL - 0.12 && Math.abs(y) < TABLE.halfW - 0.12 &&
  others.every(([, ox, oy]) => Math.hypot(ox - x, oy - y) > 0.14) && Math.hypot(cue[0] - x, cue[1] - y) > 0.14;

/** 가장 넓은 성공 각도 창을 가진 해를 찾는다 */
function solve(balls: [number, number, number][], cue: [number, number], ok: (r: ReturnType<typeof run>) => boolean, speeds: number[], els = [0], bs = [0], aa = [0], minWidth = 1) {
  let best: { shot: Shot; width: number } | null = null;
  for (const speed of speeds) for (const elevation of els) for (const b of bs) for (const a of aa) {
    const good: number[] = [];
    const target = balls[0];
    const base = Math.atan2(target[2] - cue[1], target[1] - cue[0]);
    for (let d = -45; d <= 45; d += 1) {
      const angle = base + (d * Math.PI) / 180;
      const shot = { angle, speed, a, b, elevation };
      if (ok(run(balls, cue, shot))) good.push(d);
    }
    if (good.length) {
      // 연속 구간 중 가장 긴 것
      let bestRun = 1, cur = 1, bi = 0, ci = 0;
      for (let i = 1; i < good.length; i++) { if (good[i] === good[i - 1] + 1) { cur++; if (cur > bestRun) { bestRun = cur; bi = ci; } } else { cur = 1; ci = i; } }
      const mid = good[bi + Math.floor((bestRun - 1) / 2)];
      const shot = { angle: base + (mid * Math.PI) / 180, speed, a, b, elevation };
      if (bestRun >= minWidth && (!best || bestRun > best.width)) best = { shot, width: bestRun };
    }
  }
  return best;
}

it('generate drills', () => {
  const out: Record<string, Cfg[]> = {};
  const rndPos = (): [number, number] => [rng.range(-0.95, 0.95), rng.range(-0.42, 0.42)];
  const potted1 = (r: ReturnType<typeof run>) => r.w.balls[1].pocketed && r.rep.firstContact === 1 && !r.rep.pocketed.includes(0);
  const geom = new World(cfg).geom;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  /** 포켓 앞 일직선 배치: 포켓 입구에서 안쪽으로 dObj, 그 뒤로 dCue 에 큐볼 */
  const straightCfg = (pi: number, dObj: number, dCue: number): { obj: [number, number, number]; cue: [number, number] } | null => {
    const p = geom.pockets[pi];
    const ux = -p.ax, uy = -p.ay; // 안쪽 방향
    const obj: [number, number, number] = [1, p.mx + ux * dObj, p.my + uy * dObj];
    const cue: [number, number] = [obj[1] + ux * dCue, obj[2] + uy * dCue];
    if (Math.abs(cue[0]) > TABLE.halfL - 0.1 || Math.abs(cue[1]) > TABLE.halfW - 0.1) return null;
    return { obj, cue };
  };

  out.straight = [];
  for (const [dobj, dcue] of [[0.25, 0.35], [0.35, 0.5], [0.45, 0.7], [0.55, 0.9], [0.65, 1.1]]) {
    for (const pi of [2, 1, 3, 0]) {
      const c = straightCfg(pi, dobj, dcue); if (!c) continue;
      const sol = solve([c.obj], c.cue, potted1, [2.0, 2.8], [0], [0], [0], 1);
      if (sol) { out.straight.push({ balls: [c.obj], cue: c.cue, sol: sol.shot }); break; }
    }
  }
  console.log('straight', out.straight.length);

  out.cut = [];
  for (const deg of [15, 25, 35, 45, 55]) {
    let done = false;
    for (const pi of [2, 1, 3, 0, 4, 5]) for (const side of [1, -1]) {
      if (done) break;
      const p = geom.pockets[pi];
      const ux = -p.ax, uy = -p.ay;
      const obj: [number, number, number] = [1, p.mx + ux * 0.4, p.my + uy * 0.4];
      const gx = obj[1] + ux * 2 * R, gy = obj[2] + uy * 2 * R;
      const th = ((deg * Math.PI) / 180) * side;
      const dir = [ux * Math.cos(th) - uy * Math.sin(th), ux * Math.sin(th) + uy * Math.cos(th)];
      const cue: [number, number] = [gx + dir[0] * 0.8, gy + dir[1] * 0.8];
      if (Math.abs(cue[0]) > TABLE.halfL - 0.1 || Math.abs(cue[1]) > TABLE.halfW - 0.1) continue;
      const sol = solve([obj], cue, potted1, [2.2, 3.0], [0], [0], [0], 1);
      if (sol) { out.cut.push({ balls: [obj], cue, sol: sol.shot }); done = true; }
    }
  }
  console.log('cut', out.cut.length);

  const make = (name: string, n: number, gen: () => { balls: [number, number, number][]; cue: [number, number]; ok: (r: ReturnType<typeof run>) => boolean; speeds: number[]; els?: number[]; bs?: number[]; target?: [number, number, number]; minWidth?: number } | null, maxSolves = 90) => {
    out[name] = [];
    let solves = 0;
    for (let t = 0; t < 20000 && out[name].length < n && solves < maxSolves; t++) {
      const g = gen();
      if (!g) continue;
      solves++;
      const s = solve(g.balls, g.cue, g.ok, g.speeds, g.els ?? [0], g.bs ?? [0], [0], g.minWidth ?? 1);
      if (s) out[name].push({ balls: g.balls, cue: g.cue, target: g.target, sol: s.shot });
    }
    console.log(name, out[name].length, 'after', solves, 'solves');
  };

  make('bank', 5, () => {
    const o = rndPos(); const c = rndPos();
    if (!free(o[0], o[1], [], c)) return null;
    return { balls: [[1, o[0], o[1]]], cue: c, ok: (r) => potted1(r) && r.rep.railBalls.includes(1), speeds: [2.6, 3.6] };
  });

  // 스톱샷 / 끌어치기: 일직선 배치 + 타점 탐색
  const straightDrill = (name: string, bs: number[], ok: (r: ReturnType<typeof run>) => boolean) => {
    out[name] = [];
    const specs: [number, number, number][] = [[2, 0.3, 0.6], [1, 0.35, 0.7], [3, 0.3, 0.8], [0, 0.4, 0.7], [2, 0.45, 0.9], [4, 0.3, 0.7], [5, 0.3, 0.7]];
    for (const [pi, dobj, dcue] of specs) {
      if (out[name].length >= 5) break;
      const c = straightCfg(pi, dobj, dcue); if (!c) continue;
      const sol = solve([c.obj], c.cue, ok, [1.6, 2.2, 2.8, 3.4], [0], bs, [0], 1);
      if (sol) out[name].push({ balls: [c.obj], cue: c.cue, sol: sol.shot });
    }
    console.log(name, out[name].length);
  };
  const distC = (r: ReturnType<typeof run>) => dist(r.w.balls[0], r.contactPos);
  straightDrill('stop', [-0.3, -0.2, -0.1, 0, 0.1], (r) => potted1(r) && distC(r) < 0.12);
  straightDrill('draw', [-0.6, -0.5, -0.4], (r) => potted1(r) && distC(r) > 0.3);

  make('position', 5, () => {
    const o = rndPos(); const c = rndPos(); const t = rndPos();
    if (!free(o[0], o[1], [], c) || dist({ x: t[0], y: t[1] }, { x: o[0], y: o[1] }) < 0.4) return null;
    return { balls: [[1, o[0], o[1]]], cue: c, target: [t[0], t[1], 0.22], ok: (r) => potted1(r) && !r.w.balls[0].pocketed && Math.hypot(r.w.balls[0].x - t[0], r.w.balls[0].y - t[1]) < 0.22, speeds: [2.2, 3.0, 3.8], bs: [-0.3, 0, 0.3] };
  }, 150);

  make('jump', 4, () => {
    const c = rndPos(); const ang = rng.range(0, Math.PI * 2);
    const bl: [number, number] = [c[0] + Math.cos(ang) * 0.1, c[1] + Math.sin(ang) * 0.1];
    const dist2 = rng.range(0.6, 0.9);
    const o: [number, number] = [c[0] + Math.cos(ang + rng.range(-0.15, 0.15)) * dist2, c[1] + Math.sin(ang + rng.range(-0.15, 0.15)) * dist2];
    if (!free(o[0], o[1], [[2, bl[0], bl[1]]], c) || Math.abs(bl[0]) > 1.1 || Math.abs(bl[1]) > 0.55) return null;
    return { balls: [[1, o[0], o[1]], [2, bl[0], bl[1]]], cue: c, ok: (r) => r.rep.firstContact === 1 && !r.w.balls[0].pocketed, speeds: [3.2, 4.2], els: [0.75, 0.9, 1.0] };
  }, 150);

  writeFileSync('src/drills/configs.json', JSON.stringify(out));
}, 2400000);

it('generate rails3', () => {
  const out: Record<string, Cfg[]> = {};
  out.rails3 = [];
  const rndPos = (): [number, number] => [rng.range(-0.9, 0.9), rng.range(-0.4, 0.4)];
  for (let t = 0; t < 400 && out.rails3.length < 4; t++) {
    const o = rndPos(), c = rndPos();
    if (Math.hypot(o[0] - c[0], o[1] - c[1]) < 0.7) continue;
    const balls: [number, number, number][] = [[1, o[0], o[1]]];
    let best: Shot | null = null, bestW = 0;
    for (const speed of [3.0, 4.2, 5.4]) {
      const good: number[] = [];
      for (let d = 0; d < 360; d += 2) {
        const shot = { angle: (d * Math.PI) / 180, speed, a: 0, b: 0, elevation: 0 };
        const r = run(balls, c, shot);
        if (r.rep.firstContact === 1 && r.rep.cueRailsBeforeContact >= 3) good.push(d);
      }
      if (good.length > bestW) { bestW = good.length; best = { angle: (good[Math.floor(good.length / 2)] * Math.PI) / 180, speed, a: 0, b: 0, elevation: 0 }; }
    }
    if (best && bestW >= 2) out.rails3.push({ balls, cue: c, sol: best });
  }
  console.log('rails3', out.rails3.length);
  writeFileSync('src/drills/configs3.json', JSON.stringify(out));
}, 600000);
