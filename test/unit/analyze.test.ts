import { describe, expect, test } from 'vitest';
import { playGameDetailed, runBatch } from '../../src/sim/analyze.js';
import { playGame } from '../../src/sim/run.js';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot } from '../../src/bots/heuristic.js';

describe('playGameDetailed', () => {
  test('matches playGame outcome for the same seed (instrumentation is passive)', () => {
    for (const seed of [1, 2, 42, 123]) {
      const plain = playGame({ seed, red: heuristicBot, blue: randomBot });
      const detailed = playGameDetailed({ seed, red: heuristicBot, blue: randomBot });
      expect(detailed.result).toEqual(plain);
    }
  });

  test('classifies every game end', () => {
    const rec = playGameDetailed({ seed: 7, red: randomBot, blue: randomBot });
    expect(['ENGINE', 'BOT_RESIGN', 'FORCED_RESIGN']).toContain(rec.endedBy);
    expect(rec.plies).toBeGreaterThan(0);
    if (rec.endedBy === 'FORCED_RESIGN') {
      expect(rec.forcedResign).not.toBeNull();
      expect(rec.forcedResign!.rejectionReasons).toHaveLength(5);
    } else {
      expect(rec.forcedResign).toBeNull();
    }
  });
});

describe('runBatch', () => {
  test('tallies are consistent and reproducible', () => {
    const a = runBatch({ games: 30, seed: 11, red: heuristicBot, blue: randomBot });
    const b = runBatch({ games: 30, seed: 11, red: heuristicBot, blue: randomBot });
    expect(a.stats).toEqual(b.stats);
    expect(a.stats.redWins + a.stats.blueWins + a.stats.draws).toBe(30);
    const endedTotal = Object.values(a.stats.endedBy).reduce((x, y) => x + y, 0);
    expect(endedTotal).toBe(30);
    expect(a.stats.plies.p50).toBeGreaterThan(0);
    expect(a.stats.plies.max).toBeGreaterThanOrEqual(a.stats.plies.p90);
  });
});
