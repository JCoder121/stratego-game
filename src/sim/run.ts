import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../engine/index.js';
import type { Action, Color, GameResult, GameState } from '../engine/types.js';
import type { Bot } from '../bots/types.js';
import { randomBot } from '../bots/random.js';
import { heuristicBot } from '../bots/heuristic.js';
import { makeSeeded, type Rng } from '../rng/rng.js';

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

export function playGame(opts: { seed: number; red: Bot; blue: Bot; maxPlies?: number }): GameResult {
  const maxPlies = opts.maxPlies ?? 2000;
  let s = setupBothRandom(opts.seed, maxPlies);
  const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
  const rng: Rng = makeSeeded(opts.seed ^ 0x9e3779b9);

  let guard = maxPlies * 4 + 100;
  while (s.phase === 'PLAY' && guard-- > 0) {
    const color = s.turn;
    const view = viewFor(s, color);
    let applied = false;
    for (let attempt = 0; attempt < 5 && !applied; attempt++) {
      const action: Action = bots[color](view, rng);
      const { state, events } = strategoReduce(s, action);
      if (events[0]?.type === 'REJECTED') continue; // re-query with fresh rng draw
      s = state;
      applied = true;
    }
    if (!applied) {
      s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
  }
  return s.result ?? { winner: null, reason: 'PLY_CAP' };
}

export function runSims(opts: { games: number; seed: number; red: Bot; blue: Bot }): {
  redWins: number; blueWins: number; draws: number; avgPlies: number; reasons: Record<string, number>;
} {
  let redWins = 0, blueWins = 0, draws = 0, plies = 0;
  const reasons: Record<string, number> = {};
  for (let i = 0; i < opts.games; i++) {
    const maxPlies = 2000;
    let s = setupBothRandom(opts.seed + i, maxPlies);
    const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
    const rng = makeSeeded((opts.seed + i) ^ 0x9e3779b9);
    let guard = maxPlies * 4 + 100;
    while (s.phase === 'PLAY' && guard-- > 0) {
      const color = s.turn;
      const view = viewFor(s, color);
      let applied = false;
      for (let attempt = 0; attempt < 5 && !applied; attempt++) {
        const action = bots[color](view, rng);
        const { state, events } = strategoReduce(s, action);
        if (events[0]?.type === 'REJECTED') continue;
        s = state; applied = true;
      }
      if (!applied) s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
    const result = s.result ?? { winner: null, reason: 'PLY_CAP' };
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    plies += s.plyCount;
    if (result.winner === 'RED') redWins++;
    else if (result.winner === 'BLUE') blueWins++;
    else draws++;
  }
  return { redWins, blueWins, draws, avgPlies: plies / opts.games, reasons };
}

// npm run sim
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const stats = runSims({ games: 200, seed: 1, red: heuristicBot, blue: randomBot });
  console.log('Stratego sim — heuristic (RED) vs random (BLUE), 200 games');
  console.log(stats);
}
