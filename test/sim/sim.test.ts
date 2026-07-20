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
  test('heuristic bot beats random decisively both colors (regression floor)', () => {
    // Measured 2026-07-20 after attack-discipline + pursuit fix: ~84% both
    // colors over 1000 fresh-seed games. Floor set loosely at 60% so minor
    // bot tweaks don't flake; a drop below this means the bot regressed.
    const asRed = runSims({ games: 100, seed: 40000, red: heuristicBot, blue: randomBot });
    const asBlue = runSims({ games: 100, seed: 50000, red: randomBot, blue: heuristicBot });
    expect(asRed.redWins).toBeGreaterThanOrEqual(60);
    expect(asBlue.blueWins).toBeGreaterThanOrEqual(60);
  });
});
