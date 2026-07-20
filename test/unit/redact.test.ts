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
    // Enemy pieces are exposed under their rank-free viewId, never the real id.
    const revealed = view.pieces.find((p) => p.owner === 'BLUE' && p.revealed)!;
    expect(revealed.rank).toBe('MARSHAL');
    expect(revealed.id).toBe(s.pieces['BLUE-MARSHAL-0']!.viewId);
    expect(revealed.id).not.toBe('BLUE-MARSHAL-0');
  });
  test('captured pieces are omitted', () => {
    const s = playState();
    s.pieces['BLUE-SCOUT-0']!.pos = null;
    const view = viewFor(s, 'RED');
    expect(view.pieces.find((p) => p.id === 'BLUE-SCOUT-0')).toBeUndefined();
  });

  test('myRecentMoves exposes only the viewer\'s own piece history, never enemy history', () => {
    const s = playState();
    const redRec = [
      { pieceId: 'RED-SCOUT-0', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } },
      { pieceId: 'RED-SCOUT-0', from: { r: 5, c: 0 }, to: { r: 6, c: 0 } },
    ];
    const blueRec = [
      { pieceId: 'BLUE-SCOUT-0', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } },
    ];
    s.recentMoves['RED-SCOUT-0'] = redRec;
    s.recentMoves['BLUE-SCOUT-0'] = blueRec;

    const redView = viewFor(s, 'RED');
    expect(redView.myRecentMoves['RED-SCOUT-0']).toEqual(redRec);
    expect(redView.myRecentMoves['BLUE-SCOUT-0']).toBeUndefined();

    const blueView = viewFor(s, 'BLUE');
    expect(blueView.myRecentMoves['BLUE-SCOUT-0']).toEqual(blueRec);
    expect(blueView.myRecentMoves['RED-SCOUT-0']).toBeUndefined();
  });
});
