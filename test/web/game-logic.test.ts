import { describe, expect, it } from 'vitest';
import type { PlayerView, VisiblePiece } from '../../src/engine/redact.js';
import type { Color, Square } from '../../src/engine/index.js';
import { destinationsFrom } from '../../src/web/game-logic.js';

function piece(id: string, owner: Color, pos: Square, rank: VisiblePiece['rank']): VisiblePiece {
  return { id, owner, pos, rank, revealed: false };
}

function view(pieces: VisiblePiece[]): PlayerView {
  return { viewer: 'RED', phase: 'PLAY', turn: 'RED', plyCount: 0, pieces, result: null, myRecentMoves: {} };
}

function sortSquares(squares: Square[]): string[] {
  return squares.map((s) => `${s.r},${s.c}`).sort();
}

describe('destinationsFrom', () => {
  it('plain piece: adjacency in all 4 directions; own piece blocks that direction; enemy piece is a legal (attack) destination', () => {
    const v = view([
      piece('R-SERGEANT-1', 'RED', { r: 6, c: 4 }, 'SERGEANT'),
      piece('R-MINER-1', 'RED', { r: 6, c: 3 }, 'MINER'), // west neighbor — own, blocks that direction entirely
      piece('B-x', 'BLUE', { r: 6, c: 5 }, null), // east neighbor — hidden enemy, attackable
    ]);
    const dest = destinationsFrom(v, { r: 6, c: 4 });
    expect(sortSquares(dest)).toEqual(
      sortSquares([
        { r: 5, c: 4 }, // north — empty
        { r: 7, c: 4 }, // south — empty
        { r: 6, c: 5 }, // east — enemy, attack
        // west omitted — own piece blocks
      ]),
    );
  });

  it('scout: slides until the first piece (inclusive, attack) or the board edge; a lake blocks immediately; an own piece blocks immediately', () => {
    const v = view([
      piece('R-SCOUT-1', 'RED', { r: 6, c: 2 }, 'SCOUT'),
      piece('R-MINER-1', 'RED', { r: 6, c: 3 }, 'MINER'), // east neighbor — own, blocks that whole direction
      piece('B-x', 'BLUE', { r: 6, c: 0 }, null), // two squares west — enemy; scout may slide onto it
    ]);
    const dest = destinationsFrom(v, { r: 6, c: 2 });
    expect(sortSquares(dest)).toEqual(
      sortSquares([
        // south — clear run to the board edge
        { r: 7, c: 2 },
        { r: 8, c: 2 },
        { r: 9, c: 2 },
        // west — slides through the empty square, stops on (and can attack) the enemy
        { r: 6, c: 1 },
        { r: 6, c: 0 },
        // north omitted — {r:5,c:2} is a lake square, blocks immediately
        // east omitted — {r:6,c:3} is the own MINER, blocks immediately
      ]),
    );
  });

  it('BOMB and FLAG have no legal moves even when fully surrounded by empty squares', () => {
    const v = view([
      piece('R-BOMB-1', 'RED', { r: 6, c: 4 }, 'BOMB'),
      piece('R-FLAG-1', 'RED', { r: 8, c: 4 }, 'FLAG'),
    ]);
    expect(destinationsFrom(v, { r: 6, c: 4 })).toEqual([]);
    expect(destinationsFrom(v, { r: 8, c: 4 })).toEqual([]);
  });

  it('returns [] for a square with no piece on it', () => {
    const v = view([piece('R-SCOUT-1', 'RED', { r: 6, c: 2 }, 'SCOUT')]);
    expect(destinationsFrom(v, { r: 0, c: 0 })).toEqual([]);
  });
});
