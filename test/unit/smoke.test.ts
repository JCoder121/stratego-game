import { describe, expect, test } from 'vitest';
import { ENGINE_VERSION } from '../../src/engine/index.js';

describe('scaffold', () => {
  test('engine barrel exports a version', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
