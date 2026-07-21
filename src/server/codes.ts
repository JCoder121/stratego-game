import type { Rng } from '../rng/rng.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeRoomCode(rng: Rng): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)];
  return out;
}
