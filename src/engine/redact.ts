import type { Color, GameResult, GameState, MoveRecord, Phase, PieceId, Rank, Square } from './types.js';

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
  // Move history for the viewer's OWN pieces only, keyed by their real id.
  // Never includes enemy recentMoves entries — those must not leak.
  myRecentMoves: Record<PieceId, MoveRecord[]>;
}

export function viewFor(state: GameState, viewer: Color): PlayerView {
  const pieces: VisiblePiece[] = [];
  const myRecentMoves: Record<PieceId, MoveRecord[]> = {};
  for (const p of Object.values(state.pieces)) {
    if (p.pos === null) continue; // captured pieces are off-board
    const own = p.owner === viewer;
    pieces.push({
      id: own ? p.id : p.viewId,
      owner: p.owner,
      pos: p.pos,
      rank: own || p.revealed ? p.rank : null,
      revealed: p.revealed,
    });
    if (own) {
      const recent = state.recentMoves[p.id];
      if (recent) myRecentMoves[p.id] = recent;
    }
  }
  return {
    viewer,
    phase: state.phase,
    turn: state.turn,
    plyCount: state.plyCount,
    pieces,
    result: state.result,
    myRecentMoves,
  };
}
