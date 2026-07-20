import { BOARD_SIZE, LAKES, type Square } from './types.js';

export function inBounds(sq: Square): boolean {
  return sq.r >= 0 && sq.r < BOARD_SIZE && sq.c >= 0 && sq.c < BOARD_SIZE;
}

export function isLake(sq: Square): boolean {
  return LAKES.some((l) => l.r === sq.r && l.c === sq.c);
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.r === b.r && a.c === b.c;
}

export function isAdjacent(a: Square, b: Square): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return dr + dc === 1;
}

// Interior squares strictly between a and b along a straight orthogonal line.
// null if not colinear orthogonally or same square.
export function stepsBetween(a: Square, b: Square): Square[] | null {
  if (sameSquare(a, b)) return null;
  if (a.r !== b.r && a.c !== b.c) return null;
  const out: Square[] = [];
  if (a.r === b.r) {
    const step = b.c > a.c ? 1 : -1;
    for (let c = a.c + step; c !== b.c; c += step) out.push({ r: a.r, c });
  } else {
    const step = b.r > a.r ? 1 : -1;
    for (let r = a.r + step; r !== b.r; r += step) out.push({ r, c: a.c });
  }
  return out;
}

// Columns a..j (c 0..9); ranks 1..10 from Red's side (r 9 = rank 1, r 0 = rank 10).
export function toAlg(sq: Square): string {
  const file = String.fromCharCode('a'.charCodeAt(0) + sq.c);
  return `${file}${BOARD_SIZE - sq.r}`;
}

export function fromAlg(s: string): Square | null {
  const m = /^([a-j])(\d{1,2})$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  const c = m[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(m[2]);
  if (rank < 1 || rank > BOARD_SIZE) return null;
  const r = BOARD_SIZE - rank;
  return { r, c };
}
