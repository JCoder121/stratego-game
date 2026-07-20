import type { Bot } from './types.js';
import { legalMovesFromView } from './moves-from-view.js';
import { rankValue } from '../engine/pieceDefs.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

function at(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
}

export const heuristicBot: Bot = (view, rng) => {
  const moves = legalMovesFromView(view);
  if (moves.length === 0) return { type: 'RESIGN', color: view.viewer };

  // 1) capture a known enemy flag
  for (const m of moves) {
    const target = at(view, m.to);
    if (target && target.owner !== view.viewer && target.rank === 'FLAG') {
      return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
    }
  }
  // 2) attack a revealed enemy we strictly outrank
  const winning = moves.filter((m) => {
    const target = at(view, m.to);
    const mover = at(view, m.from);
    if (!target || target.owner === view.viewer) return false;
    if (target.rank === null || mover?.rank == null) return false; // unknown → skip
    if (target.rank === 'BOMB' && mover.rank !== 'MINER') return false;
    return rankValue(mover.rank) > rankValue(target.rank);
  });
  if (winning.length > 0) {
    const m = winning[rng.int(winning.length)]!;
    return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
  }
  // 3) forward-biased random (RED advances toward row 0, BLUE toward row 9)
  const forward = moves.filter((m) => (view.viewer === 'RED' ? m.to.r < m.from.r : m.to.r > m.from.r));
  const pool = forward.length > 0 ? forward : moves;
  const m = pool[rng.int(pool.length)]!;
  return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
};
