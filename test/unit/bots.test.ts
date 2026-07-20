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

// Hand-crafted views for deterministic decision tests. Board note: lakes sit at
// rows 4-5, cols 2-3 and 6-7 — all squares used below avoid them.
type TestPiece = {
  id: string; owner: 'RED' | 'BLUE'; pos: { r: number; c: number };
  rank: import('../../src/engine/types.js').Rank | null; revealed: boolean;
};
function makeView(viewer: 'RED' | 'BLUE', pieces: TestPiece[]) {
  return {
    viewer, phase: 'PLAY' as const, turn: viewer, plyCount: 10, result: null,
    pieces, myRecentMoves: {},
  };
}

describe('heuristicBot attack discipline', () => {
  test('never attacks a revealed stronger piece when a non-attack move exists', () => {
    // RED MAJOR at (5,5); revealed BLUE MARSHAL forward at (4,5); empty squares elsewhere.
    const view = makeView('RED', [
      { id: 'RED-MAJOR-0', owner: 'RED', pos: { r: 5, c: 5 }, rank: 'MAJOR', revealed: false },
      { id: 'BLUE-MARSHAL-0', owner: 'BLUE', pos: { r: 4, c: 5 }, rank: 'MARSHAL', revealed: true },
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const action = heur(view, makeSeeded(seed));
      expect(action.type).toBe('MOVE');
      if (action.type === 'MOVE') {
        expect(action.to).not.toEqual({ r: 4, c: 5 });
      }
    }
  });

  test('never attacks a revealed bomb with a non-miner when a non-attack move exists', () => {
    const view = makeView('RED', [
      { id: 'RED-CAPTAIN-0', owner: 'RED', pos: { r: 5, c: 5 }, rank: 'CAPTAIN', revealed: false },
      { id: 'BLUE-BOMB-0', owner: 'BLUE', pos: { r: 4, c: 5 }, rank: 'BOMB', revealed: true },
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const action = heur(view, makeSeeded(seed));
      if (action.type === 'MOVE') expect(action.to).not.toEqual({ r: 4, c: 5 });
    }
  });

  test('a high-value piece does not attack an unknown piece when a non-attack move exists', () => {
    // Unknown enemy directly forward of the MARSHAL — the tempting "forward" move.
    const view = makeView('RED', [
      { id: 'RED-MARSHAL-0', owner: 'RED', pos: { r: 5, c: 5 }, rank: 'MARSHAL', revealed: false },
      { id: 'BLUE-p1', owner: 'BLUE', pos: { r: 4, c: 5 }, rank: null, revealed: false },
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const action = heur(view, makeSeeded(seed));
      if (action.type === 'MOVE') expect(action.to).not.toEqual({ r: 4, c: 5 });
    }
  });

  test('spy attacks a revealed marshal (known win via combat rules)', () => {
    const view = makeView('RED', [
      { id: 'RED-SPY-0', owner: 'RED', pos: { r: 5, c: 5 }, rank: 'SPY', revealed: false },
      { id: 'BLUE-MARSHAL-0', owner: 'BLUE', pos: { r: 4, c: 5 }, rank: 'MARSHAL', revealed: true },
    ]);
    const action = heur(view, makeSeeded(1));
    expect(action).toEqual({ type: 'MOVE', color: 'RED', from: { r: 5, c: 5 }, to: { r: 4, c: 5 } });
  });

  test('scout probes an adjacent unknown rather than retreating', () => {
    // Scout at (5,4): unknown enemy forward at (4,4); only other moves are
    // sideways/backward onto empty squares. Forward probe should win the bias.
    const view = makeView('RED', [
      { id: 'RED-SCOUT-0', owner: 'RED', pos: { r: 5, c: 4 }, rank: 'SCOUT', revealed: false },
      { id: 'BLUE-p2', owner: 'BLUE', pos: { r: 4, c: 4 }, rank: null, revealed: false },
    ]);
    const action = heur(view, makeSeeded(3));
    expect(action).toEqual({ type: 'MOVE', color: 'RED', from: { r: 5, c: 4 }, to: { r: 4, c: 4 } });
  });

  test('chases a revealed weaker piece even against the forward bias', () => {
    // RED CAPTAIN at (8,2); revealed BLUE LIEUTENANT at (8,8) on the same row.
    // Forward bias alone would move to (7,2); pursuit should step toward the
    // lieutenant instead, shrinking Manhattan distance.
    const view = makeView('RED', [
      { id: 'RED-CAPTAIN-0', owner: 'RED', pos: { r: 8, c: 2 }, rank: 'CAPTAIN', revealed: false },
      { id: 'BLUE-LIEUTENANT-0', owner: 'BLUE', pos: { r: 8, c: 8 }, rank: 'LIEUTENANT', revealed: true },
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const action = heur(view, makeSeeded(seed));
      expect(action).toEqual({ type: 'MOVE', color: 'RED', from: { r: 8, c: 2 }, to: { r: 8, c: 3 } });
    }
  });

  test('does not chase a revealed stronger piece', () => {
    // RED SCOUT at (8,5); revealed BLUE GENERAL at (8,8). The scout beats
    // nothing here, so it must ignore the general and fall back to forward bias.
    const view = makeView('RED', [
      { id: 'RED-SCOUT-1', owner: 'RED', pos: { r: 8, c: 5 }, rank: 'SCOUT', revealed: false },
      { id: 'BLUE-GENERAL-0', owner: 'BLUE', pos: { r: 8, c: 8 }, rank: 'GENERAL', revealed: true },
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const action = heur(view, makeSeeded(seed));
      if (action.type === 'MOVE') {
        // any move except stepping toward the general on the same row
        expect(action.to).not.toEqual({ r: 8, c: 6 });
      }
    }
  });

  test('when every legal move is a bad attack, still moves (no resign)', () => {
    // RED COLONEL boxed in: unknown enemies on all four sides.
    const view = makeView('RED', [
      { id: 'RED-COLONEL-0', owner: 'RED', pos: { r: 8, c: 5 }, rank: 'COLONEL', revealed: false },
      { id: 'BLUE-p3', owner: 'BLUE', pos: { r: 7, c: 5 }, rank: null, revealed: false },
      { id: 'BLUE-p4', owner: 'BLUE', pos: { r: 9, c: 5 }, rank: null, revealed: false },
      { id: 'BLUE-p5', owner: 'BLUE', pos: { r: 8, c: 4 }, rank: null, revealed: false },
      { id: 'BLUE-p6', owner: 'BLUE', pos: { r: 8, c: 6 }, rank: null, revealed: false },
    ]);
    const action = heur(view, makeSeeded(5));
    expect(action.type).toBe('MOVE');
  });
});
