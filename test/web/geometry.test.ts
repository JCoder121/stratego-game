import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, LAKES, type Square } from '../../src/engine/index.js';
import { boardSquare, displayCell, isLakeCell } from '../../src/web/board/geometry.js';

describe('displayCell', () => {
  it('is identity for RED', () => {
    expect(displayCell({ r: 9, c: 0 }, 'RED')).toEqual({ row: 9, col: 0 });
    expect(displayCell({ r: 0, c: 5 }, 'RED')).toEqual({ row: 0, col: 5 });
  });

  it('is a 180deg flip for BLUE', () => {
    expect(displayCell({ r: 0, c: 0 }, 'BLUE')).toEqual({ row: 9, col: 9 });
    expect(displayCell({ r: 9, c: 9 }, 'BLUE')).toEqual({ row: 0, col: 0 });
    expect(displayCell({ r: 0, c: 3 }, 'BLUE')).toEqual({ row: 9, col: 6 });
  });
});

describe('boardSquare', () => {
  it('roundtrips with displayCell over all 100 squares, both colors', () => {
    for (const viewer of ['RED', 'BLUE'] as const) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const sq: Square = { r, c };
          const { row, col } = displayCell(sq, viewer);
          expect(boardSquare(row, col, viewer)).toEqual(sq);
        }
      }
    }
  });
});

describe('isLakeCell', () => {
  it('finds lake squares at the engine LAKES positions for RED (identity orientation)', () => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const expected = LAKES.some((l) => l.r === r && l.c === c);
        expect(isLakeCell(r, c, 'RED')).toBe(expected);
      }
    }
  });

  it('finds lake squares at their flipped screen position for BLUE', () => {
    for (const lake of LAKES) {
      const { row, col } = displayCell(lake, 'BLUE');
      expect(isLakeCell(row, col, 'BLUE')).toBe(true);
    }
  });

  it('non-lake cells are not flagged as lakes, for both viewers', () => {
    expect(isLakeCell(0, 0, 'RED')).toBe(false);
    expect(isLakeCell(0, 0, 'BLUE')).toBe(false);
    expect(isLakeCell(9, 9, 'RED')).toBe(false);
    expect(isLakeCell(9, 9, 'BLUE')).toBe(false);
  });
});
