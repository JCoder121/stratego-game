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

  test('legalMovesFromView excludes a move that would violate the two-square rule, keeping others', () => {
    // Manual view: an open board so the scout isn't boxed in, plus a second own
    // piece to prove filtering doesn't wipe out unrelated moves.
    const x = { r: 5, c: 5 };
    const y = { r: 4, c: 5 }; // one step "up" from x
    const view = {
      viewer: 'RED' as const,
      phase: 'PLAY' as const,
      turn: 'RED' as const,
      plyCount: 4,
      result: null,
      pieces: [
        { id: 'RED-SCOUT-0', owner: 'RED' as const, pos: x, rank: 'SCOUT' as const, revealed: false },
        { id: 'RED-MINER-0', owner: 'RED' as const, pos: { r: 5, c: 0 }, rank: 'MINER' as const, revealed: false },
      ],
      // Oscillation history: X->Y then Y->X; a third X->Y is the banned repeat.
      myRecentMoves: {
        'RED-SCOUT-0': [
          { pieceId: 'RED-SCOUT-0', from: x, to: y },
          { pieceId: 'RED-SCOUT-0', from: y, to: x },
        ],
      },
    };
    const moves = legalMovesFromView(view);
    const thirdRepeat = moves.find(
      (m) => m.from.r === x.r && m.from.c === x.c && m.to.r === y.r && m.to.c === y.c,
    );
    expect(thirdRepeat).toBeUndefined();
    // Other moves for the oscillating scout (e.g. sideways) and for the other
    // piece remain available.
    expect(moves.some((m) => m.from.r === x.r && m.from.c === x.c && !(m.to.r === y.r && m.to.c === y.c))).toBe(true);
    expect(moves.some((m) => m.from.r === 5 && m.from.c === 0)).toBe(true);
  });
});
