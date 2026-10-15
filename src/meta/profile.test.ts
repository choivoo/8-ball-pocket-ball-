import { describe, it, expect } from 'vitest';
import { Profile, levelFromXp, ACHIEVEMENTS } from './profile';

const mem = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage; };

describe('profile', () => {
  it('levels increase monotonically with xp', () => {
    let last = 0;
    for (let xp = 0; xp < 20000; xp += 50) { const l = levelFromXp(xp).level; expect(l).toBeGreaterThanOrEqual(last); last = l; }
    expect(levelFromXp(0).level).toBe(1);
  });
  it('unlocks achievements once, grants xp and persists', () => {
    const store = mem();
    const p = new Profile(store);
    const got = p.update((s) => { s.shots = 1; s.pots = 1; });
    expect(got.map((a) => a.id)).toEqual(['first_shot', 'first_pot']);
    expect(p.update((s) => { s.shots++; })).toEqual([]);
    expect(p.stats.xp).toBe(50);
    expect(new Profile(store).stats.xp).toBe(50);
  });
  it('achievement ids are unique', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
