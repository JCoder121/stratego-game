import type { Color, Phase, PlayerView } from '../engine/index.js';
import type { CapturedRanks, LastMove, Role, ServerMsg, WatchView } from '../server/protocol.js';
import { connect, loadSession, saveSession } from './net/ws-client.js';
import type { ConnStatus, Net } from './net/ws-client.js';
import { render as renderLobby } from './screens/lobby.js';
import { render as renderSetup } from './screens/setup.js';
import { newStage } from './board/stage.js';
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
 * 9). `stage` is rebuilt fresh (and `setupGen` bumped) every time `phase` transitions *into*
 * SETUP — covers first entry and every rematch — but left alone on subsequent SETUP_STATUS pings
 * within the same session (e.g. the opponent readying up) so in-progress staging isn't lost.
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
  switch (msg.t) {
    case 'ROOM_CREATED':
    case 'JOINED':
      store.role = msg.role;
      store.code = msg.code;
      saveSession(msg.code, msg.token, msg.role);
      location.hash = '#/room';
      break;
    case 'VIEW':
      store.phase = msg.view.phase;
      store.lastView = msg.view;
      store.captured = msg.captured;
      store.lastMove = msg.lastMove ?? null;
      break;
    case 'SETUP_STATUS': {
      const enteringSetup = store.phase !== 'SETUP';
      store.phase = 'SETUP';
      store.setupStatus = msg.ready;
      if (enteringSetup && (store.role === 'RED' || store.role === 'BLUE')) {
        store.stage = newStage(store.role);
        store.setupGen += 1;
        store.setupLocked = false;
        store.setupError = null;
      }
      break;
    }
    case 'ERROR':
      if (msg.code === 'BAD_SETUP') {
        store.setupLocked = false;
        store.setupError = msg.msg;
      }
      // BAD_TOKEN/NO_ROOM already handled by ws-client (session clear + route to lobby); other
      // codes (BAD_MSG/ROOM_FULL/NOT_YOUR_TURN/INVALID_ACTION) have no store field yet (Task 10).
      break;
    default:
      // GAME_OVER / OPPONENT_STATUS / REMATCH_STATE: no store field yet (Task 10).
      break;
  }
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
