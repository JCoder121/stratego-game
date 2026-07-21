// Pure(ish) store mutation for incoming server messages — split out of main.ts so it's testable
// without a DOM or a real WebSocket (main.ts itself can't be imported in a test: it opens a
// connection and touches `document` at module scope the instant it's imported). The only
// non-store side effect kept here is `saveSession`, which is itself DOM-free (best-effort
// sessionStorage, see net/ws-client.ts) — routing (`location.hash = '#/room'`) stays in main.ts.
import type { Store } from './main.js';
import type { ServerMsg } from '../server/protocol.js';
import { newStage } from './board/stage.js';
import { saveSession } from './net/ws-client.js';

/**
 * Mutates `store` for one incoming ServerMsg, then re-checks the `ensureStage` invariant.
 *
 * Regression note: on a fresh CREATE_ROOM/JOIN_ROOM, the server's `joinHuman` broadcasts
 * SETUP_STATUS *synchronously before* the CREATE_ROOM/JOIN_ROOM handler sends ROOM_CREATED/JOINED
 * (see server/game-room.ts `joinHuman` → `broadcastSetupStatus`, and server/main.ts where
 * `send({t:'ROOM_CREATED',...})` follows `room.joinHuman(send)`). So the client can receive
 * SETUP_STATUS while `store.role` is still null. An earlier version of this function created the
 * Stage only on the SETUP_STATUS message itself ("phase just transitioned to SETUP"), which missed
 * this case — the transition edge had already passed with role unknown, and `store.stage` stayed
 * null forever (both players stuck on the room placeholder; only a later rematch happened to
 * self-heal, since by then role was already known). Calling `ensureStage` after *every* message
 * (see also main.ts's `renderCurrentScreen`, which re-checks it before every render too) makes
 * stage creation level-triggered instead: it doesn't matter which message satisfies the
 * "phase===SETUP && role known && no stage yet" condition, or in what order.
 */
export function applyServerMsg(store: Store, msg: ServerMsg): void {
  switch (msg.t) {
    case 'ROOM_CREATED':
    case 'JOINED':
      store.role = msg.role;
      store.code = msg.code;
      saveSession(msg.code, msg.token, msg.role);
      break;
    case 'VIEW':
      store.phase = msg.view.phase;
      store.lastView = msg.view;
      store.captured = msg.captured;
      store.lastMove = msg.lastMove ?? null;
      // The server only ever sends VIEW for PLAY/GAME_OVER (SETUP is signaled by SETUP_STATUS
      // instead — see game-room.ts), so this is really "we just left SETUP". Nulling the stage
      // here (rather than only building a fresh one on next entry) is what makes rematch's fresh
      // stage correct without needing to catch a transition edge: next time phase flips back to
      // SETUP, `ensureStage` finds `store.stage === null` and rebuilds regardless of message order.
      if (store.phase !== 'SETUP') store.stage = null;
      break;
    case 'SETUP_STATUS':
      store.phase = 'SETUP';
      store.setupStatus = msg.ready;
      break;
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
  ensureStage(store);
}

/**
 * Level-triggered invariant: whenever we're in SETUP, seated (RED/BLUE, not SPECTATOR), and don't
 * yet have a Stage, build a fresh one. Idempotent and safe to call redundantly (see
 * applyServerMsg and main.ts's renderCurrentScreen, which both call it) — it only ever acts when
 * `store.stage` is null.
 */
export function ensureStage(store: Store): void {
  if (store.phase === 'SETUP' && (store.role === 'RED' || store.role === 'BLUE') && store.stage === null) {
    store.stage = newStage(store.role);
    store.setupGen += 1;
    store.setupLocked = false;
    store.setupError = null;
  }
}
