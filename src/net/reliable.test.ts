import { describe, it, expect } from 'vitest';
import { ReliableChannel, type WireMsg } from './reliable';

/** 손실 30% / 중복 20% / 순서 뒤섞임이 있는 가짜 링크 */
function makeLink(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const queue: { to: 'a' | 'b'; w: WireMsg; at: number }[] = [];
  let now = 0;
  const push = (to: 'a' | 'b', w: WireMsg) => {
    if (rnd() < 0.3) return;
    const n = rnd() < 0.2 ? 2 : 1;
    for (let i = 0; i < n; i++) queue.push({ to, w, at: now + rnd() * 50 });
  };
  return { push, queue, step(dt: number, rx: (to: 'a' | 'b', w: WireMsg) => void) { now += dt; for (const q of queue.filter((x) => x.at <= now)) { queue.splice(queue.indexOf(q), 1); rx(q.to, q.w); } } };
}

describe('ReliableChannel', () => {
  it('delivers every message exactly once, in order, over a lossy link', () => {
    const link = makeLink(42);
    const gotA: unknown[] = [], gotB: unknown[] = [];
    const a: ReliableChannel = new ReliableChannel((w) => link.push('b', w), (m) => gotA.push(m));
    const b: ReliableChannel = new ReliableChannel((w) => link.push('a', w), (m) => gotB.push(m));
    for (let i = 0; i < 60; i++) { a.send({ i }); if (i % 3 === 0) b.send({ j: i }); }
    for (let t = 0; t < 4000; t += 10) {
      link.step(10, (to, w) => (to === 'a' ? a : b).receive(w));
      if (t % 100 === 0) { a.tick(); b.tick(); }
    }
    expect(gotB).toEqual(Array.from({ length: 60 }, (_, i) => ({ i })));
    expect(gotA).toEqual(Array.from({ length: 20 }, (_, k) => ({ j: k * 3 })));
    expect(a.pending).toBe(0);
  });
  it('keeps retrying while the link is fully down, then recovers', () => {
    let up = false;
    const got: unknown[] = [];
    let a!: ReliableChannel, b!: ReliableChannel;
    a = new ReliableChannel((w) => { if (up) b.receive(w); }, () => {});
    b = new ReliableChannel((w) => { if (up) a.receive(w); }, (m) => got.push(m));
    a.send('shot'); a.send('result');
    a.tick(); a.tick();
    expect(got).toEqual([]);
    up = true;
    a.tick();
    expect(got).toEqual(['shot', 'result']);
  });
});
