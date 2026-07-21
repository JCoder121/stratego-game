// Bot-vs-bot spectator screen (Task 11). Routed to for role SPECTATOR once phase is PLAY/GAME_OVER
// (see main.ts) — same shape as screens/game.ts (thin DOM layer over store.lastView/finalView/etc)
// but read-only: no square clicks, and a transport strip (play/pause/step/speed) drives the
// server's BOT_VS_BOT pump via WATCH_CONTROL instead of ACTION.
import type { Store } from '../main.js';
import type { Color } from '../../engine/index.js';
import type { WatchSpeed, WatchView } from '../../server/protocol.js';
import { renderBoard } from '../board/render.js';
import { appendMoveLog, disconnectBannerText, other, renderCapturedTray, resultBanner, turnBannerText } from './shared.js';

// ---- Module-level UI state -------------------------------------------------------------------
// The server never reports whether it's currently playing/paused (no WATCH_CONTROL ack, no field
// on VIEW/WatchView) — see game-room.ts's handleWatchControl, which just mutates its own private
// `playing` flag. So `playing` here is purely optimistic: flipped locally the instant we send a
// play/pause control, never reconciled against a server echo. The one place that *is* known to
// disagree with our guess is a fresh game: the server always starts (and rematches into) paused
// (`this.playing = opts.mode !== 'BOT_VS_BOT'` / `if (mode === 'BOT_VS_BOT') this.playing = false`
// in doRematch). `sawGameOver` catches that transition — set while the result banner is on screen,
// consumed (resetting `playing` to false) the next time we render a live PLAY view — without
// needing to distinguish "new game" from "next ply of the same game" on every single VIEW.
let playing = false;
let sawGameOver = false;
let rematchRequested = false;

// Speed shown in the select — likewise never confirmed by the server, just the last value we sent
// (or the default the room presumably started at; see lobby.ts's "Normal" default).
let speed: Exclude<WatchSpeed, 'step'> = 1000;

function sendControl(store: Store, control: 'play' | 'pause' | 'step' | 'speed', s?: WatchSpeed): void {
  store.net.send({ t: 'WATCH_CONTROL', control, speed: s });
}

export function render(root: HTMLElement, store: Store): void {
  if (store.phase === 'GAME_OVER') {
    sawGameOver = true;
    renderGameOver(root, store);
    return;
  }

  if (sawGameOver) {
    // Rematch just kicked off a fresh game — reconcile with the server's guaranteed paused start.
    playing = false;
    sawGameOver = false;
    rematchRequested = false;
  }

  const view = store.lastView as WatchView | null;
  root.textContent = '';
  if (!view) {
    const waiting = document.createElement('p');
    waiting.className = 'hint';
    waiting.textContent = 'Loading game…';
    root.appendChild(waiting);
    return;
  }

  const viewer: Color = 'RED';
  const captured = store.captured ?? { RED: [], BLUE: [] };

  const layout = document.createElement('div');
  layout.className = 'game-layout';
  root.appendChild(layout);

  layout.appendChild(renderCapturedTray('Captured', captured[other(viewer)], other(viewer)));

  const boardWrap = document.createElement('div');
  boardWrap.className = 'game-board-wrap';
  layout.appendChild(boardWrap);

  renderBoard(
    boardWrap,
    { pieces: view.pieces, viewer, lastMove: store.lastMove },
    { onSquareClick: () => {} },
  );

  layout.appendChild(renderCapturedTray('Lost', captured[viewer], viewer));

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

  renderTransportControls(sidebar, store, root);

  appendMoveLog(sidebar, store.moveLog);
}

function renderTransportControls(sidebar: HTMLElement, store: Store, root: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'watch-controls';
  sidebar.appendChild(wrap);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'watch-play';
  playBtn.textContent = '▶ Play';
  playBtn.disabled = playing;
  playBtn.addEventListener('click', () => {
    playing = true;
    sendControl(store, 'play');
    render(root, store);
  });
  wrap.appendChild(playBtn);

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'watch-pause';
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.disabled = !playing;
  pauseBtn.addEventListener('click', () => {
    playing = false;
    sendControl(store, 'pause');
    render(root, store);
  });
  wrap.appendChild(pauseBtn);

  const stepBtn = document.createElement('button');
  stepBtn.type = 'button';
  stepBtn.className = 'watch-step';
  stepBtn.textContent = '⏭ Step';
  // Stepping while autoplaying is a no-op-ish server action (it pauses first, then advances one
  // ply) — disable it while playing so the button's meaning ("advance exactly one ply") stays
  // unambiguous rather than racing the autoplay timer.
  stepBtn.disabled = playing;
  stepBtn.addEventListener('click', () => {
    sendControl(store, 'step');
    render(root, store);
  });
  wrap.appendChild(stepBtn);

  const speedSelect = document.createElement('select');
  speedSelect.className = 'watch-speed';
  speedSelect.setAttribute('aria-label', 'Playback speed');
  for (const [value, label] of [['500', '0.5s'], ['1000', '1s']] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = speed === Number(value);
    speedSelect.appendChild(opt);
  }
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value) as Exclude<WatchSpeed, 'step'>;
    sendControl(store, 'speed', speed);
  });
  wrap.appendChild(speedSelect);
}

function renderGameOver(root: HTMLElement, store: Store): void {
  const finalView = store.finalView;
  const result = store.result;
  // Same race as screens/game.ts's renderGameOver: the phase-GAME_OVER VIEW arrives before the
  // separate GAME_OVER message carrying finalView/result — leave the last PLAY board up for that
  // one render rather than blanking root.
  if (!finalView || !result) return;

  root.textContent = '';
  const layout = document.createElement('div');
  layout.className = 'game-layout';
  root.appendChild(layout);

  const captured = store.captured ?? { RED: [], BLUE: [] };
  const viewer: Color = 'RED';

  layout.appendChild(renderCapturedTray('Captured', captured[other(viewer)], other(viewer)));

  const boardWrap = document.createElement('div');
  boardWrap.className = 'game-board-wrap';
  layout.appendChild(boardWrap);
  renderBoard(
    boardWrap,
    { pieces: finalView.pieces, viewer, lastMove: store.lastMove },
    { onSquareClick: () => {} },
  );

  layout.appendChild(renderCapturedTray('Lost', captured[viewer], viewer));

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

  // BOT_VS_BOT rematch needs no vote (game-room.ts's handleRematch runs doRematch() immediately
  // for a SPECTATOR) — the button just guards against a double-send while we wait for the fresh
  // paused PLAY view to land.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = rematchRequested ? 'Running it back…' : 'Run it back';
  btn.disabled = rematchRequested;
  btn.addEventListener('click', () => {
    rematchRequested = true;
    store.net.send({ t: 'REMATCH_REQUEST' });
    render(root, store);
  });
  rematchWrap.appendChild(btn);
}
