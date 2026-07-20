import { describe, expect, test } from 'vitest';
import { validateAction } from '../../src/engine/validate.js';
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

describe('validateAction', () => {
  test('rejects MOVE during SETUP', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('rejects action from the wrong color', () => {
    const s = playState();
    const r = validateAction(s, { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('rejects moving onto own piece', () => {
    const s = playState();
    // find two adjacent red pieces on rows 6..9 in the same column
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 7, c: 0 } });
    expect(r).toBeTruthy(); // 7,0 is occupied by red in 'balanced'
  });
  test('accepts a legal forward move into the empty middle', () => {
    const s = playState();
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(r).toBeNull();
  });
  test('rejects SETUP_PLACE onto a non-setup row', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 5, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('accepts SETUP_PLACE onto an empty legal square', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 9, c: 0 } });
    expect(r).toBeNull();
  });
});
