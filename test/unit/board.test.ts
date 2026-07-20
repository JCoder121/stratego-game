import { describe, expect, test } from 'vitest';
import { inBounds, isLake, isAdjacent, stepsBetween, toAlg, fromAlg } from '../../src/engine/board.js';

describe('board geometry', () => {
  test('inBounds', () => {
    expect(inBounds({ r: 0, c: 0 })).toBe(true);
    expect(inBounds({ r: 9, c: 9 })).toBe(true);
    expect(inBounds({ r: -1, c: 0 })).toBe(false);
    expect(inBounds({ r: 10, c: 0 })).toBe(false);
  });
  test('isLake matches the two 2x2 lakes', () => {
    expect(isLake({ r: 4, c: 2 })).toBe(true);
    expect(isLake({ r: 5, c: 7 })).toBe(true);
    expect(isLake({ r: 4, c: 4 })).toBe(false);
    expect(isLake({ r: 0, c: 0 })).toBe(false);
  });
  test('isAdjacent orthogonal only', () => {
    expect(isAdjacent({ r: 3, c: 3 }, { r: 3, c: 4 })).toBe(true);
    expect(isAdjacent({ r: 3, c: 3 }, { r: 4, c: 4 })).toBe(false); // diagonal
    expect(isAdjacent({ r: 3, c: 3 }, { r: 3, c: 5 })).toBe(false); // two away
  });
  test('stepsBetween returns interior squares on a straight line', () => {
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 3 })).toEqual([{ r: 0, c: 1 }, { r: 0, c: 2 }]);
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 1 })).toEqual([]);
    expect(stepsBetween({ r: 0, c: 0 }, { r: 3, c: 3 })).toBeNull(); // diagonal
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 0 })).toBeNull(); // same square
  });
  test('algebraic round-trip', () => {
    expect(toAlg({ r: 9, c: 0 })).toBe('a1');
    expect(toAlg({ r: 0, c: 0 })).toBe('a10');
    expect(fromAlg('a1')).toEqual({ r: 9, c: 0 });
    expect(fromAlg('j10')).toEqual({ r: 0, c: 9 });
    expect(fromAlg('z9')).toBeNull();
  });
});
