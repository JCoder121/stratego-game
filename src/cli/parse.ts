import { fromAlg } from '../engine/board.js';
import type { Action, Color } from '../engine/types.js';

type Parsed =
  | { kind: 'action'; action: Action }
  | { kind: 'meta'; meta: 'help' | 'board' | 'quit' }
  | { kind: 'error'; message: string };

export function parseCommand(input: string, viewer: Color): Parsed {
  const parts = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [cmd, ...rest] = parts;
  if (!cmd) return { kind: 'error', message: 'empty command' };

  switch (cmd) {
    case 'help': return { kind: 'meta', meta: 'help' };
    case 'board': return { kind: 'meta', meta: 'board' };
    case 'quit': case 'exit': return { kind: 'meta', meta: 'quit' };
    case 'done': return { kind: 'action', action: { type: 'SETUP_DONE', color: viewer } };
    case 'resign': return { kind: 'action', action: { type: 'RESIGN', color: viewer } };
    case 'move': {
      if (rest.length !== 2) return { kind: 'error', message: 'usage: move <from> <to>' };
      const from = fromAlg(rest[0]!);
      const to = fromAlg(rest[1]!);
      if (!from || !to) return { kind: 'error', message: 'bad square (use a1..j10)' };
      return { kind: 'action', action: { type: 'MOVE', color: viewer, from, to } };
    }
    case 'setup': {
      if (rest[0] === 'preset' && rest[1]) {
        return { kind: 'action', action: { type: 'SETUP_PRESET', color: viewer, preset: rest[1] } };
      }
      if (rest[0] === 'random') {
        // main.ts fills in the shuffled order; signal via preset sentinel handled there.
        return { kind: 'action', action: { type: 'SETUP_RANDOM', color: viewer, order: [] } };
      }
      return { kind: 'error', message: 'usage: setup preset <name> | setup random' };
    }
    default:
      return { kind: 'error', message: `unknown command: ${cmd}` };
  }
}
