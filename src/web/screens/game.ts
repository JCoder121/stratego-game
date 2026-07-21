// Play/watch/game-over screen (Task 10). Thin DOM/event layer, same shape as screens/setup.ts:
// all rules logic (legal destinations) lives in ../game-logic.ts; this module only ever reads
// store.lastView/finalView/etc and turns clicks into `net.send` calls.
import type { Store } from '../main.js';
import type { Color, GameResult, PlayerView, Rank, Square } from '../../engine/index.js';
import { RANKS } from '../../engine/index.js';
import type { LastMove, Role } from '../../server/protocol.js';
import { renderBoard } from '../board/render.js';
import { displayCell } from '../board/geometry.js';
import { RANK_GLYPH } from '../board/glyphs.js';
import { destinationsFrom } from '../game-logic.js';

const REASON_COPY: Record<GameResult['reason'], string> = {
  FLAG_CAPTURED: 'Flag captured!',
  NO_MOVES: 'No legal moves',
  RESIGN: 'Resignation',
  PLY_CAP: 'Draw — move limit',
  DEAD_POSITION: 'Draw — dead position',
};

// ---- Module-level UI state -------------------------------------------------------------------
// Mirrors screens/setup.ts's tap-tap-selection pattern: this has to survive re-renders triggered
// by unrelated store updates (an OPPONENT_STATUS ping, a REMATCH_STATE tick) but must reset
// whenever a genuinely new position arrives. `store.viewSeq` (bumped to the server's per-broadcast
// `VIEW.seq` in store-update.ts) is that reset signal — same role `setupGen` plays for setup.ts.
let selected: Square | null = null;
let resignConfirming = false;
let localGen = -1;

// Strike-reveal overlay (Step 3): `animatedForSeq` is the last viewSeq we've already decided
// whether to animate; `overlayActive` is true only while the 900ms reveal is on screen.
let animatedForSeq = -1;
let overlayActive = false;

function roleLabel(role: Role): string {
  if (role === 'RED') return 'Red';
  if (role === 'BLUE') return 'Blue';
  return 'Spectator';
}

function other(color: Color): Color {
  return color === 'RED' ? 'BLUE' : 'RED';
}

function sameSquare(a: Square, b: Square): boolean {
  return a.r === b.r && a.c === b.c;
}

export function render(root: HTMLElement, store: Store): void {
  if (store.phase === 'GAME_OVER') {
    renderGameOver(root, store);
    return;
  }

  if (store.viewSeq !== localGen) {
    selected = null;
    resignConfirming = false;
    localGen = store.viewSeq;
  }

  const view = store.lastView;
  root.textContent = '';
  if (!view) {
    const waiting = document.createElement('p');
    waiting.className = 'hint';
    waiting.textContent = 'Loading game…';
    root.appendChild(waiting);
    return;
  }

  // Decide once per new VIEW whether to kick off the strike-reveal overlay — see the module doc
  // comment above. `justTriggered` is only true on the very call that turns it on, so the
  // `setTimeout` below is scheduled exactly once per strike.
  let justTriggered = false;
  if (store.viewSeq !== animatedForSeq) {
    animatedForSeq = store.viewSeq;
    if (store.lastMove?.strike) {
      overlayActive = true;
      justTriggered = true;
    }
  }

  const viewerColor: Color = store.role === 'RED' || store.role === 'BLUE' ? store.role : 'RED';
  const isSeated = store.role === 'RED' || store.role === 'BLUE';
  const captured = store.captured ?? { RED: [], BLUE: [] };

  const layout = document.createElement('div');
  layout.className = 'game-layout';
  root.appendChild(layout);

  layout.appendChild(renderCapturedTray('Captured', captured[other(viewerColor)], other(viewerColor)));

  const boardWrap = document.createElement('div');
  boardWrap.className = 'game-board-wrap';
  layout.appendChild(boardWrap);

  const highlights =
    selected && isSeated ? destinationsFrom(view as PlayerView, selected) : [];

  renderBoard(
    boardWrap,
    {
      pieces: view.pieces,
      viewer: viewerColor,
      selected,
      highlights,
      lastMove: store.lastMove,
    },
    {
      onSquareClick(sq: Square) {
        onBoardClick(root, store, sq);
      },
    },
  );

  if (overlayActive && store.lastMove?.strike) {
    applyStrikeOverlay(boardWrap, store.lastMove, viewerColor);
  }

  layout.appendChild(renderCapturedTray('Lost', captured[viewerColor], viewerColor));

  const sidebar = document.createElement('div');
  sidebar.className = 'game-sidebar';
  layout.appendChild(sidebar);

  const turnBanner = document.createElement('div');
  turnBanner.className = 'turn-banner';
  turnBanner.textContent = turnBannerText(store, view.turn);
  sidebar.appendChild(turnBanner);

  const disconnectText = disconnectBannerText(store);
  if (disconnectText) {
    const disconnectBanner = document.createElement('div');
    disconnectBanner.className = 'disconnect-banner';
    disconnectBanner.textContent = disconnectText;
    sidebar.appendChild(disconnectBanner);
  }

  appendMoveLog(sidebar, store.moveLog);

  if (isSeated) {
    renderResignControl(sidebar, store, root);
  }

  if (justTriggered) {
    const seqAtTrigger = store.viewSeq;
    setTimeout(() => {
      // A newer VIEW (and its own render() call) may already have superseded this one — only
      // clear the overlay/re-render if we're still showing the strike we scheduled this for.
      if (store.viewSeq === seqAtTrigger) {
        overlayActive = false;
        render(root, store);
      }
    }, 900);
  }
}

function onBoardClick(root: HTMLElement, store: Store, sq: Square): void {
  const view = store.lastView;
  if (!view || !(store.role === 'RED' || store.role === 'BLUE')) return;
  const playerView = view as PlayerView;

  if (selected) {
    const isHighlight = destinationsFrom(playerView, selected).some((d) => sameSquare(d, sq));
    if (isHighlight) {
      const isMyTurn = store.phase === 'PLAY' && playerView.turn === store.role;
      if (isMyTurn) {
        store.actionSeq += 1;
        store.net.send({
          t: 'ACTION',
          action: { type: 'MOVE', color: store.role, from: selected, to: sq },
          seq: store.actionSeq,
        });
      }
      selected = null;
      render(root, store);
      return;
    }
  }

  const occupant = playerView.pieces.find((p) => sameSquare(p.pos, sq));
  selected = occupant && occupant.owner === store.role ? sq : null;
  render(root, store);
}

function turnBannerText(store: Store, turn: Color): string {
  if (store.role === 'RED' || store.role === 'BLUE') {
    return turn === store.role ? 'Your move' : "Opponent's move";
  }
  return `${turn === 'RED' ? 'Red' : 'Blue'} to move`;
}

function disconnectBannerText(store: Store): string | null {
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

function renderCapturedTray(label: string, ranks: Rank[], color: Color): HTMLElement {
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
 *  live document — see call sites, both of which attach `sidebar` to `layout`/`root` before
 *  calling this). `scrollHeight` reads 0 on a detached element, so the "keep newest move in view"
 *  scroll has to happen after attaching, not while building the list in isolation. */
function appendMoveLog(sidebar: HTMLElement, entries: string[]): void {
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

function renderResignControl(sidebar: HTMLElement, store: Store, root: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'resign-control';
  sidebar.appendChild(wrap);

  if (!resignConfirming) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'resign-btn';
    btn.textContent = 'Resign';
    btn.disabled = store.phase !== 'PLAY';
    btn.addEventListener('click', () => {
      resignConfirming = true;
      render(root, store);
    });
    wrap.appendChild(btn);
    return;
  }

  // Inline two-button flip, never window.confirm — a blocking confirm() would freeze the ws
  // event loop (and any browser extension content script) for as long as it's open.
  const prompt = document.createElement('span');
  prompt.className = 'resign-prompt';
  prompt.textContent = 'Resign?';
  wrap.appendChild(prompt);

  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'resign-confirm-yes';
  yes.textContent = 'Yes, resign';
  yes.addEventListener('click', () => {
    if (store.role === 'RED' || store.role === 'BLUE') {
      store.actionSeq += 1;
      store.net.send({ t: 'ACTION', action: { type: 'RESIGN', color: store.role }, seq: store.actionSeq });
    }
    resignConfirming = false;
    render(root, store);
  });
  wrap.appendChild(yes);

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'resign-confirm-no';
  no.textContent = 'Cancel';
  no.addEventListener('click', () => {
    resignConfirming = false;
    render(root, store);
  });
  wrap.appendChild(no);
}

function applyStrikeOverlay(boardWrap: HTMLElement, lastMove: LastMove, viewer: Color): void {
  const strike = lastMove.strike;
  if (!strike) return;
  const { row, col } = displayCell(lastMove.to, viewer);
  const cellEl = boardWrap.querySelector<HTMLElement>(`.cell[data-r="${row}"][data-c="${col}"]`);
  if (!cellEl) return;

  const overlay = document.createElement('div');
  overlay.className = `strike-reveal outcome-${strike.outcome.toLowerCase()}`;

  const attacker = document.createElement('span');
  attacker.className = `strike-glyph ${lastMove.by === 'RED' ? 'red' : 'blue'}`;
  attacker.textContent = RANK_GLYPH[strike.attackerRank];
  overlay.appendChild(attacker);

  const sep = document.createElement('span');
  sep.className = 'strike-x';
  sep.textContent = '×';
  overlay.appendChild(sep);

  const defenderColor = other(lastMove.by);
  const defender = document.createElement('span');
  defender.className = `strike-glyph ${defenderColor === 'RED' ? 'red' : 'blue'}`;
  defender.textContent = RANK_GLYPH[strike.defenderRank];
  overlay.appendChild(defender);

  cellEl.appendChild(overlay);
}

function resultBanner(result: GameResult): string {
  const copy = REASON_COPY[result.reason];
  return result.winner ? `${roleLabel(result.winner)} wins — ${copy}` : copy;
}

function renderGameOver(root: HTMLElement, store: Store): void {
  root.textContent = '';
  const finalView = store.finalView;
  const result = store.result;
  if (!finalView || !result) return; // GAME_OVER always sets both together — see store-update.ts

  const layout = document.createElement('div');
  layout.className = 'game-layout';
  root.appendChild(layout);

  const captured = store.captured ?? { RED: [], BLUE: [] };
  const viewerColor: Color = store.role === 'RED' || store.role === 'BLUE' ? store.role : 'RED';

  layout.appendChild(renderCapturedTray('Captured', captured[other(viewerColor)], other(viewerColor)));

  const boardWrap = document.createElement('div');
  boardWrap.className = 'game-board-wrap';
  layout.appendChild(boardWrap);
  renderBoard(
    boardWrap,
    { pieces: finalView.pieces, viewer: viewerColor, lastMove: store.lastMove },
    { onSquareClick: () => {} },
  );

  layout.appendChild(renderCapturedTray('Lost', captured[viewerColor], viewerColor));

  const sidebar = document.createElement('div');
  sidebar.className = 'game-sidebar';
  layout.appendChild(sidebar);

  const banner = document.createElement('div');
  banner.className = 'result-banner';
  banner.textContent = resultBanner(result);
  sidebar.appendChild(banner);

  appendMoveLog(sidebar, store.moveLog);

  const rematchWrap = document.createElement('div');
  rematchWrap.className = 'rematch-control';
  sidebar.appendChild(rematchWrap);

  const votes = store.rematchVotes ?? [];
  if (store.role === 'RED' || store.role === 'BLUE') {
    const iVoted = votes.includes(store.role);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = iVoted ? 'You voted — waiting…' : 'Rematch';
    btn.disabled = iVoted;
    btn.addEventListener('click', () => {
      store.net.send({ t: 'REMATCH_REQUEST' });
    });
    rematchWrap.appendChild(btn);
  }

  if (votes.length > 0) {
    const votesLine = document.createElement('p');
    votesLine.className = 'hint';
    votesLine.textContent = `Votes: ${votes.map(roleLabel).join(', ')}`;
    rematchWrap.appendChild(votesLine);
  }
}
