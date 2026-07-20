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

// Deterministic PRNG (mulberry32) used only to permute the rank-free viewId
// labels below. Kept local so the engine has no dependency on src/rng.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(config: Partial<GameConfig> = {}): GameState {
  const rand = mulberry32(config.seed ?? 0x5717a7);
  const pieces: Record<PieceId, Piece> = {};
  for (const color of ['RED', 'BLUE'] as const) {
    // 40 opaque, rank-independent labels, shuffled deterministically so the
    // piece→viewId mapping never encodes rank but is stable across the game.
    const labels: string[] = [];
    for (let n = 0; n < 40; n++) labels.push(`${color}-p${n}`);
    for (let i = labels.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [labels[i], labels[j]] = [labels[j]!, labels[i]!];
    }
    let idx = 0;
    for (const rank of RANKS) {
      for (let i = 0; i < ROSTER[rank]; i++) {
        const id = `${color}-${rank}-${i}`;
        const viewId = labels[idx++]!;
        pieces[id] = { id, viewId, owner: color, rank, revealed: false, pos: null };
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
