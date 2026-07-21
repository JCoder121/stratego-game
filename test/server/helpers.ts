import {
  presetPlacement, rosterPieceIds, setupSquares, type Color, type PieceId, type Square,
} from '../../src/engine/index.js';
import type { Scheduler } from '../../src/server/game-room.js';
import type { ServerMsg } from '../../src/server/protocol.js';

export function member() {
  const inbox: ServerMsg[] = [];
  return { inbox, send: (m: ServerMsg) => inbox.push(m) };
}

/** Manual scheduler: `set` queues (fn, ms) instead of using real timers; `fire()` runs everything
 * currently queued (snapshotting first, so callbacks that re-queue during a fire don't loop forever). */
export function manualScheduler(): Scheduler & { fire(): void; pendingCount(): number; lastDelay(): number | null } {
  const pending: { id: object; fn: () => void }[] = [];
  let last: number | null = null;
  return {
    set(fn: () => void, ms: number) {
      last = ms;
      const id = {};
      pending.push({ id, fn });
      return id;
    },
    clear(id: unknown) {
      const i = pending.findIndex((e) => e.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    fire() {
      const toRun = pending.splice(0);
      for (const e of toRun) e.fn();
    },
    pendingCount() {
      return pending.length;
    },
    lastDelay() {
      return last;
    },
  };
}

export function fullPlacement(color: Color, presetName: string = 'balanced'): [PieceId, Square][] {
  const map = presetPlacement(color, presetName);
  if (!map) throw new Error('bad preset');
  return Object.entries(map) as [PieceId, Square][];
}

/** Positional placement (roster order onto setup rows) with specific pieceId->square overrides
 * applied via swaps, so the result stays a valid bijection onto the color's setup squares. */
export function placementWithOverrides(color: Color, overrides: [PieceId, Square][]): [PieceId, Square][] {
  const ids = rosterPieceIds(color);
  const squares = setupSquares(color);
  const map = new Map<PieceId, Square>();
  ids.forEach((id, i) => map.set(id, squares[i]!));

  for (const [id, sq] of overrides) {
    const previousSquareOfId = map.get(id);
    if (!previousSquareOfId) throw new Error(`unknown piece id: ${id}`);
    let occupantId: PieceId | undefined;
    for (const [k, v] of map) {
      if (v.r === sq.r && v.c === sq.c) { occupantId = k; break; }
    }
    map.set(id, sq);
    if (occupantId && occupantId !== id) map.set(occupantId, previousSquareOfId);
  }
  return [...map.entries()];
}

export function lastMsg(inbox: ServerMsg[]): ServerMsg {
  const m = inbox[inbox.length - 1];
  if (!m) throw new Error('inbox empty');
  return m;
}
