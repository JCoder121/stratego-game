// Pure play-screen logic (Task 10) — kept DOM-free so it's directly unit-testable (see
// test/web/game-logic.test.ts) without a browser.
import { legalMovesFromView } from '../bots/moves-from-view.js';
import type { PlayerView, Square } from '../engine/index.js';

/**
 * Legal destinations for the viewer's own piece at `from`, as seen from `view`. Thin filter over
 * `legalMovesFromView` — which already encodes adjacency, scout sliding (stopping at the first
 * occupied/lake/out-of-bounds square, inclusive of an enemy-occupied stop square), immovable
 * BOMB/FLAG, and the two-square repetition rule — so screens/game.ts only ever has to compute
 * highlights for the one currently-selected square.
 */
export function destinationsFrom(view: PlayerView, from: Square): Square[] {
  return legalMovesFromView(view)
    .filter((m) => m.from.r === from.r && m.from.c === from.c)
    .map((m) => m.to);
}
