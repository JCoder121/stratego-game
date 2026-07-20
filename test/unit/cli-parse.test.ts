import { describe, expect, test } from 'vitest';
import { parseCommand } from '../../src/cli/parse.js';

describe('parseCommand', () => {
  test('parses a move in algebraic notation', () => {
    const r = parseCommand('move a2 a3', 'RED');
    expect(r).toEqual({ kind: 'action', action: { type: 'MOVE', color: 'RED', from: { r: 8, c: 0 }, to: { r: 7, c: 0 } } });
  });
  test('parses setup preset', () => {
    const r = parseCommand('setup preset balanced', 'RED');
    expect(r).toEqual({ kind: 'action', action: { type: 'SETUP_PRESET', color: 'RED', preset: 'balanced' } });
  });
  test('parses done and resign and meta', () => {
    expect(parseCommand('done', 'BLUE')).toEqual({ kind: 'action', action: { type: 'SETUP_DONE', color: 'BLUE' } });
    expect(parseCommand('resign', 'RED')).toEqual({ kind: 'action', action: { type: 'RESIGN', color: 'RED' } });
    expect(parseCommand('help', 'RED')).toEqual({ kind: 'meta', meta: 'help' });
  });
  test('bad input → error', () => {
    expect(parseCommand('move zz9 a2', 'RED').kind).toBe('error');
    expect(parseCommand('flibble', 'RED').kind).toBe('error');
  });
});
