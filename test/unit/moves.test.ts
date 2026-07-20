import { describe, expect, test } from 'vitest';
import { createGame } from '../../src/engine/init.js';
import { destinationsFor } from '../../src/engine/moves.js';
import type { GameState, Square } from '../../src/engine/types.js';

// helper: place a piece by id onto a square in a mutable clone
function place(s: GameState, id: string, sq: Square): GameState {
  const c = JSON.parse(JSON.stringify(s)) as GameState;
  c.pieces[id]!.pos = sq;
  c.phase = 'PLAY';
  return c;
}

describe('destinationsFor', () => {
  test('marshal moves one square orthogonally into empty squares', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 5, c: 5 });
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).toContainEqual({ r: 4, c: 5 });
    expect(dests).toContainEqual({ r: 6, c: 5 });
    expect(dests).toContainEqual({ r: 5, c: 4 });
    expect(dests).toContainEqual({ r: 5, c: 6 });
    expect(dests).toHaveLength(4);
  });
  test('cannot move onto a lake', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 3, c: 2 }); // just above lake (4,2)
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).not.toContainEqual({ r: 4, c: 2 });
  });
  test('cannot move onto a friendly piece; can move onto an enemy', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 5, c: 5 });
    s = place(s, 'RED-SCOUT-0', { r: 5, c: 6 });   // friendly right
    s = place(s, 'BLUE-SCOUT-0', { r: 5, c: 4 });  // enemy left
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).not.toContainEqual({ r: 5, c: 6 });
    expect(dests).toContainEqual({ r: 5, c: 4 });
  });
  test('bomb and flag never move', () => {
    let s = createGame();
    s = place(s, 'RED-BOMB-0', { r: 5, c: 5 });
    s = place(s, 'RED-FLAG-0', { r: 9, c: 0 });
    expect(destinationsFor(s, 'RED-BOMB-0')).toEqual([]);
    expect(destinationsFor(s, 'RED-FLAG-0')).toEqual([]);
  });
  test('scout slides multiple empty squares and stops on first enemy', () => {
    let s = createGame();
    s = place(s, 'RED-SCOUT-0', { r: 9, c: 0 });
    s = place(s, 'BLUE-SCOUT-0', { r: 9, c: 4 }); // enemy 4 to the right
    const dests = destinationsFor(s, 'RED-SCOUT-0');
    expect(dests).toContainEqual({ r: 9, c: 1 });
    expect(dests).toContainEqual({ r: 9, c: 3 });
    expect(dests).toContainEqual({ r: 9, c: 4 }); // can attack enemy
    expect(dests).not.toContainEqual({ r: 9, c: 5 }); // blocked beyond enemy
  });
  test('scout cannot pass through a lake', () => {
    let s = createGame();
    s = place(s, 'RED-SCOUT-0', { r: 4, c: 0 }); // row 4 has lakes at c2,c3
    const dests = destinationsFor(s, 'RED-SCOUT-0');
    expect(dests).toContainEqual({ r: 4, c: 1 });
    expect(dests).not.toContainEqual({ r: 4, c: 4 }); // beyond lake, unreachable this row
  });
});
