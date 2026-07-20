import { createInterface } from 'node:readline';
import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../engine/index.js';
import type { Action, Color, GameState } from '../engine/types.js';
import { parseCommand } from './parse.js';
import { renderView, renderEvents } from './render.js';
import { heuristicBot } from '../bots/heuristic.js';
import { makeRandom } from '../rng/rng.js';

const HUMAN: Color = 'RED';
const BOT: Color = 'BLUE';
const rng = makeRandom();

function apply(s: GameState, action: Action): GameState {
  const { state, events } = strategoReduce(s, action);
  const msg = renderEvents(events);
  if (msg) console.log(msg);
  return state;
}

async function main() {
  let s = createGame();
  console.log('Stratego — you are RED vs a heuristic bot (BLUE).');
  console.log('Setup: type "setup preset balanced", "setup random", or place pieces, then "done".');

  // Bot sets up immediately (random).
  s = apply(s, { type: 'SETUP_RANDOM', color: BOT, order: rng.shuffle(rosterPieceIds(BOT)) });
  s = apply(s, { type: 'SETUP_DONE', color: BOT });

  // Use an async line iterator (not rl.question) so buffered/piped input —
  // e.g. `printf '...' | npm run cli` or `< script.txt` — is fully consumed;
  // rl.question drops all but the first line when stdin arrives in one chunk.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const promptFor = (): string => (s.phase === 'SETUP' ? 'setup> ' : 'move> ');

  // Human (RED) moves first, so no bot turn is needed before the first prompt.
  console.log(renderView(viewFor(s, HUMAN)));
  process.stdout.write(promptFor());

  for await (const line of rl) {
    const parsed = parseCommand(line, HUMAN);
    if (parsed.kind === 'meta') {
      if (parsed.meta === 'quit') break;
      if (parsed.meta === 'board') console.log(renderView(viewFor(s, HUMAN)));
      if (parsed.meta === 'help') console.log('commands: move a2 a3 | setup preset balanced | setup random | done | resign | board | quit');
    } else if (parsed.kind === 'error') {
      console.log(parsed.message);
    } else {
      let action = parsed.action;
      if (action.type === 'SETUP_RANDOM') action = { ...action, order: rng.shuffle(rosterPieceIds(HUMAN)) };
      s = apply(s, action);
      // Let the bot take its turn(s) in response.
      while (s.phase === 'PLAY' && s.turn === BOT) {
        s = apply(s, heuristicBot(viewFor(s, BOT), rng));
      }
      if (s.phase !== 'GAME_OVER') console.log(renderView(viewFor(s, HUMAN)));
    }
    if (s.phase === 'GAME_OVER') break;
    process.stdout.write(promptFor());
  }
  console.log('Game over.');
  rl.close();
}

main();
