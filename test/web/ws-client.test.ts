import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, loadSession, nextDelay, saveSession } from '../../src/web/net/ws-client.js';

/** Map-backed Storage stub — just enough of the interface for these tests. */
function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('session helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeFakeStorage());
  });

  it('roundtrips save/load', () => {
    saveSession('ABCDE', 'tok-1', 'RED');
    expect(loadSession()).toEqual({ code: 'ABCDE', token: 'tok-1', role: 'RED' });
  });

  it('returns null when nothing is saved', () => {
    expect(loadSession()).toBeNull();
  });

  it('clears a saved session', () => {
    saveSession('ABCDE', 'tok-1', 'SPECTATOR');
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('returns null on malformed stored JSON', () => {
    sessionStorage.setItem('stratego.session', '{not json');
    expect(loadSession()).toBeNull();
  });
});

describe('nextDelay', () => {
  it('backs off 1s -> 5s then caps at 5s', () => {
    expect(nextDelay(1)).toBe(1000);
    expect(nextDelay(2)).toBe(2000);
    expect(nextDelay(3)).toBe(3000);
    expect(nextDelay(4)).toBe(4000);
    expect(nextDelay(5)).toBe(5000);
    expect(nextDelay(6)).toBe(5000);
  });
});
