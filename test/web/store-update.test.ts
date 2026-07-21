import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '../../src/server/protocol.js';
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
