import { describe, expect, test } from 'vitest';
import { resolveCombat } from '../../src/engine/combat.js';
import { rankValue } from '../../src/engine/pieceDefs.js';

describe('rankValue ordering', () => {
  test('marshal outranks general outranks scout', () => {
    expect(rankValue('MARSHAL')).toBeGreaterThan(rankValue('GENERAL'));
    expect(rankValue('GENERAL')).toBeGreaterThan(rankValue('SCOUT'));
  });
});

describe('resolveCombat', () => {
  test('higher rank wins as attacker or defender', () => {
    expect(resolveCombat('MARSHAL', 'GENERAL')).toBe('ATTACKER');
    expect(resolveCombat('GENERAL', 'MARSHAL')).toBe('DEFENDER');
  });
  test('equal movable ranks: both removed', () => {
    expect(resolveCombat('CAPTAIN', 'CAPTAIN')).toBe('BOTH');
  });
  test('spy attacks marshal and wins', () => {
    expect(resolveCombat('SPY', 'MARSHAL')).toBe('ATTACKER');
  });
  test('marshal attacks spy and wins', () => {
    expect(resolveCombat('MARSHAL', 'SPY')).toBe('ATTACKER');
  });
  test('spy loses to any non-marshal it attacks', () => {
    expect(resolveCombat('SPY', 'GENERAL')).toBe('DEFENDER');
    expect(resolveCombat('SPY', 'SCOUT')).toBe('DEFENDER');
  });
  test('miner defuses bomb', () => {
    expect(resolveCombat('MINER', 'BOMB')).toBe('ATTACKER');
  });
  test('non-miner dies to bomb, bomb survives', () => {
    expect(resolveCombat('MARSHAL', 'BOMB')).toBe('DEFENDER');
    expect(resolveCombat('SCOUT', 'BOMB')).toBe('DEFENDER');
    expect(resolveCombat('SPY', 'BOMB')).toBe('DEFENDER');
  });
  test('attacking the flag always wins', () => {
    expect(resolveCombat('SCOUT', 'FLAG')).toBe('ATTACKER');
    expect(resolveCombat('SPY', 'FLAG')).toBe('ATTACKER');
  });
});
