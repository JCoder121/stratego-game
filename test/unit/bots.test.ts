import { describe, expect, test } from 'vitest';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot as heur } from '../../src/bots/heuristic.js';
import { legalMovesFromView } from '../../src/bots/moves-from-view.js';
import { createGame, strategoReduce, viewFor } from '../../src/engine/index.js';
import { presetPlacement } from '../../src/engine/setups.js';
import { makeSeeded } from '../../src/rng/rng.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    s.setupDone[color] = true;
  }
  s.phase = 'PLAY';
  return s;
}

describe('bots', () => {
  test('legalMovesFromView returns only MOVEs the engine accepts', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const moves = legalMovesFromView(view);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      const invalid = strategoReduce(s, { type: 'MOVE', color: 'RED', from: m.from, to: m.to }).events[0];
      // A valid move's first event is never REJECTED.
      expect(invalid?.type).not.toBe('REJECTED');
    }
  });
  test('randomBot produces an engine-accepted action', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const action = randomBot(view, makeSeeded(1));
    const { events } = strategoReduce(s, action);
    expect(events[0]!.type).not.toBe('REJECTED');
  });
  test('heuristicBot produces an engine-accepted action', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const action = heur(view, makeSeeded(2));
    const { events } = strategoReduce(s, action);
    expect(events[0]!.type).not.toBe('REJECTED');
  });
});
