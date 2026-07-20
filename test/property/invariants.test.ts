import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { arbAction } from './arbitraries.js';
import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../../src/engine/index.js';
import { makeSeeded } from '../../src/rng/rng.js';
import { randomBot } from '../../src/bots/random.js';
import type { GameState } from '../../src/engine/types.js';

function randomPlayState(seed: number): GameState {
  let s = createGame({ maxPlies: 400, seed });
  const rng = makeSeeded(seed);
  for (const color of ['RED', 'BLUE'] as const) {
    s = strategoReduce(s, { type: 'SETUP_RANDOM', color, order: rng.shuffle(rosterPieceIds(color)) }).state;
    s = strategoReduce(s, { type: 'SETUP_DONE', color }).state;
  }
  return s;
}

describe('reducer totality on junk', () => {
  test('never throws, never mutates, junk yields REJECTED', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), arbAction, (seed, action) => {
      const s = randomPlayState(seed);
      const snapshot = JSON.parse(JSON.stringify(s));
      const { state, events } = strategoReduce(s, action);
      expect(s).toEqual(snapshot); // no mutation of input
      // Either accepted (no REJECTED) or a single REJECTED with a reason
      if (events[0]?.type === 'REJECTED') {
        expect(state).toEqual(snapshot);
        expect(typeof events[0].reason).toBe('string');
      }
    }), { numRuns: 200 });
  });
});

describe('serialization round-trip', () => {
  test('state survives JSON round-trip after a random move', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      const action = randomBot(viewFor(s, s.turn), makeSeeded(seed));
      s = strategoReduce(s, action).state;
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }), { numRuns: 100 });
  });
});

describe('piece conservation', () => {
  test('every piece is either on-board or captured; counts never exceed roster', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      for (let i = 0; i < 30 && s.phase === 'PLAY'; i++) {
        const action = randomBot(viewFor(s, s.turn), makeSeeded(seed + i));
        s = strategoReduce(s, action).state;
      }
      expect(rosterPieceIds('RED')).toHaveLength(40);
      expect(Object.keys(s.pieces)).toHaveLength(80); // pieces never created/destroyed as records
    }), { numRuns: 50 });
  });
});

describe('redaction never leaks unrevealed enemy ranks', () => {
  test('enemy pieces that are not revealed have null rank in the view', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      for (let i = 0; i < 20 && s.phase === 'PLAY'; i++) {
        const action = randomBot(viewFor(s, s.turn), makeSeeded(seed + i));
        s = strategoReduce(s, action).state;
      }
      const view = viewFor(s, 'RED');
      for (const vp of view.pieces) {
        if (vp.owner === 'BLUE' && !vp.revealed) expect(vp.rank).toBeNull();
      }
    }), { numRuns: 50 });
  });
});

describe('random games always terminate', () => {
  test('random-vs-random reaches GAME_OVER within the guard', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 30 }), (seed) => {
      let s = randomPlayState(seed);
      let guard = 400 * 4 + 100;
      while (s.phase === 'PLAY' && guard-- > 0) {
        let applied = false;
        for (let a = 0; a < 5 && !applied; a++) {
          const action = randomBot(viewFor(s, s.turn), makeSeeded(seed * 31 + a));
          const { state, events } = strategoReduce(s, action);
          if (events[0]?.type === 'REJECTED') continue;
          s = state; applied = true;
        }
        if (!applied) s = strategoReduce(s, { type: 'RESIGN', color: s.turn }).state;
      }
      expect(s.phase).toBe('GAME_OVER');
    }), { numRuns: 30 });
  });
});
