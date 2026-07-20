import { describe, expect, test } from 'vitest';
import { ROSTER, RANKS, LAKES, SETUP_ROWS } from '../../src/engine/types.js';

describe('constants', () => {
  test('roster sums to 40 pieces', () => {
    const total = Object.values(ROSTER).reduce((a, b) => a + b, 0);
    expect(total).toBe(40);
  });
  test('roster has all 12 ranks', () => {
    expect(RANKS).toHaveLength(12);
    for (const r of RANKS) expect(ROSTER[r]).toBeGreaterThan(0);
  });
  test('33 movable pieces (excludes 6 bombs + 1 flag)', () => {
    const movable = RANKS.filter((r) => r !== 'BOMB' && r !== 'FLAG')
      .reduce((a, r) => a + ROSTER[r], 0);
    expect(movable).toBe(33);
  });
  test('two 2x2 lakes = 8 squares, no overlap with setup rows', () => {
    expect(LAKES).toHaveLength(8);
    const setupRows = new Set([...SETUP_ROWS.RED, ...SETUP_ROWS.BLUE]);
    for (const l of LAKES) expect(setupRows.has(l.r)).toBe(false);
  });
});
