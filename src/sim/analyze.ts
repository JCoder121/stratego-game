import {
  createGame, strategoReduce, viewFor, rosterPieceIds,
  legalMovesForColor, violatesTwoSquare, pieceAt, movablePieceCount,
} from '../engine/index.js';
import type { Action, Color, GameResult, GameState } from '../engine/types.js';
import type { Bot } from '../bots/types.js';
import { legalMovesFromView } from '../bots/moves-from-view.js';
import { makeSeeded, type Rng } from '../rng/rng.js';

export interface ForcedResignInfo {
  color: Color;
  engineLegalMoves: number; // moves that pass two-square filtering — what was actually available
  viewLegalMoves: number;   // what the bot's view-based generator offered
  rejectionReasons: string[];
}

export interface GameRecord {
  seed: number;
  result: GameResult;
  plies: number;
  endedBy: 'ENGINE' | 'BOT_RESIGN' | 'FORCED_RESIGN';
  forcedResign: ForcedResignInfo | null;
  survivors: Record<Color, number>;
}

function setupBothRandom(seed: number, maxPlies: number): GameState {
  let s = createGame({ maxPlies, seed });
  const rng = makeSeeded(seed);
  for (const color of ['RED', 'BLUE'] as const) {
    const order = rng.shuffle(rosterPieceIds(color));
    s = strategoReduce(s, { type: 'SETUP_RANDOM', color, order }).state;
    s = strategoReduce(s, { type: 'SETUP_DONE', color }).state;
  }
  return s;
}

function engineLegalMoveCount(s: GameState, color: Color): number {
  let n = 0;
  for (const m of legalMovesForColor(s, color)) {
    const p = pieceAt(s, m.from);
    if (p && !violatesTwoSquare(s, p.id, m.from, m.to)) n++;
  }
  return n;
}

// Mirrors playGame in run.ts exactly (same rng derivation, same 5-attempt retry),
// with passive instrumentation of how the game ended. run.ts is left untouched so
// the baseline stays comparable.
export function playGameDetailed(opts: {
  seed: number; red: Bot; blue: Bot; maxPlies?: number;
}): GameRecord {
  const maxPlies = opts.maxPlies ?? 2000;
  let s = setupBothRandom(opts.seed, maxPlies);
  const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
  const rng: Rng = makeSeeded(opts.seed ^ 0x9e3779b9);

  let endedBy: GameRecord['endedBy'] = 'ENGINE';
  let forcedResign: ForcedResignInfo | null = null;

  let guard = maxPlies * 4 + 100;
  while (s.phase === 'PLAY' && guard-- > 0) {
    const color = s.turn;
    const view = viewFor(s, color);
    let applied = false;
    const rejectionReasons: string[] = [];
    for (let attempt = 0; attempt < 5 && !applied; attempt++) {
      const action: Action = bots[color](view, rng);
      const { state, events } = strategoReduce(s, action);
      if (events[0]?.type === 'REJECTED') {
        rejectionReasons.push(events[0].reason);
        continue;
      }
      if (action.type === 'RESIGN') endedBy = 'BOT_RESIGN';
      s = state;
      applied = true;
    }
    if (!applied) {
      endedBy = 'FORCED_RESIGN';
      forcedResign = {
        color,
        engineLegalMoves: engineLegalMoveCount(s, color),
        viewLegalMoves: legalMovesFromView(view).length,
        rejectionReasons,
      };
      s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
  }

  return {
    seed: opts.seed,
    result: s.result ?? { winner: null, reason: 'PLY_CAP' },
    plies: s.plyCount,
    endedBy,
    forcedResign,
    survivors: {
      RED: movablePieceCount(s, 'RED'),
      BLUE: movablePieceCount(s, 'BLUE'),
    },
  };
}

export interface BatchStats {
  games: number;
  redWins: number; blueWins: number; draws: number;
  reasons: Record<string, number>;
  endedBy: Record<string, number>;
  forcedResignReasons: Record<string, number>; // rejection-reason → count (deduped per game)
  plies: { mean: number; p50: number; p90: number; max: number };
}

export function runBatch(opts: {
  games: number; seed: number; red: Bot; blue: Bot;
}): { stats: BatchStats; records: GameRecord[] } {
  const records: GameRecord[] = [];
  for (let i = 0; i < opts.games; i++) {
    records.push(playGameDetailed({ seed: opts.seed + i, red: opts.red, blue: opts.blue }));
  }
  const sorted = records.map((r) => r.plies).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const stats: BatchStats = {
    games: opts.games,
    redWins: records.filter((r) => r.result.winner === 'RED').length,
    blueWins: records.filter((r) => r.result.winner === 'BLUE').length,
    draws: records.filter((r) => r.result.winner === null).length,
    reasons: {},
    endedBy: {},
    forcedResignReasons: {},
    plies: {
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: pct(50), p90: pct(90), max: sorted[sorted.length - 1]!,
    },
  };
  for (const r of records) {
    stats.reasons[r.result.reason] = (stats.reasons[r.result.reason] ?? 0) + 1;
    stats.endedBy[r.endedBy] = (stats.endedBy[r.endedBy] ?? 0) + 1;
    if (r.forcedResign) {
      for (const reason of new Set(r.forcedResign.rejectionReasons)) {
        stats.forcedResignReasons[reason] = (stats.forcedResignReasons[reason] ?? 0) + 1;
      }
    }
  }
  return { stats, records };
}
