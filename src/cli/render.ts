import { BOARD_SIZE, type GameEvent, type Rank } from '../engine/types.js';
import { isLake } from '../engine/board.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';

const INITIAL: Record<Rank, string> = {
  MARSHAL: 'M', GENERAL: 'G', COLONEL: 'C', MAJOR: 'J', CAPTAIN: 'P',
  LIEUTENANT: 'L', SERGEANT: 'S', MINER: 'I', SCOUT: 'T', SPY: 'Y',
  BOMB: 'B', FLAG: 'F',
};

function glyph(vp: VisiblePiece | undefined, viewer: PlayerView['viewer']): string {
  if (!vp) return '.';
  if (vp.rank === null) return '?'; // hidden enemy
  const ch = INITIAL[vp.rank];
  return vp.owner === viewer ? ch : ch.toLowerCase();
}

export function renderView(view: PlayerView): string {
  const byPos = new Map<string, VisiblePiece>();
  for (const p of view.pieces) byPos.set(`${p.pos.r},${p.pos.c}`, p);

  const lines: string[] = [];
  lines.push(`   ${Array.from({ length: BOARD_SIZE }, (_, c) => String.fromCharCode(97 + c)).join(' ')}`);
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rankLabel = String(BOARD_SIZE - r).padStart(2, ' ');
    const cells: string[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isLake({ r, c })) { cells.push('~'); continue; }
      cells.push(glyph(byPos.get(`${r},${c}`), view.viewer));
    }
    lines.push(`${rankLabel} ${cells.join(' ')}`);
  }
  lines.push(`(you are ${view.viewer}; UPPER=yours, lower=known enemy, ?=hidden, ~=lake)`);
  return lines.join('\n');
}

export function renderEvents(events: GameEvent[]): string {
  return events.map((e) => {
    switch (e.type) {
      case 'STRIKE': return `STRIKE ${e.attackerRank} vs ${e.defenderRank} → ${e.outcome}`;
      case 'FLAG_CAPTURED': return 'FLAG CAPTURED!';
      case 'BOMB_DEFUSED': return 'bomb defused';
      case 'GAME_OVER': return `GAME OVER: ${e.result.winner ?? 'draw'} (${e.result.reason})`;
      case 'REJECTED': return `rejected: ${e.reason}`;
      default: return '';
    }
  }).filter(Boolean).join('\n');
}
