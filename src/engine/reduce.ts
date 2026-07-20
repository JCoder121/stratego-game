import { resolveCombat } from './combat.js';
import { pieceAt } from './init.js';
import { isScout } from './pieceDefs.js';
import { presetPlacement, randomPlacement } from './setups.js';
import { hasAnyLegalAction, movablePieceCount, recordMove } from './rules.js';
import { validateAction } from './validate.js';
import type { Action, Color, GameEvent, GameState } from './types.js';

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
const other = (c: Color): Color => (c === 'RED' ? 'BLUE' : 'RED');

function reject(state: GameState, reason: string): { state: GameState; events: GameEvent[] } {
  return { state, events: [{ type: 'REJECTED', reason }] };
}

function applyEndConditions(
  s: GameState,
  events: GameEvent[],
): void {
  // Called after a non-flag-capturing PLAY action; s.turn already advanced.
  const mover = other(s.turn); // player who just moved
  if (movablePieceCount(s, 'RED') === 0 && movablePieceCount(s, 'BLUE') === 0) {
    s.phase = 'GAME_OVER';
    s.result = { winner: null, reason: 'DEAD_POSITION' };
    events.push({ type: 'GAME_OVER', result: s.result });
    return;
  }
  if (!hasAnyLegalAction(s, s.turn)) {
    s.phase = 'GAME_OVER';
    s.result = { winner: mover, reason: 'NO_MOVES' };
    events.push({ type: 'GAME_OVER', result: s.result });
    return;
  }
  if (s.plyCount >= s.config.maxPlies) {
    s.phase = 'GAME_OVER';
    s.result = { winner: null, reason: 'PLY_CAP' };
    events.push({ type: 'GAME_OVER', result: s.result });
  }
}

function doInner(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const invalid = validateAction(state, action);
  if (invalid) return reject(state, invalid);

  const s = clone(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'SETUP_PLACE': {
      s.pieces[action.pieceId]!.pos = action.to;
      events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: action.pieceId, to: action.to });
      return { state: s, events };
    }
    case 'SETUP_PRESET': {
      const placement = presetPlacement(action.color, action.preset);
      if (!placement) return reject(state, `unknown preset: ${action.preset}`);
      for (const p of Object.values(s.pieces)) if (p.owner === action.color) p.pos = null;
      events.push({ type: 'SETUP_CLEARED', color: action.color });
      for (const [id, sq] of Object.entries(placement)) {
        s.pieces[id]!.pos = sq;
        events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: id, to: sq });
      }
      return { state: s, events };
    }
    case 'SETUP_RANDOM': {
      const placement = randomPlacement(action.color, action.order);
      for (const p of Object.values(s.pieces)) if (p.owner === action.color) p.pos = null;
      events.push({ type: 'SETUP_CLEARED', color: action.color });
      for (const [id, sq] of Object.entries(placement)) {
        s.pieces[id]!.pos = sq;
        events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: id, to: sq });
      }
      return { state: s, events };
    }
    case 'SETUP_DONE': {
      s.setupDone[action.color] = true;
      events.push({ type: 'SETUP_COMPLETED', color: action.color });
      if (s.setupDone.RED && s.setupDone.BLUE) {
        s.phase = 'PLAY';
        s.turn = 'RED';
        events.push({ type: 'PLAY_STARTED' });
      }
      return { state: s, events };
    }
    case 'RESIGN': {
      s.phase = 'GAME_OVER';
      s.result = { winner: other(action.color), reason: 'RESIGN' };
      events.push({ type: 'GAME_OVER', result: s.result });
      return { state: s, events };
    }
    case 'MOVE': {
      const mover = pieceAt(s, action.from)!;
      const target = pieceAt(s, action.to);
      const from = action.from;
      const to = action.to;
      const movedMultiple = isScout(mover.rank) &&
        (Math.abs(from.r - to.r) + Math.abs(from.c - to.c)) > 1;

      if (!target) {
        mover.pos = to;
        if (movedMultiple) mover.revealed = true;
        s.recentMoves[mover.id] = recordMove(s.recentMoves[mover.id] ?? [], { pieceId: mover.id, from, to });
        events.push({ type: 'PIECE_MOVED', pieceId: mover.id, from, to });
      } else {
        // strike
        mover.revealed = true;
        target.revealed = true;
        const outcome = resolveCombat(mover.rank, target.rank);
        events.push({
          type: 'STRIKE', attacker: mover.id, defender: target.id,
          attackerRank: mover.rank, defenderRank: target.rank, outcome,
        });
        s.recentMoves[mover.id] = []; // a strike breaks any oscillation
        if (target.rank === 'FLAG' && outcome === 'ATTACKER') {
          target.pos = null;
          mover.pos = to;
          events.push({ type: 'FLAG_CAPTURED', flagId: target.id, by: mover.id });
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
          s.plyCount += 1;
          s.phase = 'GAME_OVER';
          s.result = { winner: mover.owner, reason: 'FLAG_CAPTURED' };
          events.push({ type: 'GAME_OVER', result: s.result });
          return { state: s, events };
        }
        if (outcome === 'ATTACKER') {
          if (target.rank === 'BOMB') {
            events.push({ type: 'BOMB_DEFUSED', bombId: target.id, minerId: mover.id });
          }
          target.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
          mover.pos = to;
        } else if (outcome === 'DEFENDER') {
          mover.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: mover.id });
          // defender stays (incl. surviving bomb)
        } else { // BOTH
          mover.pos = null;
          target.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: mover.id });
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
        }
      }

      s.plyCount += 1;
      s.turn = other(s.turn);
      events.push({ type: 'TURN_PASSED', to: s.turn });
      applyEndConditions(s, events);
      return { state: s, events };
    }
  }
}

export function strategoReduce(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  try {
    return doInner(state, action);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'internal error';
    return reject(state, `rejected: ${reason}`);
  }
}
