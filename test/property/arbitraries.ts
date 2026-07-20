import fc from 'fast-check';
import type { Action, Square } from '../../src/engine/types.js';

const sq: fc.Arbitrary<Square> = fc.record({
  r: fc.integer({ min: -2, max: 11 }),
  c: fc.integer({ min: -2, max: 11 }),
});

// Deliberately includes illegal colors/ids/squares to exercise reject paths.
export const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant('MOVE' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
    from: sq, to: sq,
  }),
  fc.record({
    type: fc.constant('SETUP_PLACE' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
    pieceId: fc.constantFrom('RED-FLAG-0', 'BLUE-SCOUT-3', 'GHOST-1'),
    to: sq,
  }),
  fc.record({
    type: fc.constant('RESIGN' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
  }),
);
