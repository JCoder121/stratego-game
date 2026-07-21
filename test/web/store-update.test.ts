import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LastMove, ServerMsg, WatchView } from '../../src/server/protocol.js';
import type { Store } from '../../src/web/main.js';
import { applyServerMsg, ensureStage } from '../../src/web/store-update.js';

/** Map-backed Storage stub, same shape as test/web/ws-client.test.ts's — applyServerMsg calls
 *  saveSession() on ROOM_CREATED/JOINED, which needs a sessionStorage to write into. */
function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function makeStore(): Store {
  return {
    net: { send: () => {}, onMsg: () => () => {}, onStatus: () => () => {} },
    status: 'open',
    role: null,
    code: null,
    mode: null,
    phase: null,
    lastView: null,
    captured: null,
    lastMove: null,
    moveLog: [],
    viewSeq: 0,
    actionSeq: 0,
    setupStatus: null,
    stage: null,
    setupGen: 0,
    setupLocked: false,
    setupError: null,
    finalView: null,
    result: null,
    rematchVotes: null,
    connection: { RED: true, BLUE: true },
    lastPlyLogged: null,
  };
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', makeFakeStorage());
});

describe('applyServerMsg — fresh-room message order', () => {
  it('builds a stage once role becomes known, even though SETUP_STATUS arrives first', () => {
    // Reproduces the exact wire order for CREATE_ROOM: game-room.ts's joinHuman() broadcasts
    // SETUP_STATUS synchronously (fresh rooms start in SETUP) *before* server/main.ts sends the
    // ROOM_CREATED reply a couple lines later — so the client can see SETUP_STATUS while
    // store.role is still null.
    const store = makeStore();

    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });
    expect(store.phase).toBe('SETUP');
    expect(store.stage).toBeNull(); // role not known yet — must not throw, must not fabricate a stage

    applyServerMsg(store, { t: 'ROOM_CREATED', code: 'ABCDE', token: 'tok', role: 'RED' });
    expect(store.role).toBe('RED');
    expect(store.stage).not.toBeNull(); // the invariant catches up on the very next message
    expect(store.stage!.color).toBe('RED');
    expect(store.setupGen).toBe(1);
  });

  it('same race for JOIN_ROOM (JOINED arriving after SETUP_STATUS)', () => {
    const store = makeStore();
    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: true, BLUE: false } });
    expect(store.stage).toBeNull();
    applyServerMsg(store, { t: 'JOINED', code: 'ABCDE', token: 'tok', role: 'BLUE' });
    expect(store.stage?.color).toBe('BLUE');
  });

  it('a spectator never gets a stage, in either message order', () => {
    const store = makeStore();
    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });
    applyServerMsg(store, { t: 'JOINED', code: 'ABCDE', token: 'tok', role: 'SPECTATOR' });
    expect(store.stage).toBeNull();
  });
});

describe('applyServerMsg — rematch resets the stage without needing the transition edge', () => {
  it('nulls the stage on leaving SETUP (VIEW), then ensureStage rebuilds on the next SETUP_STATUS', () => {
    const store = makeStore();
    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });
    applyServerMsg(store, { t: 'ROOM_CREATED', code: 'ABCDE', token: 'tok', role: 'RED' });
    const firstStage = store.stage;
    expect(firstStage).not.toBeNull();

    // Game plays out: a VIEW with phase PLAY (then, hypothetically, GAME_OVER) arrives.
    const playView: ServerMsg = {
      t: 'VIEW',
      view: { viewer: 'RED', phase: 'PLAY', turn: 'RED', plyCount: 0, pieces: [], result: null, myRecentMoves: {} },
      captured: { RED: [], BLUE: [] },
      seq: 1,
    };
    applyServerMsg(store, playView);
    expect(store.phase).toBe('PLAY');
    expect(store.stage).toBeNull(); // leaving SETUP nulls it — no stale board bleeds into a rematch

    // Rematch: doRematch() broadcasts SETUP_STATUS again.
    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });
    expect(store.stage).not.toBeNull();
    expect(store.stage).not.toBe(firstStage);
    expect(store.setupGen).toBe(2); // bumped again — screens/setup.ts resets tap-tap selection on this
  });
});

describe('ensureStage', () => {
  it('is idempotent — calling it again with a stage already present is a no-op', () => {
    const store = makeStore();
    store.phase = 'SETUP';
    store.role = 'RED';
    ensureStage(store);
    const stage = store.stage;
    ensureStage(store);
    expect(store.stage).toBe(stage); // same reference — not rebuilt
    expect(store.setupGen).toBe(1);
  });

  it('does nothing outside SETUP or without a seated role', () => {
    const store = makeStore();
    ensureStage(store);
    expect(store.stage).toBeNull();

    store.phase = 'PLAY';
    store.role = 'RED';
    ensureStage(store);
    expect(store.stage).toBeNull();
  });
});

describe('applyServerMsg — moveLog', () => {
  // `seq` (the room's broadcast counter, drives store.viewSeq) and `plyCount` (drives move-log
  // numbering) are two independent counters on the wire — kept as separate params so tests can't
  // accidentally conflate them.
  function playView(seq: number, plyCount: number, lastMove?: LastMove): ServerMsg {
    return {
      t: 'VIEW',
      view: { viewer: 'RED', phase: 'PLAY', turn: 'RED', plyCount, pieces: [], result: null, myRecentMoves: {} },
      captured: { RED: [], BLUE: [] },
      lastMove,
      seq,
    };
  }

  it('does not append when a VIEW carries no lastMove (e.g. PLAY_STARTED), but still tracks plyCount', () => {
    const store = makeStore();
    applyServerMsg(store, playView(1, 0));
    expect(store.moveLog).toEqual([]);
    expect(store.viewSeq).toBe(1);
    expect(store.lastPlyLogged).toBe(0);
  });

  it('appends a plain move as "<n>. <fromAlg>→<toAlg>", numbered by plyCount', () => {
    const store = makeStore();
    // e2 (r=8,c=4) -> e3 (r=7,c=4) in engine coords (row 9 = rank 1, col a=0..j=9).
    applyServerMsg(store, playView(1, 1, { from: { r: 8, c: 4 }, to: { r: 7, c: 4 }, by: 'RED' }));
    expect(store.moveLog).toEqual(['1. e2→e3']);
    expect(store.lastPlyLogged).toBe(1);
  });

  it('appends a strike with a rank-glyph suffix, and keeps numbering across multiple moves', () => {
    const store = makeStore();
    applyServerMsg(store, playView(1, 1, { from: { r: 8, c: 4 }, to: { r: 7, c: 4 }, by: 'RED' }));
    applyServerMsg(
      store,
      playView(2, 2, {
        from: { r: 1, c: 4 },
        to: { r: 7, c: 4 },
        by: 'BLUE',
        strike: { attackerRank: 'SERGEANT', defenderRank: 'MARSHAL', outcome: 'DEFENDER' },
      }),
    );
    expect(store.moveLog).toEqual(['1. e2→e3', '2. e9→e3 ⚔ 7×1']);
    expect(store.viewSeq).toBe(2);
  });

  it('numbers by plyCount, not moveLog.length — a gap does not renumber later moves back to a low count', () => {
    const store = makeStore();
    applyServerMsg(store, playView(1, 1, { from: { r: 8, c: 4 }, to: { r: 7, c: 4 }, by: 'RED' }));
    // Plies 2-4 happened while we were disconnected and are never individually seen; the rejoin
    // resend (lastMove absent) jumps straight to plyCount 4.
    applyServerMsg(store, playView(2, 4));
    // The next real move is ply 5 — must be numbered "5.", not "2." (moveLog.length was 1).
    applyServerMsg(store, playView(3, 5, { from: { r: 1, c: 4 }, to: { r: 6, c: 4 }, by: 'BLUE' }));
    expect(store.moveLog).toEqual(['1. e2→e3', '— reconnected —', '5. e9→e4']);
  });

  it('does not insert a divider for a normal +1 lastMove-less VIEW (none occurs in practice, but the boundary must not false-positive)', () => {
    const store = makeStore();
    applyServerMsg(store, playView(1, 1, { from: { r: 8, c: 4 }, to: { r: 7, c: 4 }, by: 'RED' }));
    applyServerMsg(store, playView(2, 2)); // hypothetical lastMove-less VIEW one ply later
    expect(store.moveLog).toEqual(['1. e2→e3']); // no divider — gap is exactly 1, not >1
    expect(store.lastPlyLogged).toBe(2);
  });

  it('does not insert a divider on the very first VIEW of a session, even mid-game (a fresh join/spectator)', () => {
    const store = makeStore();
    // First VIEW this store has ever seen is already at plyCount 12 (joined mid-game) — nothing
    // to compare against yet, so no spurious "reconnected" divider on a normal join.
    applyServerMsg(store, playView(1, 12));
    expect(store.moveLog).toEqual([]);
    expect(store.lastPlyLogged).toBe(12);
  });
});

describe('applyServerMsg — GAME_OVER / REMATCH_STATE / OPPONENT_STATUS', () => {
  function finalView(): WatchView {
    return {
      phase: 'GAME_OVER',
      turn: 'RED',
      plyCount: 10,
      pieces: [],
      result: { winner: 'RED', reason: 'FLAG_CAPTURED' },
    };
  }

  it('GAME_OVER sets finalView/result/captured and resets rematchVotes to []', () => {
    const store = makeStore();
    store.rematchVotes = ['RED']; // stale from a previous game-over, must not leak
    const msg: ServerMsg = {
      t: 'GAME_OVER',
      result: { winner: 'RED', reason: 'FLAG_CAPTURED' },
      finalView: finalView(),
      captured: { RED: [], BLUE: ['FLAG'] },
    };
    applyServerMsg(store, msg);
    expect(store.phase).toBe('GAME_OVER');
    expect(store.result).toEqual({ winner: 'RED', reason: 'FLAG_CAPTURED' });
    expect(store.finalView).toEqual(finalView());
    expect(store.captured).toEqual({ RED: [], BLUE: ['FLAG'] });
    expect(store.rematchVotes).toEqual([]);
  });

  it('REMATCH_STATE sets rematchVotes verbatim', () => {
    const store = makeStore();
    applyServerMsg(store, { t: 'REMATCH_STATE', votes: ['RED'] });
    expect(store.rematchVotes).toEqual(['RED']);
    applyServerMsg(store, { t: 'REMATCH_STATE', votes: ['RED', 'BLUE'] });
    expect(store.rematchVotes).toEqual(['RED', 'BLUE']);
  });

  it('OPPONENT_STATUS merges into connection without clobbering the other seat', () => {
    const store = makeStore();
    expect(store.connection).toEqual({ RED: true, BLUE: true });
    applyServerMsg(store, { t: 'OPPONENT_STATUS', seat: 'BLUE', connected: false });
    expect(store.connection).toEqual({ RED: true, BLUE: false });
    applyServerMsg(store, { t: 'OPPONENT_STATUS', seat: 'BLUE', connected: true });
    expect(store.connection).toEqual({ RED: true, BLUE: true });
  });

  it('a fresh SETUP_STATUS (rematch) clears moveLog/lastMove/captured/finalView/result/rematchVotes', () => {
    const store = makeStore();
    store.moveLog = ['1. e2→e3'];
    store.lastMove = { from: { r: 8, c: 4 }, to: { r: 7, c: 4 }, by: 'RED' };
    store.captured = { RED: [], BLUE: ['FLAG'] };
    store.finalView = finalView();
    store.result = { winner: 'RED', reason: 'FLAG_CAPTURED' };
    store.rematchVotes = ['RED', 'BLUE'];
    store.role = 'RED';
    store.lastPlyLogged = 40;

    applyServerMsg(store, { t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });

    expect(store.moveLog).toEqual([]);
    expect(store.lastMove).toBeNull();
    expect(store.captured).toBeNull();
    expect(store.finalView).toBeNull();
    expect(store.result).toBeNull();
    expect(store.rematchVotes).toBeNull();
    expect(store.lastPlyLogged).toBeNull();
  });
});
