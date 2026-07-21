// Render helpers shared by screens/game.ts (seated play) and screens/watch.ts (bot-vs-bot
// spectating, Task 11) — both show the same captured trays / move log / turn+disconnect banners
// / game-over result copy, just driven by a PlayerView vs a WatchView. Split out once the
// duplication crossed the "extract it" threshold noted in the Task 11 brief.
import type { Color, GameResult, Rank } from '../../engine/index.js';
import { RANKS } from '../../engine/index.js';
import type { Role } from '../../server/protocol.js';
import { RANK_GLYPH } from '../board/glyphs.js';
import type { Store } from '../main.js';

export function roleLabel(role: Role): string {
  if (role === 'RED') return 'Red';
  if (role === 'BLUE') return 'Blue';
  return 'Spectator';
}

export function other(color: Color): Color {
  return color === 'RED' ? 'BLUE' : 'RED';
}

export function renderCapturedTray(label: string, ranks: Rank[], color: Color): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tray';

  const heading = document.createElement('h3');
  heading.textContent = label;
  wrap.appendChild(heading);

  if (ranks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'None yet';
    wrap.appendChild(empty);
    return wrap;
  }

  const grid = document.createElement('div');
  grid.className = 'tray-grid';
  wrap.appendChild(grid);

  const byRank = new Map<Rank, number>();
  for (const r of ranks) byRank.set(r, (byRank.get(r) ?? 0) + 1);
  for (const rank of RANKS) {
    const count = byRank.get(rank);
    if (!count) continue;
    const chip = document.createElement('span');
    chip.className = `tray-chip ${color === 'RED' ? 'red' : 'blue'}`;
    chip.textContent = count > 1 ? `${RANK_GLYPH[rank]}×${count}` : RANK_GLYPH[rank];
    grid.appendChild(chip);
  }
  return wrap;
}

/** Builds the move-log panel and appends it to `sidebar` (which must already be attached to the
 *  live document — see call sites, which all attach `sidebar` before calling this). `scrollHeight`
 *  reads 0 on a detached element, so the "keep newest move in view" scroll has to happen after
 *  attaching, not while building the list in isolation. */
export function appendMoveLog(sidebar: HTMLElement, entries: string[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'move-log';

  const heading = document.createElement('h3');
  heading.textContent = 'Moves';
  wrap.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'move-log-list';
  for (const entry of entries) {
    const li = document.createElement('li');
    li.textContent = entry;
    list.appendChild(li);
  }
  wrap.appendChild(list);
  sidebar.appendChild(wrap);
  list.scrollTop = list.scrollHeight;
}

export function turnBannerText(store: Store, turn: Color): string {
  if (store.role === 'RED' || store.role === 'BLUE') {
    return turn === store.role ? 'Your move' : "Opponent's move";
  }
  return `${turn === 'RED' ? 'Red' : 'Blue'} to move`;
}

export function disconnectBannerText(store: Store): string | null {
  if (store.role === 'RED' || store.role === 'BLUE') {
    const opp = other(store.role);
    if (!store.connection[opp]) {
      return `${roleLabel(opp)} disconnected — waiting to reconnect…`;
    }
    return null;
  }
  const down = (['RED', 'BLUE'] as const).filter((c) => !store.connection[c]);
  if (down.length === 0) return null;
  return `${down.map(roleLabel).join(' and ')} disconnected — waiting to reconnect…`;
}

export const REASON_COPY: Record<GameResult['reason'], string> = {
  FLAG_CAPTURED: 'Flag captured!',
  NO_MOVES: 'No legal moves',
  RESIGN: 'Resignation',
  PLY_CAP: 'Draw — move limit',
  DEAD_POSITION: 'Draw — dead position',
};

export function resultBanner(result: GameResult): string {
  const copy = REASON_COPY[result.reason];
  return result.winner ? `${roleLabel(result.winner)} wins — ${copy}` : copy;
}
