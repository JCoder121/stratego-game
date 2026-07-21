import { describe, expect, it } from 'vitest';
import { isClientMsg } from '../../src/server/protocol.js';
import { CODE_ALPHABET, makeRoomCode } from '../../src/server/codes.js';
import { makeSeeded } from '../../src/rng/rng.js';

describe('codes', () => {
  it('makes 5-char codes from the unambiguous alphabet', () => {
    const code = makeRoomCode(makeSeeded(42));
    expect(code).toHaveLength(5);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });
  it('alphabet excludes 0/O/1/I', () => {
    for (const ch of '0O1I') expect(CODE_ALPHABET).not.toContain(ch);
  });
});

describe('isClientMsg', () => {
  it('accepts valid messages', () => {
    expect(isClientMsg({ t: 'JOIN_ROOM', code: 'K3PXQ' })).toBe(true);
    expect(isClientMsg({ t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 1 })).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isClientMsg(null)).toBe(false);
    expect(isClientMsg({ t: 'NOPE' })).toBe(false);
    expect(isClientMsg({ t: 'JOIN_ROOM' })).toBe(false);
  });
});
