import { describe, expect, test } from 'vitest';
import { strategoReduce } from '../../src/engine/reduce.js';
import { createGame } from '../../src/engine/init.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    s.setupDone[color] = true;
  }
  s.phase = 'PLAY';
  s.turn = 'RED';
  return s;
}

describe('reducer totality', () => {
  test('junk action → unchanged state + REJECTED', () => {
    const s = createGame();
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 0, c: 0 }, to: { r: 1, c: 0 } });
    expect(state).toEqual(s);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('REJECTED');
  });
  test('does not mutate input state', () => {
    const s = createGame();
    const snapshot = JSON.parse(JSON.stringify(s));
    strategoReduce(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 9, c: 0 } });
    expect(s).toEqual(snapshot);
  });
});

describe('setup flow', () => {
  test('SETUP_PRESET then SETUP_DONE for both starts PLAY', () => {
    let s = createGame();
    let r = strategoReduce(s, { type: 'SETUP_PRESET', color: 'RED', preset: 'balanced' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_DONE', color: 'RED' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_PRESET', color: 'BLUE', preset: 'balanced' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_DONE', color: 'BLUE' });
    s = r.state;
    expect(s.phase).toBe('PLAY');
    expect(r.events.some((e) => e.type === 'PLAY_STARTED')).toBe(true);
  });
});

describe('moves and combat', () => {
  test('a quiet move advances the turn', () => {
    const s = playState();
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(events.some((e) => e.type === 'PIECE_MOVED')).toBe(true);
    expect(state.turn).toBe('BLUE');
    expect(state.plyCount).toBe(1);
  });
  test('attacker beats lower defender and moves in', () => {
    const s = playState();
    // place a red scout adjacent above a blue scout in open ground
    s.pieces['RED-SCOUT-0']!.pos = { r: 5, c: 0 };
    s.pieces['BLUE-MARSHAL-0']!.pos = { r: 4, c: 0 };
    // Red spy attacks blue marshal for a deterministic ATTACKER result
    s.pieces['RED-SPY-0']!.pos = { r: 5, c: 1 };
    s.pieces['BLUE-MARSHAL-0']!.pos = { r: 4, c: 1 };
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 5, c: 1 }, to: { r: 4, c: 1 } });
    expect(events.some((e) => e.type === 'STRIKE')).toBe(true);
    expect(state.pieces['BLUE-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['RED-SPY-0']!.pos).toEqual({ r: 4, c: 1 });
  });
  test('capturing the flag ends the game', () => {
    const s = playState();
    s.pieces['RED-MARSHAL-0']!.pos = { r: 1, c: 0 };
    // clear the preset's original occupant of r0c0 so the flag is the sole piece there
    s.pieces['BLUE-MARSHAL-0']!.pos = null;
    s.pieces['BLUE-FLAG-0']!.pos = { r: 0, c: 0 };
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 1, c: 0 }, to: { r: 0, c: 0 } });
    expect(events.some((e) => e.type === 'FLAG_CAPTURED')).toBe(true);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result?.winner).toBe('RED');
  });
  test('non-miner attacking a bomb dies, bomb stays', () => {
    const s = playState();
    // clear the preset's original occupants of these squares for a clean scenario
    s.pieces['BLUE-SERGEANT-0']!.pos = null;
    s.pieces['BLUE-MAJOR-1']!.pos = null;
    s.pieces['RED-CAPTAIN-0']!.pos = { r: 1, c: 5 };
    s.pieces['BLUE-BOMB-0']!.pos = { r: 0, c: 5 };
    const { state } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 1, c: 5 }, to: { r: 0, c: 5 } });
    expect(state.pieces['RED-CAPTAIN-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-BOMB-0']!.pos).toEqual({ r: 0, c: 5 });
  });
});
