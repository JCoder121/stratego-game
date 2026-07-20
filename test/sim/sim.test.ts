import { describe, expect, test } from 'vitest';
import { playGame, runSims } from '../../src/sim/run.js';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot } from '../../src/bots/heuristic.js';

describe('simulation', () => {
  test('a seeded random-vs-random game terminates with a result', () => {
    const result = playGame({ seed: 123, red: randomBot, blue: randomBot });
    expect(result).toBeTruthy();
    expect(['FLAG_CAPTURED', 'NO_MOVES', 'RESIGN', 'PLY_CAP', 'DEAD_POSITION']).toContain(result.reason);
  });
  test('100 seeded games all terminate; tallies are consistent', () => {
    const stats = runSims({ games: 100, seed: 7, red: heuristicBot, blue: randomBot });
    expect(stats.redWins + stats.blueWins + stats.draws).toBe(100);
    expect(stats.avgPlies).toBeGreaterThan(0);
  });
});
