import { inBounds, isLake, sameSquare } from '../engine/board.js';
import { isMovable, isScout } from '../engine/pieceDefs.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function occupantAt(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
}

// Mirrors violatesTwoSquare (src/engine/rules.ts) but reads from the viewer's
// own myRecentMoves instead of full GameState, since bots only ever see a
// PlayerView. Illegal iff the piece's last two recorded moves were exactly
// from->to then to->from, and the candidate move repeats from->to.
function violatesTwoSquareFromView(view: PlayerView, pieceId: string, from: Square, to: Square): boolean {
  const recent = view.myRecentMoves[pieceId] ?? [];
  if (recent.length < 2) return false;
  const prev = recent[recent.length - 1]!; // Y->X most recent
  const prev2 = recent[recent.length - 2]!; // X->Y before that
  const newIsRepeatOfPrev2 = sameSquare(prev2.from, from) && sameSquare(prev2.to, to);
  const prevIsReverseOfPrev2 =
    sameSquare(prev.from, prev2.to) && sameSquare(prev.to, prev2.from);
  return newIsRepeatOfPrev2 && prevIsReverseOfPrev2;
}

export function legalMovesFromView(view: PlayerView): { from: Square; to: Square }[] {
  const out: { from: Square; to: Square }[] = [];
  for (const p of view.pieces) {
    if (p.owner !== view.viewer) continue;
    // Own pieces always show rank; treat null rank defensively as immovable.
    if (p.rank === null || !isMovable(p.rank)) continue;
    const maxSteps = isScout(p.rank) ? 9 : 1;
    for (const [dr, dc] of DIRS) {
      for (let step = 1; step <= maxSteps; step++) {
        const to: Square = { r: p.pos.r + dr * step, c: p.pos.c + dc * step };
        if (!inBounds(to) || isLake(to)) break;
        const occ = occupantAt(view, to);
        if (!occ) {
          if (!violatesTwoSquareFromView(view, p.id, p.pos, to)) out.push({ from: p.pos, to });
          continue;
        }
        if (occ.owner !== view.viewer) {
          if (!violatesTwoSquareFromView(view, p.id, p.pos, to)) out.push({ from: p.pos, to });
        }
        break;
      }
    }
  }
  return out;
}
