import { describe, expect, test } from 'vitest';
import {
  setupSquares, presetNames, presetPlacement, randomPlacement, isSetupComplete,
} from '../../src/engine/setups.js';
import { createGame, rosterPieceIds } from '../../src/engine/init.js';
import { SETUP_ROWS } from '../../src/engine/types.js';
import type { GameState } from '../../src/engine/types.js';

describe('setups', () => {
  test('setupSquares: 40 squares in the color back rows', () => {
    const sq = setupSquares('RED');
    expect(sq).toHaveLength(40);
    expect(sq.every((s) => SETUP_ROWS.RED.includes(s.r))).toBe(true);
  });
  test('every preset places all 40 pieces on distinct legal squares', () => {
    for (const name of presetNames()) {
      const placement = presetPlacement('RED', name)!;
      const ids = Object.keys(placement);
      expect(ids.sort()).toEqual(rosterPieceIds('RED').sort());
      const squares = Object.values(placement).map((s) => `${s.r},${s.c}`);
      expect(new Set(squares).size).toBe(40);
      expect(Object.values(placement).every((s) => SETUP_ROWS.RED.includes(s.r))).toBe(true);
    }
  });
  test('preset flag is on the very back row', () => {
    const placement = presetPlacement('RED', 'bombs-back')!;
    const flagSq = placement['RED-FLAG-0']!;
    expect(flagSq.r).toBe(9); // Red's back row
  });
  test('bombs-back flag is on the back row for both colors', () => {
    expect(presetPlacement('RED', 'bombs-back')!['RED-FLAG-0']!.r).toBe(9);
    expect(presetPlacement('BLUE', 'bombs-back')!['BLUE-FLAG-0']!.r).toBe(0);
  });
  test('randomPlacement uses all squares exactly once', () => {
    const order = rosterPieceIds('BLUE');
    const placement = randomPlacement('BLUE', order);
    const squares = Object.values(placement).map((s) => `${s.r},${s.c}`);
    expect(new Set(squares).size).toBe(40);
  });
  test('isSetupComplete true after applying a preset', () => {
    let s: GameState = createGame();
    const placement = presetPlacement('RED', 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    expect(isSetupComplete(s, 'RED')).toBe(true);
    expect(isSetupComplete(s, 'BLUE')).toBe(false);
  });
});
