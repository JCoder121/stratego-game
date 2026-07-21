import { describe, expect, it } from 'vitest';
import { GameRoom } from '../../src/server/game-room.js';
import type { ServerMsg } from '../../src/server/protocol.js';
import { legalMovesFromView } from '../../src/bots/moves-from-view.js';
import { makeSeeded } from '../../src/rng/rng.js';
import {
  ANY_REAL_ID_PATTERN, enemyIdPattern, fullPlacement, lastMsg, manualScheduler, member,
} from './helpers.js';

// Per the brief: 25 seeded games per mode, scheduler fires capped at 5000 per game (games may
// also legitimately end via PLY_CAP before hitting that cap).
const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);
const FIRE_CAP = 5000;

/** Scans every recorded message sent to one recipient (a seated color, or a pure spectator) for
 * wire-format redaction leaks:
 *  - the enemy's real piece ids (`${enemy}-${RANK}-${n}`) must never appear in serialized form
 *    (spectators hold no seat, so for them *neither* color's real ids may ever appear — WatchView
 *    is all-revealed-but-id-free by construction);
 *  - every PlayerView's unrevealed enemy pieces must report rank === null;
 *  - GAME_OVER's finalView is exempt from the rank check (game over reveals everything by
 *    definition) but its pieces must still carry no `id` field at all (WatchView shape), and the
 *    id-string check above still applies to the whole GAME_OVER message.
 */
function assertNoLeaks(inbox: ServerMsg[], recipient: 'RED' | 'BLUE' | 'SPECTATOR'): void {
  const idPattern = recipient === 'SPECTATOR' ? ANY_REAL_ID_PATTERN : enemyIdPattern(recipient);
  for (const msg of inbox) {
    expect(JSON.stringify(msg)).not.toMatch(idPattern);

    if (msg.t === 'VIEW' && 'viewer' in msg.view) {
      // A PlayerView: every enemy piece not yet revealed must have its rank redacted.
      for (const p of msg.view.pieces) {
        if (p.owner !== msg.view.viewer && !p.revealed) {
          expect(p.rank).toBeNull();
        }
      }
    }

    if (msg.t === 'GAME_OVER') {
      for (const p of msg.finalView.pieces) {
        expect(p).not.toHaveProperty('id');
      }
    }
  }
}

describe('wire-redaction property suite', () => {
  it.each(SEEDS)('HUMAN_VS_BOT seed=%i: RED never receives BLUE\'s hidden ids/ranks', (seed) => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'HUMAN_VS_BOT', scheduler, seed });
    const red = member();
    const redJoin = room.joinHuman(red.send)!;
    room.handle(redJoin.token, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });

    // Scripted human actor: picks the first legal move under a seeded rng distinct from the
    // room's own seed stream, driving RED's turns; BLUE's turns are pumped via the scheduler.
    const actorRng = makeSeeded(seed + 1_000_000);
    let seq = 1;
    let fires = 0;
    while (lastMsg(red.inbox).t !== 'GAME_OVER' && fires < FIRE_CAP) {
      const last = lastMsg(red.inbox);
      if (last.t === 'VIEW' && last.view.phase === 'PLAY' && last.view.turn === 'RED' && 'viewer' in last.view) {
        const moves = legalMovesFromView(last.view);
        if (moves.length === 0) throw new Error('expected RED to have a legal move on its own turn');
        const choice = moves[actorRng.int(moves.length)]!;
        room.handle(redJoin.token, {
          t: 'ACTION',
          action: { type: 'MOVE', color: 'RED', from: choice.from, to: choice.to },
          seq: seq++,
        });
      } else {
        scheduler.fire();
        fires++;
      }
    }
    expect(fires).toBeLessThan(FIRE_CAP); // didn't hit the cap unfinished (PLY_CAP ending is fine)

    assertNoLeaks(red.inbox, 'RED');
  });

  it.each(SEEDS)('BOT_VS_BOT seed=%i: the spectator never receives any real piece id', (seed) => {
    const scheduler = manualScheduler();
    const room = new GameRoom({ mode: 'BOT_VS_BOT', scheduler, seed });
    const spec = member();
    const specJoin = room.joinHuman(spec.send)!;
    room.handle(specJoin.token, { t: 'WATCH_CONTROL', control: 'play' });

    let fires = 0;
    while (lastMsg(spec.inbox).t !== 'GAME_OVER' && fires < FIRE_CAP) {
      scheduler.fire();
      fires++;
    }
    expect(fires).toBeLessThan(FIRE_CAP);

    assertNoLeaks(spec.inbox, 'SPECTATOR');
  });
});
