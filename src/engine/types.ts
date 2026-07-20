export type Color = 'RED' | 'BLUE';

export type Rank =
  | 'MARSHAL' | 'GENERAL' | 'COLONEL' | 'MAJOR' | 'CAPTAIN'
  | 'LIEUTENANT' | 'SERGEANT' | 'MINER' | 'SCOUT' | 'SPY'
  | 'BOMB' | 'FLAG';

export interface Square { r: number; c: number }
export type PieceId = string;

export interface Piece {
  id: PieceId;
  owner: Color;
  rank: Rank;
  revealed: boolean;
  pos: Square | null; // null ⇒ captured/off-board
}

export type Phase = 'SETUP' | 'PLAY' | 'GAME_OVER';

export interface GameConfig { maxPlies: number; seed?: number }

export type MoveRecord = { pieceId: PieceId; from: Square; to: Square };

export interface GameResult {
  winner: Color | null; // null ⇒ draw
  reason: 'FLAG_CAPTURED' | 'NO_MOVES' | 'RESIGN' | 'PLY_CAP' | 'DEAD_POSITION';
}

export interface GameState {
  config: GameConfig;
  phase: Phase;
  turn: Color;
  plyCount: number;
  pieces: Record<PieceId, Piece>;
  setupDone: Record<Color, boolean>;
  recentMoves: Record<PieceId, MoveRecord[]>;
  result: GameResult | null;
}

// ---- Actions (input) ----
export type Action =
  | { type: 'SETUP_PLACE'; color: Color; pieceId: PieceId; to: Square }
  | { type: 'SETUP_PRESET'; color: Color; preset: string }
  | { type: 'SETUP_RANDOM'; color: Color; order: PieceId[] } // order = shuffled placement supplied by shell
  | { type: 'SETUP_DONE'; color: Color }
  | { type: 'MOVE'; color: Color; from: Square; to: Square } // attack = MOVE onto enemy square
  | { type: 'RESIGN'; color: Color };

// ---- Events (output) ----
export type GameEvent =
  | { type: 'SETUP_PLACED'; color: Color; pieceId: PieceId; to: Square }
  | { type: 'SETUP_CLEARED'; color: Color }
  | { type: 'SETUP_COMPLETED'; color: Color }
  | { type: 'PLAY_STARTED' }
  | { type: 'PIECE_MOVED'; pieceId: PieceId; from: Square; to: Square }
  | { type: 'STRIKE'; attacker: PieceId; defender: PieceId; attackerRank: Rank; defenderRank: Rank; outcome: 'ATTACKER' | 'DEFENDER' | 'BOTH' }
  | { type: 'PIECE_CAPTURED'; pieceId: PieceId }
  | { type: 'BOMB_DEFUSED'; bombId: PieceId; minerId: PieceId }
  | { type: 'FLAG_CAPTURED'; flagId: PieceId; by: PieceId }
  | { type: 'TURN_PASSED'; to: Color }
  | { type: 'GAME_OVER'; result: GameResult }
  | { type: 'REJECTED'; reason: string };

// ---- Constants ----
export const BOARD_SIZE = 10;
export const DEFAULT_MAX_PLIES = 2000;

export const RANKS: Rank[] = [
  'MARSHAL', 'GENERAL', 'COLONEL', 'MAJOR', 'CAPTAIN',
  'LIEUTENANT', 'SERGEANT', 'MINER', 'SCOUT', 'SPY', 'BOMB', 'FLAG',
];

export const ROSTER: Record<Rank, number> = {
  MARSHAL: 1, GENERAL: 1, COLONEL: 2, MAJOR: 3, CAPTAIN: 4,
  LIEUTENANT: 4, SERGEANT: 4, MINER: 5, SCOUT: 8, SPY: 1,
  BOMB: 6, FLAG: 1,
};

// Standard two 2x2 lakes (0-indexed): rows 4-5, cols 2-3 and 7-8.
export const LAKES: Square[] = [
  { r: 4, c: 2 }, { r: 4, c: 3 }, { r: 5, c: 2 }, { r: 5, c: 3 },
  { r: 4, c: 7 }, { r: 4, c: 8 }, { r: 5, c: 7 }, { r: 5, c: 8 },
];

// Row 0 = Blue back row, row 9 = Red back row. Each player fills their back 4 rows.
export const SETUP_ROWS: Record<Color, number[]> = {
  BLUE: [0, 1, 2, 3],
  RED: [6, 7, 8, 9],
};
