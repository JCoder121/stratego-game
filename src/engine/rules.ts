import { sameSquare } from './board.js';
import { legalMovesForColor } from './moves.js';
import { isMovable } from './pieceDefs.js';
import type { Color, GameState, MoveRecord, PieceId, Square } from './types.js';

export function recordMove(recent: MoveRecord[], rec: MoveRecord): MoveRecord[] {
  return [...recent, rec].slice(-3);
}

export function violatesTwoSquare(
  state: GameState,
  pieceId: PieceId,
  from: Square,
  to: Square,
): boolean {
  const recent = state.recentMoves[pieceId] ?? [];
  if (recent.length < 2) return false;
  const prev = recent[recent.length - 1]!; // Y->X most recent
  const prev2 = recent[recent.length - 2]!; // X->Y before that
  // Illegal if the new move X->Y repeats prev2, and prev was its exact reverse.
  const newIsRepeatOfPrev2 = sameSquare(prev2.from, from) && sameSquare(prev2.to, to);
  const prevIsReverseOfPrev2 =
    sameSquare(prev.from, prev2.to) && sameSquare(prev.to, prev2.from);
  return newIsRepeatOfPrev2 && prevIsReverseOfPrev2;
}

export function movablePieceCount(state: GameState, color: Color): number {
  return Object.values(state.pieces).filter(
    (p) => p.owner === color && p.pos !== null && isMovable(p.rank),
  ).length;
}

export function hasAnyLegalAction(state: GameState, color: Color): boolean {
  const moves = legalMovesForColor(state, color);
  for (const m of moves) {
    const occupant = Object.values(state.pieces).find(
      (p) => p.pos && sameSquare(p.pos, m.from),
    );
    if (!occupant) continue;
    if (!violatesTwoSquare(state, occupant.id, m.from, m.to)) return true;
  }
  return false;
}
