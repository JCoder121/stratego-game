// Play/watch/game-over screen (Task 10). Thin DOM/event layer, same shape as screens/setup.ts:
// all rules logic (legal destinations) lives in ../game-logic.ts; this module only ever reads
// store.lastView/finalView/etc and turns clicks into `net.send` calls.
import type { Store } from '../main.js';
import type { Color, PlayerView, Square } from '../../engine/index.js';
import type { LastMove } from '../../server/protocol.js';
import { renderBoard } from '../board/render.js';
import { displayCell } from '../board/geometry.js';
import { RANK_GLYPH } from '../board/glyphs.js';
import { destinationsFrom } from '../game-logic.js';
import {
  appendMoveLog, disconnectBannerText, other, renderCapturedTray, resultBanner, roleLabel,
  turnBannerText,
} from './shared.js';

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

function renderGameOver(root: HTMLElement, store: Store): void {
  const finalView = store.finalView;
  const result = store.result;
  // The VIEW carrying `view.phase: 'GAME_OVER'` (which is what flips store.phase and routes here)
  // arrives *before* the separate GAME_OVER message that sets finalView/result (see
  // game-room.ts's applyChecked: broadcastViews then broadcastGameOver). Leave whatever was
  // already on screen — the last PLAY-phase board — up rather than blanking `root` for that one
  // render; the GAME_OVER message (and its own render() call) follows within the same tick.
  if (!finalView || !result) return;

  root.textContent = '';
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
