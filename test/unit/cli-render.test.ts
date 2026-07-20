import { describe, expect, test } from 'vitest';
import { renderView } from '../../src/cli/render.js';
import { createGame, viewFor } from '../../src/engine/index.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

describe('renderView', () => {
  test('renders a 10-row grid with lakes and hides enemy ranks', () => {
    const s: GameState = createGame();
    for (const color of ['RED', 'BLUE'] as const) {
      const placement = presetPlacement(color, 'balanced')!;
      for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    }
    s.phase = 'PLAY';
    const out = renderView(viewFor(s, 'RED'));
    const lines = out.trimEnd().split('\n');
    // at least 10 grid rows present
    const gridRows = lines.filter((l) => /[.?~A-Z]/.test(l));
    expect(gridRows.length).toBeGreaterThanOrEqual(10);
    expect(out).toContain('~'); // lakes rendered
    expect(out).toContain('?'); // hidden enemy pieces
  });
});
