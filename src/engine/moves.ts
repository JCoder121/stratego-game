import { inBounds, isLake } from './board.js';
import { isMovable, isScout } from './pieceDefs.js';
import { pieceAt } from './init.js';
import type { Color, GameState, PieceId, Square } from './types.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

export function destinationsFor(state: GameState, pieceId: PieceId): Square[] {
  const p = state.pieces[pieceId];
  if (!p || !p.pos || !isMovable(p.rank)) return [];
  const from = p.pos;
  const out: Square[] = [];
  const maxSteps = isScout(p.rank) ? 9 : 1;
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= maxSteps; step++) {
      const to: Square = { r: from.r + dr * step, c: from.c + dc * step };
      if (!inBounds(to) || isLake(to)) break;
      const occupant = pieceAt(state, to);
      if (!occupant) { out.push(to); continue; }
      if (occupant.owner !== p.owner) out.push(to); // attack, then blocked
      break; // stop at first occupied square either way
    }
  }
  return out;
}

export function legalMovesForColor(
  state: GameState,
  color: Color,
): { from: Square; to: Square }[] {
  const moves: { from: Square; to: Square }[] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.owner !== color || !p.pos) continue;
    for (const to of destinationsFor(state, p.id)) moves.push({ from: p.pos, to });
  }
  return moves;
}
