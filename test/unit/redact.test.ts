import { describe, expect, test } from 'vitest';
import { viewFor } from '../../src/engine/redact.js';
import { createGame } from '../../src/engine/init.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
  }
  s.phase = 'PLAY';
  return s;
}

describe('viewFor', () => {
  test('own ranks visible, enemy unrevealed ranks hidden', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const ownFlag = view.pieces.find((p) => p.id === 'RED-FLAG-0')!;
    expect(ownFlag.rank).toBe('FLAG');
    const enemy = view.pieces.find((p) => p.owner === 'BLUE')!;
    expect(enemy.rank).toBeNull();
    expect(enemy.pos).toBeDefined();
  });
  test('revealed enemy rank becomes visible', () => {
    const s = playState();
    s.pieces['BLUE-MARSHAL-0']!.revealed = true;
    const view = viewFor(s, 'RED');
    const revealed = view.pieces.find((p) => p.id === 'BLUE-MARSHAL-0')!;
    expect(revealed.rank).toBe('MARSHAL');
  });
  test('captured pieces are omitted', () => {
    const s = playState();
    s.pieces['BLUE-SCOUT-0']!.pos = null;
    const view = viewFor(s, 'RED');
    expect(view.pieces.find((p) => p.id === 'BLUE-SCOUT-0')).toBeUndefined();
  });
});
