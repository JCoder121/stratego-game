import { BOARD_SIZE, LAKES, type Color, type Square } from '../../engine/index.js';

/**
 * Screen-space cell for a given viewer's orientation. RED sees the board as-authored (row 9 =
 * Red's back row, at the bottom of the DOM grid). BLUE sees it rotated 180° so BLUE's own back
 * row (row 0 in engine coordinates) renders at the bottom of BLUE's screen too.
 */
export function displayCell(sq: Square, viewer: Color): { row: number; col: number } {
  if (viewer === 'RED') return { row: sq.r, col: sq.c };
  return { row: BOARD_SIZE - 1 - sq.r, col: BOARD_SIZE - 1 - sq.c };
}

/** Inverse of displayCell — the 180° flip is its own inverse, so this shares its shape. */
export function boardSquare(row: number, col: number, viewer: Color): Square {
  if (viewer === 'RED') return { r: row, c: col };
  return { r: BOARD_SIZE - 1 - row, c: BOARD_SIZE - 1 - col };
}

const LAKE_KEYS = new Set(LAKES.map((sq) => `${sq.r},${sq.c}`));

/** Whether the screen cell (row, col) under viewer's orientation is a lake square. */
export function isLakeCell(row: number, col: number, viewer: Color): boolean {
  const sq = boardSquare(row, col, viewer);
  return LAKE_KEYS.has(`${sq.r},${sq.c}`);
}
