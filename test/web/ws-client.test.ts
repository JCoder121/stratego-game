import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, connect, loadSession, nextDelay, saveSession } from '../../src/web/net/ws-client.js';
import type { SocketLike } from '../../src/web/net/ws-client.js';
import type { ClientMsg } from '../../src/server/protocol.js';

/** Fake socket: records everything sent, and lets tests fire lifecycle events on demand. */
class FakeSocket implements SocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  private listeners = new Map<string, ((ev: { data?: unknown }) => void)[]>();

  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  triggerOpen(): void {
    this.readyState = 1; // OPEN — real sockets are already OPEN when 'open' fires
    for (const fn of this.listeners.get('open') ?? []) fn({});
  }

  get sentMsgs(): ClientMsg[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMsg);
  }
}

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

  it('returns null when the stored role is not RED/BLUE/SPECTATOR', () => {
    sessionStorage.setItem('stratego.session', JSON.stringify({ code: 'ABCDE', token: 'tok-1', role: 'ADMIN' }));
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

describe('connect() outbound queue', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeFakeStorage());
  });

  it('queues sends made before open, flushing REJOIN first then the backlog in order', () => {
    saveSession('ABCDE', 'tok-1', 'RED');
    const socket = new FakeSocket();
    const net = connect('ws://fake/ws', () => socket);

    net.send({ t: 'JOIN_ROOM', code: 'ZZZZZ' });
    net.send({ t: 'REMATCH_REQUEST' });
    expect(socket.sent).toEqual([]); // nothing sent while socket isn't open yet

    socket.triggerOpen();

    expect(socket.sentMsgs).toEqual([
      { t: 'REJOIN', code: 'ABCDE', token: 'tok-1' },
      { t: 'JOIN_ROOM', code: 'ZZZZZ' },
      { t: 'REMATCH_REQUEST' },
    ]);
  });

  it('sends immediately once open, with no queueing', () => {
    const socket = new FakeSocket();
    const net = connect('ws://fake/ws', () => socket);
    socket.triggerOpen();

    net.send({ t: 'JOIN_ROOM', code: 'AAAAA' });

    expect(socket.sentMsgs).toEqual([{ t: 'JOIN_ROOM', code: 'AAAAA' }]);
  });

  it('caps the pre-open queue at 20, dropping the oldest', () => {
    const socket = new FakeSocket();
    const net = connect('ws://fake/ws', () => socket);

    for (let i = 0; i < 25; i++) net.send({ t: 'JOIN_ROOM', code: `Q${i}` });
    socket.triggerOpen();

    const codes = socket.sentMsgs.map((m) => (m as { code: string }).code);
    expect(codes).toHaveLength(20);
    expect(codes[0]).toBe('Q5'); // the oldest 5 (Q0..Q4) were dropped
    expect(codes[19]).toBe('Q24');
  });
});
