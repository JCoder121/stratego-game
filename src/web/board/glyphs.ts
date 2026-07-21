import type { Rank } from '../../engine/index.js';

// Classic Stratego numbering — see task-8-brief.md. Single source of truth for rank → glyph,
// shared by board/render.ts (piece tiles), screens/setup.ts (tray tiles), store-update.ts
// (move-log strike suffixes) and screens/game.ts (captured trays + strike-reveal overlay) so
// none of them duplicate this table.
export const RANK_GLYPH: Record<Rank, string> = {
  MARSHAL: '1',
  GENERAL: '2',
  COLONEL: '3',
  MAJOR: '4',
  CAPTAIN: '5',
  LIEUTENANT: '6',
  SERGEANT: '7',
  MINER: '8',
  SCOUT: '9',
  SPY: 'S',
  BOMB: 'B',
  FLAG: 'F',
};
