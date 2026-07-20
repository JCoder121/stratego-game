import { describe, expect, test } from 'vitest';
import { makeSeeded } from '../../src/rng/rng.js';

describe('seeded rng', () => {
  test('same seed → identical sequence', () => {
    const a = makeSeeded(42);
    const b = makeSeeded(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
  test('int is within range', () => {
    const r = makeSeeded(1);
    for (let i = 0; i < 100; i++) {
      const n = r.int(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });
  test('shuffle is a permutation and deterministic for a seed', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const s1 = makeSeeded(7).shuffle(items);
    const s2 = makeSeeded(7).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(items);
  });
});
