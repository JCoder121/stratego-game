// Pure(ish) store mutation for incoming server messages — split out of main.ts so it's testable
// without a DOM or a real WebSocket (main.ts itself can't be imported in a test: it opens a
// connection and touches `document` at module scope the instant it's imported). The only
// non-store side effect kept here is `saveSession`, which is itself DOM-free (best-effort
// sessionStorage, see net/ws-client.ts) — routing (`location.hash = '#/room'`) stays in main.ts.
import type { Store } from './main.js';
import type { LastMove, ServerMsg } from '../server/protocol.js';
import { newStage } from './board/stage.js';
import { saveSession } from './net/ws-client.js';
import { toAlg } from '../engine/board.js';
import { RANK_GLYPH } from './board/glyphs.js';

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
    case 'VIEW': {
      store.phase = msg.view.phase;
      store.lastView = msg.view;
      store.captured = msg.captured;
      store.lastMove = msg.lastMove ?? null;
      store.viewSeq = msg.seq;
      // lastMove is only ever set on the broadcast immediately following a real MOVE
      // (game-room.ts's applyChecked → broadcastViews(this.buildLastMove(...))) — join, rejoin,
      // setup-completion and rematch all broadcast with `lastMove: undefined`. Number entries by
      // the VIEW's own `plyCount` rather than `moveLog.length + 1`: the latter silently renumbers
      // from 1 after any gap (moves made while we were disconnected are never individually seen),
      // while plyCount stays truthful. When a lastMove-less VIEW (a rejoin resend) shows plyCount
      // jumped by more than one ply since we last knew, insert a neutral divider so the gap is
      // visible instead of silently absent.
      const ply = msg.view.plyCount;
      if (msg.lastMove) {
        store.moveLog = [...store.moveLog, formatMoveLogEntry(ply, msg.lastMove)];
      } else if (store.lastPlyLogged !== null && ply - store.lastPlyLogged > 1) {
        store.moveLog = [...store.moveLog, RECONNECT_DIVIDER];
      }
      store.lastPlyLogged = ply;
      // The server only ever sends VIEW for PLAY/GAME_OVER (SETUP is signaled by SETUP_STATUS
      // instead — see game-room.ts), so this is really "we just left SETUP". Nulling the stage
      // here (rather than only building a fresh one on next entry) is what makes rematch's fresh
      // stage correct without needing to catch a transition edge: next time phase flips back to
      // SETUP, `ensureStage` finds `store.stage === null` and rebuilds regardless of message order.
      if (store.phase !== 'SETUP') store.stage = null;
      break;
    }
    case 'SETUP_STATUS':
      store.phase = 'SETUP';
      store.setupStatus = msg.ready;
      // Everything from a previous game (moveLog, lastMove/strike, game-over result/votes,
      // captured tallies) is stale once we're back in SETUP — on a rematch this is what makes
      // screens/game.ts start clean; on a brand-new room these are already at their initial
      // empty/null values, so it's a no-op there.
      store.moveLog = [];
      store.lastMove = null;
      store.captured = null;
      store.finalView = null;
      store.result = null;
      store.rematchVotes = null;
      store.lastPlyLogged = null;
      break;
    case 'GAME_OVER':
      store.phase = 'GAME_OVER';
      store.finalView = msg.finalView;
      store.result = msg.result;
      store.captured = msg.captured;
      store.rematchVotes = [];
      break;
    case 'REMATCH_STATE':
      store.rematchVotes = msg.votes;
      break;
    case 'OPPONENT_STATUS':
      store.connection = { ...store.connection, [msg.seat]: msg.connected };
      break;
    case 'ERROR':
      if (msg.code === 'BAD_SETUP') {
        store.setupLocked = false;
        store.setupError = msg.msg;
      }
      // BAD_TOKEN/NO_ROOM already handled by ws-client (session clear + route to lobby).
      // NOT_YOUR_TURN/INVALID_ACTION/ROOM_FULL/BAD_MSG have no store field: screens/game.ts never
      // optimistically applies a move, so the next VIEW (or its absence) is the only feedback a
      // rejected ACTION needs.
      break;
  }
  ensureStage(store);
}

/** Inserted into moveLog in place of the moves we missed while disconnected — see the VIEW case's
 *  gap-detection comment above. */
const RECONNECT_DIVIDER = '— reconnected —';

/** `${n}. e4→e5` (plus an ` ⚔ 7×5` rank-glyph suffix when the move was an attack) — see the VIEW
 *  case above for why this only ever runs once per real ply. */
function formatMoveLogEntry(n: number, m: LastMove): string {
  const base = `${n}. ${toAlg(m.from)}→${toAlg(m.to)}`;
  if (!m.strike) return base;
  return `${base} ⚔ ${RANK_GLYPH[m.strike.attackerRank]}×${RANK_GLYPH[m.strike.defenderRank]}`;
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
