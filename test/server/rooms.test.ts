import { describe, expect, it } from 'vitest';
import { EMPTY_MS, IDLE_MS, RoomRegistry } from '../../src/server/rooms.js';
import { makeSeeded } from '../../src/rng/rng.js';
import type { Rng } from '../../src/rng/rng.js';

/** Deterministic rng that yields ints from a fixed queue (mod n), for forcing code collisions. */
function queuedRng(queue: number[]): Rng {
  let i = 0;
  const next = () => {
    if (i >= queue.length) throw new Error('queuedRng exhausted');
    return queue[i++]!;
  };
  return {
    next: () => next() / 100,
    int: (n) => next() % n,
    shuffle: (items) => items.slice(),
  };
}

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RoomRegistry', () => {
  it('create/get roundtrip', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<{ name: string }>({ now: clock.now, rng: makeSeeded(1) });
    const room = { name: 'alpha' };
    const code = reg.create(room);
    expect(typeof code).toBe('string');
    expect(reg.get(code)).toBe(room);
  });

  it('generates unique codes over 100 creates', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<number>({ now: clock.now, rng: makeSeeded(7) });
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(reg.create(i));
    expect(codes.size).toBe(100);
  });

  it('retries on collision until an unused code is found', () => {
    const clock = makeClock();
    // CODE_ALPHABET[0] = 'A', CODE_ALPHABET[1] = 'B' (index mod alphabet length 32).
    // First create consumes 5 ints -> 'AAAAA'.
    // Second create: first attempt also 'AAAAA' (collision, must retry), second attempt -> 'AAAAB'.
    const rng = queuedRng([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const reg = new RoomRegistry<string>({ now: clock.now, rng });
    const first = reg.create('room-1');
    const second = reg.create('room-2');
    expect(first).toBe('AAAAA');
    expect(second).toBe('AAAAB');
    expect(reg.get(first)).toBe('room-1');
    expect(reg.get(second)).toBe('room-2');
  });

  it('get is case-insensitive', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(2) });
    const code = reg.create('room');
    expect(reg.get(code.toLowerCase())).toBe('room');
    expect(reg.get(code.toUpperCase())).toBe('room');
  });

  it('get() refreshes last-activity, protecting against idle sweep', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(3) });
    const code = reg.create('room');
    clock.advance(IDLE_MS - 100);
    reg.get(code); // refresh activity
    clock.advance(200); // now IDLE_MS+100 since creation, but only 200ms since the get()
    expect(reg.sweep()).toEqual([]);
    expect(reg.get(code)).toBe('room');
  });

  it('sweep removes rooms idle past IDLE_MS but keeps touched ones', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(4) });
    const codeA = reg.create('active');
    const codeB = reg.create('idle');
    clock.advance(1000);
    reg.touch(codeA);
    clock.advance(IDLE_MS - 500); // total elapsed since creation: IDLE_MS + 500
    // codeA: idle since touch = IDLE_MS - 500 (not swept); codeB: idle since creation = IDLE_MS + 500 (swept)
    const swept = reg.sweep();
    expect(swept).toEqual([codeB]);
    expect(reg.get(codeA)).toBe('active');
    expect(reg.get(codeB)).toBeUndefined();
  });

  it('markEmpty + EMPTY_MS elapsed -> swept even though not idle-expired', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(5) });
    const code = reg.create('room');
    reg.markEmpty(code);
    clock.advance(EMPTY_MS + 1);
    expect(EMPTY_MS + 1).toBeLessThan(IDLE_MS); // sanity: not idle-expired
    expect(reg.sweep()).toEqual([code]);
    expect(reg.get(code)).toBeUndefined();
  });

  it('markOccupied cancels a pending empty sweep', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(6) });
    const code = reg.create('room');
    reg.markEmpty(code);
    reg.markOccupied(code);
    clock.advance(EMPTY_MS + 1);
    expect(reg.sweep()).toEqual([]);
    expect(reg.get(code)).toBe('room');
  });

  it('delete removes a room', () => {
    const clock = makeClock();
    const reg = new RoomRegistry<string>({ now: clock.now, rng: makeSeeded(8) });
    const code = reg.create('room');
    reg.delete(code);
    expect(reg.get(code)).toBeUndefined();
  });
});
