import type { Color, GameResult, GameState, Phase, PieceId, Rank, Square } from './types.js';

export interface VisiblePiece {
  id: PieceId;
  owner: Color;
  pos: Square;
  rank: Rank | null; // null ⇒ hidden enemy
  revealed: boolean;
}

export interface PlayerView {
  viewer: Color;
  phase: Phase;
  turn: Color;
  plyCount: number;
  pieces: VisiblePiece[];
  result: GameResult | null;
}

export function viewFor(state: GameState, viewer: Color): PlayerView {
  const pieces: VisiblePiece[] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.pos === null) continue; // captured pieces are off-board
    const own = p.owner === viewer;
    pieces.push({
      id: p.id,
      owner: p.owner,
      pos: p.pos,
      rank: own || p.revealed ? p.rank : null,
      revealed: p.revealed,
    });
  }
  return {
    viewer,
    phase: state.phase,
    turn: state.turn,
    plyCount: state.plyCount,
    pieces,
    result: state.result,
  };
}
