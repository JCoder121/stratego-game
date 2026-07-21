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
    expect(isClientMsg({ t: 'ACTION', action: { type: 'MOVE', color: 'RED', from: { r: 0, c: 0 }, to: { r: 1, c: 0 } }, seq: 2 })).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isClientMsg(null)).toBe(false);
    expect(isClientMsg({ t: 'NOPE' })).toBe(false);
    expect(isClientMsg({ t: 'JOIN_ROOM' })).toBe(false);
  });
  it('rejects ACTION with setup actions', () => {
    expect(isClientMsg({ t: 'ACTION', action: { type: 'SETUP_DONE', color: 'RED' }, seq: 1 })).toBe(false);
    expect(isClientMsg({ t: 'ACTION', action: { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-SCOUT-1', to: { r: 0, c: 0 } }, seq: 1 })).toBe(false);
  });

  describe('COMMIT_SETUP placement guard', () => {
    it('rejects malformed placement shapes (regression: a bare number element used to crash commitSetup\'s destructure)', () => {
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [5] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [null] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [{}] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [['id', { r: 'x', c: 0 }]] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [['id', { r: 0 }]] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [['id', { r: 0, c: NaN }]] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [['id', { r: 0, c: Infinity }]] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [[1, { r: 0, c: 0 }]] })).toBe(false);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: 'nope' })).toBe(false);
    });

    it('accepts valid placement tuples, including the empty array', () => {
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [] })).toBe(true);
      expect(isClientMsg({ t: 'COMMIT_SETUP', placement: [['RED-SCOUT-1', { r: 6, c: 0 }]] })).toBe(true);
      expect(isClientMsg({
        t: 'COMMIT_SETUP',
        placement: [['RED-SCOUT-1', { r: 6, c: 0 }], ['RED-SCOUT-2', { r: 6, c: 1 }]],
      })).toBe(true);
    });
  });

  describe('CREATE_ROOM literal validation', () => {
    it('accepts valid modes/bot kinds/watch speeds', () => {
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' })).toBe(true);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_BOT', botDifficulty: 'random' })).toBe(true);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_BOT', botDifficulty: 'heuristic' })).toBe(true);
      expect(isClientMsg({
        t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', bots: { RED: 'random', BLUE: 'heuristic' }, watchSpeed: 500,
      })).toBe(true);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', watchSpeed: 1000 })).toBe(true);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', watchSpeed: 'step' })).toBe(true);
    });

    it('rejects unknown mode', () => {
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_ALIEN' })).toBe(false);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 123 })).toBe(false);
    });

    it('rejects unknown botDifficulty', () => {
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_BOT', botDifficulty: 'godlike' })).toBe(false);
    });

    it('rejects unknown bots.RED / bots.BLUE', () => {
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', bots: { RED: 'godlike', BLUE: 'random' } })).toBe(false);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', bots: { RED: 'random', BLUE: 'godlike' } })).toBe(false);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', bots: 'random' })).toBe(false);
    });

    it('rejects unknown watchSpeed', () => {
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', watchSpeed: 750 })).toBe(false);
      expect(isClientMsg({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', watchSpeed: 'fast' })).toBe(false);
    });
  });

  describe('WATCH_CONTROL literal validation', () => {
    it('accepts valid controls and speeds', () => {
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'play' })).toBe(true);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'pause' })).toBe(true);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'step' })).toBe(true);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'speed', speed: 500 })).toBe(true);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'speed', speed: 1000 })).toBe(true);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'speed' })).toBe(true);
    });

    it('rejects unknown control', () => {
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'rewind' })).toBe(false);
    });

    it('rejects unknown/step speed on WATCH_CONTROL (unlike CREATE_ROOM.watchSpeed, "step" is not a valid WATCH_CONTROL speed)', () => {
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'speed', speed: 750 })).toBe(false);
      expect(isClientMsg({ t: 'WATCH_CONTROL', control: 'speed', speed: 'step' })).toBe(false);
    });
  });
});
