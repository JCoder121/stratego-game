import type { Color, Phase, PlayerView } from '../engine/index.js';
import type { CapturedRanks, LastMove, Role, ServerMsg, WatchView } from '../server/protocol.js';
import { connect, loadSession } from './net/ws-client.js';
import type { ConnStatus, Net } from './net/ws-client.js';
import { render as renderLobby } from './screens/lobby.js';
import { render as renderSetup } from './screens/setup.js';
import { applyServerMsg, ensureStage } from './store-update.js';
import type { Stage } from './board/stage.js';

/**
 * Tiny app-wide store. Screens beyond the lobby read `lastView`/`captured`/`lastMove`/`moveLog`/
 * `setupStatus` to pick a phase-specific render; `renderRoomPlaceholder` below still covers
 * PLAY/GAME_OVER/spectator (Task 10) so two-tab manual testing works end-to-end.
 *
 * `phase` is tracked separately from `lastView?.phase` because the server never actually sends a
 * VIEW while phase is SETUP (see game-room.ts: joinHuman/rejoin/commitSetup/doRematch all send
 * SETUP_STATUS instead) — VIEW only starts flowing again once play begins. So `phase` is the
 * union of both signals: SETUP_STATUS means SETUP, VIEW carries the authoritative PLAY/GAME_OVER.
 *
 * `stage`/`setupGen`/`setupLocked`/`setupError` are the setup screen's client-staged state (Task
 * 9). `stage` is rebuilt (and `setupGen` bumped) by store-update.ts's `ensureStage`, a
 * level-triggered invariant re-checked after every message (and again below, before every
 * render): whenever `phase === 'SETUP'` and role is known and `stage === null`, build a fresh
 * one. It's level- rather than edge-triggered because on a *fresh* room, the server's
 * SETUP_STATUS broadcast races ahead of ROOM_CREATED/JOINED (see store-update.ts's doc comment)
 * — an edge check ("phase just became SETUP") can fire while role is still null and never get
 * another chance. `stage` is nulled whenever `phase` leaves SETUP, which is what makes a rematch's
 * fresh stage correct without needing to catch that transition edge either.
 */
export interface Store {
  net: Net;
  status: ConnStatus;
  role: Role | null;
  code: string | null;
  phase: Phase | null;
  lastView: PlayerView | WatchView | null;
  captured: CapturedRanks | null;
  lastMove: LastMove | null;
  moveLog: string[];
  setupStatus: Record<Color, boolean> | null;
  stage: Stage | null;
  setupGen: number;
  setupLocked: boolean;
  setupError: string | null;
}

const appEl = document.getElementById('app');
if (!appEl) throw new Error('missing #app root element');
const app: HTMLElement = appEl;

const banner = document.createElement('div');
banner.id = 'status-banner';
banner.hidden = true;
document.body.insertBefore(banner, app);

const net = connect();
const store: Store = {
  net,
  status: 'connecting',
  role: null,
  code: null,
  phase: null,
  lastView: null,
  captured: null,
  lastMove: null,
  moveLog: [],
  setupStatus: null,
  stage: null,
  setupGen: 0,
  setupLocked: false,
  setupError: null,
};

net.onStatus((s: ConnStatus) => {
  store.status = s;
  if (s === 'open') {
    banner.hidden = true;
  } else {
    banner.hidden = false;
    banner.textContent = s === 'connecting' ? 'connecting…' : 'disconnected — retrying…';
  }
  // Lobby gates its action buttons on store.status, so a status flip needs a re-render too.
  renderCurrentScreen();
});

net.onMsg((msg: ServerMsg) => {
  applyServerMsg(store, msg);
  // Routing is a DOM concern kept out of the (unit-testable) applyServerMsg — see store-update.ts.
  if (msg.t === 'ROOM_CREATED' || msg.t === 'JOINED') location.hash = '#/room';
  renderCurrentScreen();
});

/** Placeholder room screen for phases the web client doesn't have a real screen for yet — real
 *  play/watch screens land in Task 10. Setup has a real screen (below); this still covers it for
 *  spectators and the brief moment before the first SETUP_STATUS/VIEW arrives. */
function renderRoomPlaceholder(root: HTMLElement, s: Store): void {
  root.innerHTML = '';
  const section = document.createElement('section');
  section.className = 'card room-placeholder';

  const h2 = document.createElement('h2');
  h2.textContent = `Room ${s.code ?? '?'}`;
  section.appendChild(h2);

  const roleP = document.createElement('p');
  roleP.textContent = `Role: ${s.role ?? '?'}`;
  section.appendChild(roleP);

  const phaseP = document.createElement('p');
  phaseP.textContent = `Phase: ${s.phase ?? 'connecting…'}`;
  section.appendChild(phaseP);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Play/watch screens are pending (Task 10). This confirms the round trip: create or join ' +
    'here, then in a second tab join with the same code and watch role + phase update.';
  section.appendChild(hint);

  root.appendChild(section);
}

function renderCurrentScreen(): void {
  // Belt-and-suspenders: applyServerMsg already re-checks this after every message, but calling
  // it here too means a render triggered any other way (onStatus, hashchange, initial load) can
  // never observe a stale "should have a stage but doesn't" state either.
  ensureStage(store);
  const hash = location.hash || '#/';
  if (import.meta.env.DEV && hash.startsWith('#/dev-board')) {
    // Dev-only scratch route (Task 8 manual sanity check) — dynamic import keeps devBoard.ts and
    // its sample fixtures out of the production bundle entirely.
    void import('./screens/devBoard.js').then(({ render }) => render(app));
    return;
  }
  if (hash.startsWith('#/room') && store.code) {
    const isSetupParticipant = store.role === 'RED' || store.role === 'BLUE';
    if (store.phase === 'SETUP' && isSetupParticipant && store.stage) {
      renderSetup(app, store);
    } else {
      renderRoomPlaceholder(app, store);
    }
  } else {
    renderLobby(app, store);
  }
}

window.addEventListener('hashchange', renderCurrentScreen);

// If a session survives a page reload, jump straight to the room placeholder; ws-client sends
// REJOIN as soon as the socket opens, so the real VIEW/SETUP_STATUS follow shortly after.
const existing = loadSession();
if (existing) {
  store.role = existing.role;
  store.code = existing.code;
  if (!location.hash.startsWith('#/room')) location.hash = '#/room';
}

renderCurrentScreen();
