import type { Rng } from '../rng/rng.js';
import { makeRoomCode } from './codes.js';

export const IDLE_MS = 2 * 60 * 60 * 1000; // 2h
export const EMPTY_MS = 5 * 60 * 1000; // 5min

interface Entry<R> {
  room: R;
  lastActivity: number;
  emptySince: number | null;
}

export class RoomRegistry<R> {
  private readonly rooms = new Map<string, Entry<R>>();
  private readonly now: () => number;
  private readonly rng: Rng;

  constructor(deps: { now: () => number; rng: Rng }) {
    this.now = deps.now;
    this.rng = deps.rng;
  }

  create(room: R): string {
    let code: string;
    do {
      code = makeRoomCode(this.rng);
    } while (this.rooms.has(code));
    this.rooms.set(code, { room, lastActivity: this.now(), emptySince: null });
    return code;
  }

  get(code: string): R | undefined {
    const entry = this.rooms.get(code.toUpperCase());
    if (!entry) return undefined;
    entry.lastActivity = this.now();
    return entry.room;
  }

  touch(code: string): void {
    const entry = this.rooms.get(code.toUpperCase());
    if (!entry) return;
    entry.lastActivity = this.now();
  }

  delete(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  markEmpty(code: string): void {
    const entry = this.rooms.get(code.toUpperCase());
    if (!entry) return;
    if (entry.emptySince === null) entry.emptySince = this.now();
  }

  markOccupied(code: string): void {
    const entry = this.rooms.get(code.toUpperCase());
    if (!entry) return;
    entry.emptySince = null;
  }

  sweep(): string[] {
    const now = this.now();
    const expired: string[] = [];
    for (const [code, entry] of this.rooms) {
      const idleExpired = now - entry.lastActivity > IDLE_MS;
      const emptyExpired = entry.emptySince !== null && now - entry.emptySince > EMPTY_MS;
      if (idleExpired || emptyExpired) expired.push(code);
    }
    for (const code of expired) this.rooms.delete(code);
    return expired;
  }
}
