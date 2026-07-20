import { describe, expect, test } from 'vitest';
import { createGame, strategoReduce, viewFor, validateAction, legalMovesForColor } from '../../src/engine/index.js';

describe('engine barrel', () => {
  test('exposes the public API', () => {
    expect(typeof createGame).toBe('function');
    expect(typeof strategoReduce).toBe('function');
    expect(typeof viewFor).toBe('function');
    expect(typeof validateAction).toBe('function');
    expect(typeof legalMovesForColor).toBe('function');
  });
});
