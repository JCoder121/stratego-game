import type { Color, PlayerView } from '../engine/index.js';
import type { CapturedRanks, LastMove, Role, ServerMsg, WatchView } from '../server/protocol.js';
import { connect, loadSession, saveSession } from './net/ws-client.js';
import type { ConnStatus, Net } from './net/ws-client.js';
import { render as renderLobby } from './screens/lobby.js';

/**
 * Tiny app-wide store. Screens beyond the lobby (setup/play/watch, Tasks 9/10) will read
 * `lastView`/`captured`/`lastMove`/`moveLog`/`setupStatus` to pick a phase-specific render; for
 * now `renderRoomPlaceholder` below just dumps them so two-tab manual testing works end-to-end.
 */
export interface Store {
  net: Net;
  status: ConnStatus;
  role: Role | null;
  code: string | null;
  lastView: PlayerView | WatchView | null;
  captured: CapturedRanks | null;
  lastMove: LastMove | null;
  moveLog: string[];
  setupStatus: Record<Color, boolean> | null;
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
  lastView: null,
  captured: null,
  lastMove: null,
  moveLog: [],
  setupStatus: null,
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
  switch (msg.t) {
    case 'ROOM_CREATED':
    case 'JOINED':
      store.role = msg.role;
      store.code = msg.code;
      saveSession(msg.code, msg.token, msg.role);
      location.hash = '#/room';
      break;
    case 'VIEW':
      store.lastView = msg.view;
      store.captured = msg.captured;
      store.lastMove = msg.lastMove ?? null;
      break;
    case 'SETUP_STATUS':
      store.setupStatus = msg.ready;
      break;
    default:
      // GAME_OVER / OPPONENT_STATUS / REMATCH_STATE / ERROR: no store field yet (Task 9/10);
      // ws-client already handles session-clearing ERROR codes.
      break;
  }
  renderCurrentScreen();
});

/** Placeholder room screen — real setup/play/watch screens land in Task 9/10. */
function renderRoomPlaceholder(root: HTMLElement, s: Store): void {
  const phase = s.lastView?.phase ?? (s.setupStatus ? 'SETUP' : 'connecting…');
  root.innerHTML = `
    <section class="card room-placeholder">
      <h2>Room ${s.code ?? '?'}</h2>
      <p>Role: ${s.role ?? '?'}</p>
      <p>Phase: ${phase}</p>
      <p class="hint">Setup/play screens are pending (Task 9/10). This confirms the round trip:
      create or join here, then in a second tab join with the same code and watch role + phase
      update.</p>
    </section>
  `;
}

function renderCurrentScreen(): void {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/room') && store.code) {
    renderRoomPlaceholder(app, store);
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
