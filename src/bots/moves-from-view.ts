import { inBounds, isLake } from '../engine/board.js';
import { isMovable, isScout } from '../engine/pieceDefs.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function occupantAt(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
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
        if (!occ) { out.push({ from: p.pos, to }); continue; }
        if (occ.owner !== view.viewer) out.push({ from: p.pos, to });
        break;
      }
    }
  }
  return out;
}
