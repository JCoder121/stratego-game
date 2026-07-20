import { describe, expect, test } from 'vitest';
import { violatesTwoSquare, recordMove } from '../../src/engine/rules.js';
import { createGame } from '../../src/engine/init.js';
import type { GameState, MoveRecord, Square } from '../../src/engine/types.js';

const A: Square = { r: 5, c: 5 };
const B: Square = { r: 5, c: 6 };

function withRecent(recent: MoveRecord[]): GameState {
  const s = createGame();
  s.pieces['RED-SCOUT-0']!.pos = A;
  s.phase = 'PLAY';
  s.recentMoves['RED-SCOUT-0'] = recent;
  return s;
}

describe('two-square rule', () => {
  test('first A->B is fine', () => {
    const s = withRecent([]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, B)).toBe(false);
  });
  test('A->B, B->A, then A->B again is illegal', () => {
    const s = withRecent([
      { pieceId: 'RED-SCOUT-0', from: A, to: B },
      { pieceId: 'RED-SCOUT-0', from: B, to: A },
    ]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, B)).toBe(true);
  });
  test('A->B, B->A, then A->C (different) is legal', () => {
    const C: Square = { r: 4, c: 5 };
    const s = withRecent([
      { pieceId: 'RED-SCOUT-0', from: A, to: B },
      { pieceId: 'RED-SCOUT-0', from: B, to: A },
    ]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, C)).toBe(false);
  });
});

describe('recordMove keeps last 3', () => {
  test('caps history length', () => {
    let rec: MoveRecord[] = [];
    for (let i = 0; i < 5; i++) rec = recordMove(rec, { pieceId: 'x', from: A, to: B });
    expect(rec.length).toBeLessThanOrEqual(3);
  });
});
