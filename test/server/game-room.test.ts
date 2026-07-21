import { describe, expect, it } from 'vitest';
import { GameRoom, capturedRanks, watchView, type Scheduler } from '../../src/server/game-room.js';
import { createGame, presetNames, presetPlacement, rosterPieceIds, strategoReduce, type Color, type GameState, type PieceId, type Square } from '../../src/engine/index.js';
import type { ServerMsg } from '../../src/server/protocol.js';

function member() {
  const inbox: ServerMsg[] = [];
  return { inbox, send: (m: ServerMsg) => inbox.push(m) };
}

function manualScheduler(): Scheduler & { fire(): void } {
  const pending: (() => void)[] = [];
  return {
    set(fn: () => void, _ms: number) {
      pending.push(fn);
      return fn;
    },
    clear(id: unknown) {
      const i = pending.indexOf(id as () => void);
      if (i >= 0) pending.splice(i, 1);
    },
    fire() {
      const toRun = pending.splice(0);
      for (const fn of toRun) fn();
    },
  };
}

function fullPlacement(color: Color, presetName = presetNames()[0]!): [PieceId, Square][] {
  const map = presetPlacement(color, presetName);
  if (!map) throw new Error('bad preset');
  return Object.entries(map) as [PieceId, Square][];
}

function lastMsg(inbox: ServerMsg[]): ServerMsg {
  const m = inbox[inbox.length - 1];
  if (!m) throw new Error('inbox empty');
  return m;
}

describe('GameRoom membership', () => {
  it('human/human: 1st join RED, 2nd BLUE, 3rd null; each join broadcasts SETUP_STATUS', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const a = member();
    const b = member();
    const c = member();

    const joinedA = room.joinHuman(a.send);
    expect(joinedA?.role).toBe('RED');
    expect(a.inbox).toHaveLength(1);
    expect(lastMsg(a.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });

    const joinedB = room.joinHuman(b.send);
    expect(joinedB?.role).toBe('BLUE');
    // Broadcast: both members should have received a SETUP_STATUS on B's join.
    expect(a.inbox).toHaveLength(2);
    expect(b.inbox).toHaveLength(1);
    expect(lastMsg(b.inbox)).toMatchObject({ t: 'SETUP_STATUS' });

    const joinedC = room.joinHuman(c.send);
    expect(joinedC).toBeNull();
    expect(c.inbox).toHaveLength(0);
  });

  it('COMMIT_SETUP: valid full placement -> SETUP_STATUS ready flips true', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    room.joinHuman(blue.send);

    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });

    expect(lastMsg(red.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: true, BLUE: false } });
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: true, BLUE: false } });
  });

  it('COMMIT_SETUP: garbage (incomplete/39 pieces) -> ERROR BAD_SETUP, state unchanged; recommit valid works', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    const full = fullPlacement('RED');
    const incomplete = full.slice(0, 39); // drop one piece -> setup incomplete

    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: incomplete });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'ERROR', code: 'BAD_SETUP' });

    // State unchanged: recommitting the valid full placement should succeed.
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: full });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: true, BLUE: false } });
  });

  it('COMMIT_SETUP: garbage (wrong square) -> ERROR BAD_SETUP', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    const full = fullPlacement('RED');
    const bad: [PieceId, Square][] = [...full.slice(1), [full[0]![0], { r: 0, c: 0 }]]; // row 0 is BLUE territory

    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: bad });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'ERROR', code: 'BAD_SETUP' });
  });

  it('COMMIT_SETUP: garbage (enemy piece id) -> ERROR BAD_SETUP', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    const full = fullPlacement('RED');
    const bluePiece = fullPlacement('BLUE')[0]!;
    const bad: [PieceId, Square][] = [bluePiece, ...full.slice(1)];

    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: bad });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'ERROR', code: 'BAD_SETUP' });
  });

  it('both committed -> each member gets a redacted VIEW', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;

    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    room.handle(blueJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('BLUE') });

    const redView = lastMsg(red.inbox);
    expect(redView.t).toBe('VIEW');
    if (redView.t !== 'VIEW') throw new Error('expected VIEW');
    const view = redView.view as { viewer: string; pieces: { id: string; owner: string; rank: string | null }[] };
    expect(view.viewer).toBe('RED');
    for (const p of view.pieces) {
      if (p.owner === 'BLUE') {
        expect(p.rank).toBeNull();
        expect(p.id).not.toMatch(/^BLUE-[A-Z]+-\d+$/);
      }
    }

    const blueView = lastMsg(blue.inbox);
    expect(blueView.t).toBe('VIEW');
  });

  it('vs-bot room: bot seat is set up + ready immediately after creation', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_BOT', scheduler: manualScheduler(), seed: 42 });
    const red = member();
    room.joinHuman(red.send);
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: false, BLUE: true } });
  });

  it('disconnect/rejoin: opponent notified, fresh VIEW on rejoin, bad token -> null', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    room.handle(blueJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('BLUE') });

    room.disconnect(redJoin.token);
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'OPPONENT_STATUS', seat: 'RED', connected: false });

    const newRed = member();
    const role = room.rejoin(redJoin.token, newRed.send);
    expect(role).toBe('RED');
    expect(lastMsg(newRed.inbox).t).toBe('VIEW');
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'OPPONENT_STATUS', seat: 'RED', connected: true });

    expect(room.rejoin('not-a-real-token', newRed.send)).toBeNull();
  });

  it('COMMIT_SETUP after disconnect never invokes the stale send callback', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    room.joinHuman(blue.send);

    room.disconnect(redJoin.token);
    const before = red.inbox.length;
    // A bad (incomplete) COMMIT_SETUP would normally trigger an ERROR reply;
    // since RED is disconnected, handle() must not throw and must not push
    // through the stale `send` callback.
    expect(() => room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: [] })).not.toThrow();
    expect(red.inbox.length).toBe(before);
  });

  it('BOT_VS_BOT: spectator VIEW is a real WatchView (real ranks, no piece ids anywhere)', () => {
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler: manualScheduler(), seed: 7 });
    const spec = member();
    const joined = room.joinHuman(spec.send);
    expect(joined?.role).toBe('SPECTATOR');

    const msg = lastMsg(spec.inbox);
    expect(msg.t).toBe('VIEW');
    if (msg.t !== 'VIEW') throw new Error('expected VIEW');
    const view = msg.view as {
      phase: string;
      pieces: { owner: string; pos: Square; rank: string | null; revealed: boolean }[];
    };
    // Both bot seats set up at construction, so the room is already in PLAY.
    expect(view.phase).toBe('PLAY');
    expect(view.pieces.length).toBeGreaterThan(0);
    for (const p of view.pieces) {
      expect(p.rank).not.toBeNull();
      expect('id' in p).toBe(false);
    }

    const serialized = JSON.stringify(msg);
    expect(serialized).not.toMatch(
      /(RED|BLUE)-(MARSHAL|GENERAL|COLONEL|MAJOR|CAPTAIN|LIEUTENANT|SERGEANT|MINER|SCOUT|SPY|BOMB|FLAG)-/,
    );
  });
});

describe('capturedRanks / watchView', () => {
  /** Fully placed game (both sides on the board), with one piece per side then captured. */
  function fullyPlacedState(): GameState {
    let s = createGame();
    for (const color of ['RED', 'BLUE'] as const) {
      s = strategoReduce(s, { type: 'SETUP_RANDOM', color, order: rosterPieceIds(color) }).state;
    }
    return s;
  }

  function withOneCaptureEach(s: GameState): GameState {
    const redId = Object.keys(s.pieces).find((id) => s.pieces[id]!.owner === 'RED')!;
    const blueId = Object.keys(s.pieces).find((id) => s.pieces[id]!.owner === 'BLUE')!;
    s.pieces[redId]!.pos = null;
    s.pieces[blueId]!.pos = null;
    return s;
  }

  it('capturedRanks buckets captured (pos===null) pieces by owner and rank', () => {
    const s = withOneCaptureEach(fullyPlacedState());
    const redId = Object.keys(s.pieces).find((id) => s.pieces[id]!.owner === 'RED' && s.pieces[id]!.pos === null)!;
    const blueId = Object.keys(s.pieces).find((id) => s.pieces[id]!.owner === 'BLUE' && s.pieces[id]!.pos === null)!;
    const out = capturedRanks(s);
    expect(out.RED).toEqual([s.pieces[redId]!.rank]);
    expect(out.BLUE).toEqual([s.pieces[blueId]!.rank]);
  });

  it('capturedRanks is empty once every piece is placed on the board', () => {
    const s = fullyPlacedState();
    expect(capturedRanks(s)).toEqual({ RED: [], BLUE: [] });
  });

  it('watchView reveals real ranks and owners for all placed pieces, omits captured ones', () => {
    const s = withOneCaptureEach(fullyPlacedState());
    const placedId = Object.keys(s.pieces).find((id) => s.pieces[id]!.pos !== null)!;
    const wv = watchView(s);
    expect(wv.phase).toBe(s.phase);
    expect(wv.turn).toBe(s.turn);
    expect(wv.pieces.length).toBe(Object.values(s.pieces).filter((p) => p.pos !== null).length);
    const target = s.pieces[placedId]!.pos!;
    const found = wv.pieces.find((p) => p.pos.r === target.r && p.pos.c === target.c);
    expect(found).toBeDefined();
    expect(found!.rank).toBe(s.pieces[placedId]!.rank);
    expect(found!.owner).toBe(s.pieces[placedId]!.owner);
  });
});
