import { RANKS, type Rank } from './types.js';

export interface PieceDef {
  rank: Rank;
  rankValue: number; // higher beats lower except special cases; Bomb/Flag = 0
  movable: boolean;
  scout: boolean;
}

const RANK_VALUES: Record<Rank, number> = {
  MARSHAL: 10, GENERAL: 9, COLONEL: 8, MAJOR: 7, CAPTAIN: 6,
  LIEUTENANT: 5, SERGEANT: 4, MINER: 3, SCOUT: 2, SPY: 1,
  BOMB: 0, FLAG: 0,
};

export const PIECE_DEFS: Record<Rank, PieceDef> = Object.fromEntries(
  RANKS.map((rank) => [
    rank,
    {
      rank,
      rankValue: RANK_VALUES[rank],
      movable: rank !== 'BOMB' && rank !== 'FLAG',
      scout: rank === 'SCOUT',
    },
  ]),
) as Record<Rank, PieceDef>;

export const rankValue = (rank: Rank): number => PIECE_DEFS[rank].rankValue;
export const isMovable = (rank: Rank): boolean => PIECE_DEFS[rank].movable;
export const isScout = (rank: Rank): boolean => PIECE_DEFS[rank].scout;
