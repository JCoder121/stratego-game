import { describe, expect, test } from 'vitest';
import { createGame, strategoReduce, pieceAt } from '../../src/engine/index.js';
import type { Color, GameEvent, GameState, PieceId, Square } from '../../src/engine/types.js';

// Directly-constructed mid-game state (existing convention, cf. test/unit/reduce.test.ts).
// Both sides get their FLAG plus the listed pieces; add a far-corner SCOUT per side
// ("spares") so applyEndConditions doesn't end the game accidentally.
function stateWith(
  placements: Array<[PieceId, Square]>,
  opts: { turn?: Color; spares?: boolean; maxPlies?: number } = {},
): GameState {
  const s = createGame({ maxPlies: opts.maxPlies ?? 2000 });
  s.pieces['RED-FLAG-0']!.pos = { r: 9, c: 9 };
  s.pieces['BLUE-FLAG-0']!.pos = { r: 0, c: 9 };
  if (opts.spares !== false) {
    s.pieces['RED-SCOUT-7']!.pos = { r: 9, c: 4 };
    s.pieces['BLUE-SCOUT-7']!.pos = { r: 0, c: 4 };
  }
  for (const [id, sq] of placements) s.pieces[id]!.pos = sq;
  s.setupDone.RED = true;
  s.setupDone.BLUE = true;
  s.phase = 'PLAY';
  s.turn = opts.turn ?? 'RED';
  return s;
}

const mv = (color: Color, from: Square, to: Square) =>
  ({ type: 'MOVE', color, from, to }) as const;

function strikeEvent(events: GameEvent[]) {
  return events.find((e): e is Extract<GameEvent, { type: 'STRIKE' }> => e.type === 'STRIKE');
}

describe('combat table', () => {
  test('Spy attacking Marshal wins', () => {
    const s = stateWith([
      ['RED-SPY-0', { r: 5, c: 0 }],
      ['BLUE-MARSHAL-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('ATTACKER');
    expect(state.pieces['BLUE-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['RED-SPY-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Marshal attacking Spy wins (spy power is attack-only)', () => {
    const s = stateWith([
      ['RED-MARSHAL-0', { r: 5, c: 0 }],
      ['BLUE-SPY-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('ATTACKER');
    expect(state.pieces['BLUE-SPY-0']!.pos).toBeNull();
  });

  test('Spy attacking anything else dies', () => {
    const s = stateWith([
      ['RED-SPY-0', { r: 5, c: 0 }],
      ['BLUE-SCOUT-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('DEFENDER');
    expect(state.pieces['RED-SPY-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-SCOUT-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('equal ranks: both die', () => {
    const s = stateWith([
      ['RED-MAJOR-0', { r: 5, c: 0 }],
      ['BLUE-MAJOR-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('BOTH');
    expect(state.pieces['RED-MAJOR-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-MAJOR-0']!.pos).toBeNull();
  });

  test('both combatants become permanently revealed after a strike', () => {
    const s = stateWith([
      ['RED-GENERAL-0', { r: 5, c: 0 }],
      ['BLUE-COLONEL-0', { r: 4, c: 0 }],
    ]);
    const { state } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(state.pieces['RED-GENERAL-0']!.revealed).toBe(true);
    expect(state.pieces['BLUE-COLONEL-0']!.revealed).toBe(true); // captured but still marked
  });
});

describe('bombs and miners', () => {
  test('non-Miner attacking a Bomb dies; Bomb stays on the board', () => {
    const s = stateWith([
      ['RED-MARSHAL-0', { r: 5, c: 0 }],
      ['BLUE-BOMB-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('DEFENDER');
    expect(state.pieces['RED-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-BOMB-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Miner defuses a Bomb: bomb removed, miner moves in', () => {
    const s = stateWith([
      ['RED-MINER-0', { r: 5, c: 0 }],
      ['BLUE-BOMB-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(events.some((e) => e.type === 'BOMB_DEFUSED')).toBe(true);
    expect(state.pieces['BLUE-BOMB-0']!.pos).toBeNull();
    expect(state.pieces['RED-MINER-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Bombs and Flags cannot move', () => {
    const s = stateWith([['RED-BOMB-0', { r: 5, c: 0 }]]);
    const bombMove = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(bombMove.events[0]!.type).toBe('REJECTED');
    const flagMove = strategoReduce(s, mv('RED', { r: 9, c: 9 }, { r: 8, c: 9 }));
    expect(flagMove.events[0]!.type).toBe('REJECTED');
  });
});

describe('movement', () => {
  test('non-Scout may not move two squares or diagonally', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 7, c: 0 }]]);
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 5, c: 0 })).events[0]!.type).toBe('REJECTED');
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 1 })).events[0]!.type).toBe('REJECTED');
  });

  test('may not move onto an own piece', () => {
    const s = stateWith([
      ['RED-CAPTAIN-0', { r: 7, c: 0 }],
      ['RED-MINER-0', { r: 6, c: 0 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 })).events[0]!.type).toBe('REJECTED');
  });

  test('Scout slides any distance along an open line', () => {
    const s = stateWith([['RED-SCOUT-0', { r: 8, c: 0 }]]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 2, c: 0 }));
    expect(events[0]!.type).toBe('PIECE_MOVED');
    expect(state.pieces['RED-SCOUT-0']!.pos).toEqual({ r: 2, c: 0 });
  });

  test('Scout multi-square move reveals it', () => {
    const s = stateWith([['RED-SCOUT-0', { r: 8, c: 0 }]]);
    const { state } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 2, c: 0 }));
    expect(state.pieces['RED-SCOUT-0']!.revealed).toBe(true);
  });

  test('Scout cannot jump over a piece', () => {
    const s = stateWith([
      ['RED-SCOUT-0', { r: 8, c: 0 }],
      ['BLUE-MINER-0', { r: 5, c: 0 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 3, c: 0 })).events[0]!.type).toBe('REJECTED');
  });

  test('Scout move-and-strike: attacks first occupied square along the line', () => {
    const s = stateWith([
      ['RED-SCOUT-0', { r: 8, c: 0 }],
      ['BLUE-MINER-0', { r: 4, c: 0 }],
    ]);
    const { events } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 4, c: 0 }));
    // rankValue(SCOUT)=2 < rankValue(MINER)=3, so MINER outranks SCOUT: attacker (Scout) loses.
    expect(strikeEvent(events)?.outcome).toBe('DEFENDER');
  });

  test('lake squares block movement and Scout lines', () => {
    // {r:4,c:2} is a lake. CAPTAIN beside it cannot enter; Scout line stops.
    const s = stateWith([
      ['RED-CAPTAIN-0', { r: 4, c: 1 }],
      ['RED-SCOUT-0', { r: 9, c: 2 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 4, c: 1 }, { r: 4, c: 2 })).events[0]!.type).toBe('REJECTED');
    expect(strategoReduce(s, mv('RED', { r: 9, c: 2 }, { r: 4, c: 2 })).events[0]!.type).toBe('REJECTED');
  });
});

describe('two-square rule', () => {
  test('third identical back-and-forth traversal is rejected; other moves remain legal', () => {
    let s = stateWith([
      ['RED-CAPTAIN-0', { r: 7, c: 0 }],
      ['BLUE-CAPTAIN-0', { r: 2, c: 9 }],
    ]);
    const a: Square = { r: 7, c: 0 };
    const b: Square = { r: 6, c: 0 };
    const blueA: Square = { r: 2, c: 9 };
    const blueB: Square = { r: 3, c: 9 };
    // RED oscillates a->b, b->a while BLUE shuffles elsewhere.
    s = strategoReduce(s, mv('RED', a, b)).state;
    s = strategoReduce(s, mv('BLUE', blueA, blueB)).state;
    s = strategoReduce(s, mv('RED', b, a)).state;
    s = strategoReduce(s, mv('BLUE', blueB, blueA)).state;
    // Third traversal of a->b: must be rejected.
    const third = strategoReduce(s, mv('RED', a, b));
    expect(third.events[0]!.type).toBe('REJECTED');
    // But a different move by the same piece is fine.
    const sideways = strategoReduce(s, mv('RED', a, { r: 7, c: 1 }));
    expect(sideways.events[0]!.type).not.toBe('REJECTED');
  });

  test('a strike resets the oscillation history', () => {
    // CORRECTED from the brief: the original scenario made the strike itself the
    // third consecutive a<->b traversal, so `validateAction` rejects it via
    // `violatesTwoSquare` (from/to pattern match, irrespective of what occupies the
    // destination) *before* the strike-clears-history logic in reduce.ts ever runs.
    // Per README.md ("Two-square rule") and the design spec (2026-07-19, line 87),
    // the rule is stated with no capture exception, so that REJECTED is the engine
    // behaving as documented, not a bug (verified against src/engine/rules.ts
    // violatesTwoSquare + src/engine/validate.ts, which check the pattern before any
    // strike/target logic is reached). Re-scoped the scenario to test the documented
    // reset in isolation: build a *non-empty*, non-two-square-triggering history via
    // one quiet move, then strike to a third square and assert the mover's history
    // clears to [] (src/engine/reduce.ts: `s.recentMoves[mover.id] = [];`).
    let s = stateWith([
      ['RED-MARSHAL-0', { r: 7, c: 0 }],
      ['BLUE-MINER-0', { r: 6, c: 1 }],
      ['BLUE-CAPTAIN-0', { r: 2, c: 9 }],
    ]);
    const a: Square = { r: 7, c: 0 };
    const b: Square = { r: 6, c: 0 };
    const c: Square = { r: 6, c: 1 }; // BLUE-MINER-0's square, adjacent to b
    s = strategoReduce(s, mv('RED', a, b)).state; // quiet move; recentMoves[MARSHAL] = [{a,b}]
    s = strategoReduce(s, mv('BLUE', { r: 2, c: 9 }, { r: 3, c: 9 })).state;
    expect(s.recentMoves['RED-MARSHAL-0']).toEqual([{ pieceId: 'RED-MARSHAL-0', from: a, to: b }]);
    // RED strikes the miner at c (not a repeat of any prior a/b pair) — legal, and the
    // strike should clear the mover's oscillation history afterward.
    const strike = strategoReduce(s, mv('RED', b, c));
    expect(strike.events[0]!.type).not.toBe('REJECTED');
    expect(strikeEvent(strike.events)?.outcome).toBe('ATTACKER');
    expect(strike.state.recentMoves['RED-MARSHAL-0']).toEqual([]);
  });
});

describe('end conditions', () => {
  test('flag capture ends the game immediately with FLAG_CAPTURED', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 0, c: 8 }]]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 0, c: 8 }, { r: 0, c: 9 }));
    expect(events.some((e) => e.type === 'FLAG_CAPTURED')).toBe(true);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: 'RED', reason: 'FLAG_CAPTURED' });
  });

  test('player with no legal action loses (NO_MOVES) when the turn passes to them', () => {
    // BLUE has only its flag + a bomb (immovable): after RED's move, BLUE has no action.
    const s = stateWith(
      [
        ['RED-CAPTAIN-0', { r: 7, c: 0 }],
        ['BLUE-BOMB-0', { r: 0, c: 0 }],
      ],
      { spares: false },
    );
    // Give RED a second movable piece so dead-position doesn't fire for RED... not needed:
    // RED-CAPTAIN-0 remains movable, so only BLUE is stuck.
    const { state } = strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: 'RED', reason: 'NO_MOVES' });
  });

  test('neither side movable → DEAD_POSITION draw', () => {
    // RED SERGEANT strikes BLUE SERGEANT (equal → BOTH die), leaving only flags.
    const s = stateWith(
      [
        ['RED-SERGEANT-0', { r: 5, c: 0 }],
        ['BLUE-SERGEANT-0', { r: 4, c: 0 }],
      ],
      { spares: false },
    );
    const { state } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: null, reason: 'DEAD_POSITION' });
  });

  test('ply cap → draw at maxPlies', () => {
    const s = stateWith(
      [
        ['RED-CAPTAIN-0', { r: 7, c: 0 }],
        ['BLUE-CAPTAIN-0', { r: 2, c: 0 }],
      ],
      { maxPlies: 1 },
    );
    const { state } = strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: null, reason: 'PLY_CAP' });
  });

  test('actions after GAME_OVER are rejected', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 0, c: 8 }]]);
    const over = strategoReduce(s, mv('RED', { r: 0, c: 8 }, { r: 0, c: 9 })).state;
    const after = strategoReduce(over, mv('BLUE', { r: 0, c: 4 }, { r: 1, c: 4 }));
    expect(after.events[0]!.type).toBe('REJECTED');
  });
});
