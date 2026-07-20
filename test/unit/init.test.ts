import { describe, expect, test } from 'vitest';
import { createGame, rosterPieceIds, pieceAt, piecesOf } from '../../src/engine/init.js';
import { ROSTER } from '../../src/engine/types.js';

describe('createGame', () => {
  test('starts in SETUP with RED to move and 80 pieces off-board', () => {
    const s = createGame();
    expect(s.phase).toBe('SETUP');
    expect(s.turn).toBe('RED');
    expect(Object.keys(s.pieces)).toHaveLength(80);
    expect(Object.values(s.pieces).every((p) => p.pos === null)).toBe(true);
    expect(s.result).toBeNull();
    expect(s.config.maxPlies).toBe(2000);
  });
  test('roster ids: 40 per color, counts match ROSTER', () => {
    const ids = rosterPieceIds('RED');
    expect(ids).toHaveLength(40);
    const s = createGame();
    const flags = piecesOf(s, 'RED').filter((p) => p.rank === 'FLAG');
    expect(flags).toHaveLength(ROSTER.FLAG);
    const scouts = piecesOf(s, 'RED').filter((p) => p.rank === 'SCOUT');
    expect(scouts).toHaveLength(ROSTER.SCOUT);
  });
  test('state is JSON-serializable (round-trips)', () => {
    const s = createGame();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  test('pieceAt returns null on empty board', () => {
    const s = createGame();
    expect(pieceAt(s, { r: 0, c: 0 })).toBeNull();
  });
});
