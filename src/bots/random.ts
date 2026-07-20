import type { Bot } from './types.js';
import { legalMovesFromView } from './moves-from-view.js';

export const randomBot: Bot = (view, rng) => {
  const moves = legalMovesFromView(view);
  if (moves.length === 0) return { type: 'RESIGN', color: view.viewer };
  const m = moves[rng.int(moves.length)]!;
  return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
};

// Re-export so tests can import a single random module surface.
export { legalMovesFromView };
