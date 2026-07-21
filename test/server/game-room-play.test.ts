import { describe, expect, it } from 'vitest';
import { BOT_DELAY_MS, GameRoom } from '../../src/server/game-room.js';
import { presetNames } from '../../src/engine/index.js';
import type { Bot } from '../../src/bots/types.js';
import { fullPlacement, lastMsg, manualScheduler, member, placementWithOverrides } from './helpers.js';

const RANK_ID = '(MARSHAL|GENERAL|COLONEL|MAJOR|CAPTAIN|LIEUTENANT|SERGEANT|MINER|SCOUT|SPY|BOMB|FLAG)';
// A recipient's own real piece ids are expected (viewFor reveals them by design); only the
// *enemy* color's real-id pattern must never leak into that recipient's messages.
function enemyIdPattern(recipientColor: 'RED' | 'BLUE'): RegExp {
  const enemy = recipientColor === 'RED' ? 'BLUE' : 'RED';
  return new RegExp(`${enemy}-${RANK_ID}-`);
}
// GAME_OVER's finalView is always a WatchView (all-revealed, no ids at all, by construction) —
// so unlike a player VIEW, no real id of *either* color should ever appear in a GAME_OVER message.
const ANY_REAL_ID_PATTERN = new RegExp(`(RED|BLUE)-${RANK_ID}-`);

function setupBoth(room: GameRoom, redToken: string, blueToken: string, presetName: string): void {
  room.handle(redToken, { t: 'COMMIT_SETUP', placement: fullPlacement('RED', presetName) });
  room.handle(blueToken, { t: 'COMMIT_SETUP', placement: fullPlacement('BLUE', presetName) });
}

describe('GameRoom play: lastMove / strike', () => {
  it.each(presetNames())('legal MOVE broadcasts lastMove {from,to,by} (preset=%s)', (presetName) => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, presetName);

    // Under 'balanced' assignment, roster order places RED-MARSHAL-0 at (6,0); (5,0) is always
    // empty (rows 4-5 are neutral, col 0 is never a lake) regardless of preset, so this is a
    // legal non-capturing move for either preset.
    room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    });

    const msg = lastMsg(red.inbox);
    expect(msg.t).toBe('VIEW');
    if (msg.t !== 'VIEW') throw new Error('expected VIEW');
    expect(msg.lastMove).toMatchObject({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, by: 'RED' });
    expect(msg.lastMove?.strike).toBeUndefined();
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'VIEW', lastMove: { from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, by: 'RED' } });
  });

  it('a strike carries both ranks and never leaks a real enemy PieceId', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;

    // RED-SCOUT-0 at (6,0) can slide the whole open column straight into BLUE-SPY-0 at (3,0)
    // in one move (scouts attack at range) — a strike on turn 1, no setup dance required.
    const redPlacement = placementWithOverrides('RED', [['RED-SCOUT-0', { r: 6, c: 0 }]]);
    const bluePlacement = placementWithOverrides('BLUE', [['BLUE-SPY-0', { r: 3, c: 0 }]]);
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: redPlacement });
    room.handle(blueJoin.token, { t: 'COMMIT_SETUP', placement: bluePlacement });

    room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 3, c: 0 } },
      seq: 1,
    });

    const msg = lastMsg(red.inbox);
    expect(msg.t).toBe('VIEW');
    if (msg.t !== 'VIEW') throw new Error('expected VIEW');
    expect(msg.lastMove?.strike).toEqual({ attackerRank: 'SCOUT', defenderRank: 'SPY', outcome: 'ATTACKER' });

    for (const m of red.inbox) expect(JSON.stringify(m)).not.toMatch(enemyIdPattern('RED'));
    for (const m of blue.inbox) expect(JSON.stringify(m)).not.toMatch(enemyIdPattern('BLUE'));
  });
});

describe('GameRoom play: turn / seat enforcement', () => {
  function playRoom() {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced');
    return { room, red, blue, redJoin, blueJoin };
  }

  it('BLUE MOVE on RED\'s turn -> ERROR NOT_YOUR_TURN', () => {
    const { room, blue, blueJoin } = playRoom();
    room.handle(blueJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } },
      seq: 1,
    });
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'ERROR', code: 'NOT_YOUR_TURN' });
  });

  it('spectator ACTION -> error', () => {
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler: manualScheduler(), seed: 1 });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;
    const before = spec.inbox.length;
    room.handle(specJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    });
    expect(spec.inbox.length).toBe(before + 1);
    expect(lastMsg(spec.inbox).t).toBe('ERROR');
  });

  it('stale seq (<= last seen from that member) is silently dropped, distinct from a loud error', () => {
    const { room, blue, blueJoin } = playRoom();
    room.handle(blueJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } },
      seq: 1,
    });
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'ERROR', code: 'NOT_YOUR_TURN' });
    const afterFirst = blue.inbox.length;

    // Same seq again: dropped before any processing, so no additional message at all.
    room.handle(blueJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } },
      seq: 1,
    });
    expect(blue.inbox.length).toBe(afterFirst);
  });

  it('ACTION after disconnect never invokes the stale send callback', () => {
    const { room, red, redJoin } = playRoom();
    room.disconnect(redJoin.token);
    const before = red.inbox.length;
    expect(() => room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    })).not.toThrow();
    expect(red.inbox.length).toBe(before);
  });
});

describe('GameRoom play: bot pump', () => {
  it('vs-bot room: firing the manual scheduler runs exactly one bot action per fire, at BOT_DELAY_MS, until the human\'s turn', () => {
    expect(BOT_DELAY_MS).toBe(500);
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'HUMAN_VS_BOT', scheduler, seed: 42 });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });

    expect(scheduler.pendingCount()).toBe(0); // it's RED's (human) turn first

    room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    });

    expect(scheduler.pendingCount()).toBe(1); // BLUE bot's turn now scheduled
    expect(scheduler.lastDelay()).toBe(BOT_DELAY_MS);

    scheduler.fire();

    // Exactly one bot action ran: turn is back to RED, nothing else pending.
    const msg = lastMsg(red.inbox);
    expect(msg.t).toBe('VIEW');
    if (msg.t !== 'VIEW') throw new Error('expected VIEW');
    expect(msg.lastMove?.by).toBe('BLUE');
    expect(scheduler.pendingCount()).toBe(0);
  });
});

describe('GameRoom play: watch mode', () => {
  it('starts paused; play/step/pause/speed control the pump; game reaches GAME_OVER exactly once, all-revealed', () => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler, seed: 7, watchSpeed: 500 });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;

    expect(scheduler.pendingCount()).toBe(0); // paused at construction

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'play' });
    expect(scheduler.pendingCount()).toBe(1);
    expect(scheduler.lastDelay()).toBe(500);

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'pause' });
    expect(scheduler.pendingCount()).toBe(0);

    const before = spec.inbox.length;
    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'step' });
    expect(spec.inbox.length).toBe(before + 1); // one ply's worth of VIEW broadcast
    expect(scheduler.pendingCount()).toBe(0); // step does not schedule

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'speed', speed: 1000 });
    expect(scheduler.pendingCount()).toBe(0); // still paused, no reschedule

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'play' });
    expect(scheduler.lastDelay()).toBe(1000); // reflects the updated speed

    let guard = 0;
    while (lastMsg(spec.inbox).t !== 'GAME_OVER' && guard < 5000) {
      scheduler.fire();
      guard++;
    }
    expect(guard).toBeLessThan(5000);

    const gameOvers = spec.inbox.filter((m) => m.t === 'GAME_OVER');
    expect(gameOvers).toHaveLength(1);
    const over = gameOvers[0]!;
    if (over.t !== 'GAME_OVER') throw new Error('expected GAME_OVER');
    expect(over.finalView.pieces.every((p) => p.rank !== null)).toBe(true);
    expect(JSON.stringify(over)).not.toMatch(ANY_REAL_ID_PATTERN);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('play then step then speed does not silently resume autoplay', () => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler, seed: 13, watchSpeed: 500 });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'play' });
    expect(scheduler.pendingCount()).toBe(1);

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'step' });
    expect(scheduler.pendingCount()).toBe(0); // step cancels the pending autoplay timer too

    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'speed', speed: 1000 });
    expect(scheduler.pendingCount()).toBe(0); // must NOT silently resume autoplay
  });
});

describe('GameRoom play: resign + rematch', () => {
  it('RESIGN ends the game with reason RESIGN', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced');

    room.handle(redJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 1 });

    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'GAME_OVER', result: { winner: 'BLUE', reason: 'RESIGN' } });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'GAME_OVER', result: { winner: 'BLUE', reason: 'RESIGN' } });
  });

  it('REMATCH_REQUEST: one vote -> REMATCH_STATE; both votes -> fresh SETUP views, votes cleared', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced');
    room.handle(redJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 1 });

    room.handle(redJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'REMATCH_STATE', votes: ['RED'] });
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'REMATCH_STATE', votes: ['RED'] });

    room.handle(blueJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });
    expect(lastMsg(blue.inbox)).toMatchObject({ t: 'SETUP_STATUS', ready: { RED: false, BLUE: false } });

    // Votes cleared (not just "state reset"): play a second game to GAME_OVER and confirm a
    // single new vote reports just that one voter again, not a stale/accumulated set.
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced');
    room.handle(redJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 2 });
    room.handle(redJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'REMATCH_STATE', votes: ['RED'] });
  });

  it('BOT_VS_BOT: a single spectator vote restarts the game, paused again', () => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler, seed: 3 });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;

    // Drive to game over first.
    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'play' });
    let guard = 0;
    while (lastMsg(spec.inbox).t !== 'GAME_OVER' && guard < 5000) {
      scheduler.fire();
      guard++;
    }
    expect(lastMsg(spec.inbox).t).toBe('GAME_OVER');

    room.handle(specJoin.token, { t: 'REMATCH_REQUEST' });
    const msg = lastMsg(spec.inbox);
    expect(msg.t).toBe('VIEW');
    if (msg.t !== 'VIEW') throw new Error('expected VIEW');
    expect((msg.view as { phase: string }).phase).toBe('PLAY'); // both bot seats re-set-up immediately

    // Paused again: no scheduler entry until 'play' is sent.
    expect(scheduler.pendingCount()).toBe(0);
  });
});

describe('GameRoom play: off-turn resign', () => {
  it('BLUE resigning while it is RED\'s turn still ends the game (winner RED), exactly one GAME_OVER each', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced'); // phase PLAY, turn RED

    room.handle(blueJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'BLUE' }, seq: 1 });

    for (const inbox of [red.inbox, blue.inbox]) {
      const overs = inbox.filter((m) => m.t === 'GAME_OVER');
      expect(overs).toHaveLength(1);
      expect(overs[0]).toMatchObject({ result: { winner: 'RED', reason: 'RESIGN' } });
    }
  });

  it('RED resigning while it is BLUE\'s turn ends the game (winner BLUE) and cancels a pending bot timer', () => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'HUMAN_VS_BOT', scheduler, seed: 9 });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    });
    expect(scheduler.pendingCount()).toBe(1); // BLUE (bot)'s turn scheduled

    // It is now BLUE's turn; RED resigns off-turn.
    room.handle(redJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 2 });

    expect(scheduler.pendingCount()).toBe(0); // the pending bot ply was cancelled
    const overs = red.inbox.filter((m) => m.t === 'GAME_OVER');
    expect(overs).toHaveLength(1);
    expect(overs[0]).toMatchObject({ result: { winner: 'BLUE', reason: 'RESIGN' } });
  });
});

describe('GameRoom play: REMATCH_REQUEST gating', () => {
  it('mid-PLAY rematch request is rejected with INVALID_ACTION; votes stay untouched', () => {
    const room = new GameRoom({ mode: 'HUMAN_VS_HUMAN', scheduler: manualScheduler() });
    const red = member();
    const blue = member();
    const redJoin = room.joinHuman(red.send)!;
    const blueJoin = room.joinHuman(blue.send)!;
    setupBoth(room, redJoin.token, blueJoin.token, 'balanced'); // phase PLAY

    room.handle(redJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'ERROR', code: 'INVALID_ACTION' });

    // Not just an empty-message no-op: votes really are untouched, proven by a real post-game-over
    // vote reporting just that one voter (not e.g. a leftover from the rejected mid-PLAY attempt).
    room.handle(redJoin.token, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 1 });
    room.handle(redJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(red.inbox)).toMatchObject({ t: 'REMATCH_STATE', votes: ['RED'] });
  });

  it('BOT_VS_BOT: mid-PLAY spectator rematch request is rejected; game state is unaffected', () => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler, seed: 11 });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;

    room.handle(specJoin.token, { t: 'REMATCH_REQUEST' });
    expect(lastMsg(spec.inbox)).toMatchObject({ t: 'ERROR', code: 'INVALID_ACTION' });

    // Unaffected: still paused, no scheduler activity from the rejected request.
    expect(scheduler.pendingCount()).toBe(0);
  });
});

describe('GameRoom play: bot crash -> resign', () => {
  it('a throwing bot resigns its seat instead of throwing out of the room', () => {
    const throwingBot: Bot = () => {
      throw new Error('bot bug');
    };
    const scheduler = manualScheduler();
    const room = new GameRoom({
      mode: 'HUMAN_VS_BOT',
      scheduler,
      seed: 5,
      bots: { BLUE: 'random' },
      botFactory: (kind) => (kind === 'random' ? throwingBot : (() => { throw new Error('unused'); })),
    });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    room.handle(redJoin.token, {
      t: 'ACTION',
      action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      seq: 1,
    });

    expect(() => scheduler.fire()).not.toThrow();

    const msg = lastMsg(red.inbox);
    expect(msg).toMatchObject({ t: 'GAME_OVER', result: { winner: 'RED', reason: 'RESIGN' } });
    expect(JSON.stringify(msg)).not.toMatch(ANY_REAL_ID_PATTERN);
  });
});
