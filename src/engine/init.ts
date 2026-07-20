import {
  DEFAULT_MAX_PLIES, RANKS, ROSTER,
  type Color, type GameConfig, type GameState, type Piece, type PieceId, type Square,
} from './types.js';
import { sameSquare } from './board.js';

export function rosterPieceIds(color: Color): PieceId[] {
  const ids: PieceId[] = [];
  for (const rank of RANKS) {
    for (let i = 0; i < ROSTER[rank]; i++) ids.push(`${color}-${rank}-${i}`);
  }
  return ids;
}

export function createGame(config: Partial<GameConfig> = {}): GameState {
  const pieces: Record<PieceId, Piece> = {};
  for (const color of ['RED', 'BLUE'] as const) {
    for (const rank of RANKS) {
      for (let i = 0; i < ROSTER[rank]; i++) {
        const id = `${color}-${rank}-${i}`;
        pieces[id] = { id, owner: color, rank, revealed: false, pos: null };
      }
    }
  }
  return {
    config: { maxPlies: config.maxPlies ?? DEFAULT_MAX_PLIES, seed: config.seed },
    phase: 'SETUP',
    turn: 'RED',
    plyCount: 0,
    pieces,
    setupDone: { RED: false, BLUE: false },
    recentMoves: {},
    result: null,
  };
}

export function pieceAt(state: GameState, sq: Square): Piece | null {
  for (const p of Object.values(state.pieces)) {
    if (p.pos && sameSquare(p.pos, sq)) return p;
  }
  return null;
}

export function piecesOf(state: GameState, color: Color): Piece[] {
  return Object.values(state.pieces).filter((p) => p.owner === color);
}
