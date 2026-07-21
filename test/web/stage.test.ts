import { describe, expect, it } from 'vitest';
import { rosterPieceIds, SETUP_ROWS, type PieceId, type Square } from '../../src/engine/index.js';
import {
  applyPreset,
  applyRandom,
  clearStage,
  isComplete,
  newStage,
  pieceAtSquare,
  place,
  rankOf,
  toPlacement,
  unplaced,
  type Stage,
} from '../../src/web/board/stage.js';

const RED_SQ_A: Square = { r: 6, c: 0 };
const RED_SQ_B: Square = { r: 6, c: 1 };
const RED_SQ_C: Square = { r: 9, c: 9 };
const BLUE_SQ_A: Square = { r: 0, c: 0 };

function redIds(): PieceId[] {
  return rosterPieceIds('RED');
}

describe('newStage', () => {
  it('starts empty for the given color', () => {
    const stage = newStage('RED');
    expect(stage.color).toBe('RED');
    expect(stage.placed.size).toBe(0);
  });
});

describe('unplaced', () => {
  it('returns the full roster in roster order when nothing is placed', () => {
    const stage = newStage('RED');
    expect(unplaced(stage)).toEqual(redIds());
  });

  it('excludes pieces that have been placed', () => {
    const id = redIds()[0]!;
    let stage = newStage('RED');
    stage = place(stage, id, RED_SQ_A);
    expect(unplaced(stage)).not.toContain(id);
    expect(unplaced(stage)).toHaveLength(39);
  });
});

describe('pieceAtSquare', () => {
  it('is null for an empty square', () => {
    const stage = newStage('RED');
    expect(pieceAtSquare(stage, RED_SQ_A)).toBeNull();
  });

  it('finds the piece placed at a square', () => {
    const id = redIds()[0]!;
    const stage = place(newStage('RED'), id, RED_SQ_A);
    expect(pieceAtSquare(stage, RED_SQ_A)).toBe(id);
  });
});

describe('place', () => {
  it('places a piece from the tray onto an empty square', () => {
    const id = redIds()[0]!;
    const stage = place(newStage('RED'), id, RED_SQ_A);
    expect(stage.placed.get(id)).toEqual(RED_SQ_A);
    expect(unplaced(stage)).not.toContain(id);
  });

  it('moves an already-placed piece to a new empty square', () => {
    const id = redIds()[0]!;
    let stage = place(newStage('RED'), id, RED_SQ_A);
    stage = place(stage, id, RED_SQ_B);
    expect(stage.placed.get(id)).toEqual(RED_SQ_B);
    expect(pieceAtSquare(stage, RED_SQ_A)).toBeNull();
    expect(stage.placed.size).toBe(1);
  });

  it('swaps two placed pieces when placing a placed piece onto another placed piece', () => {
    const [idA, idB] = redIds();
    let stage = newStage('RED');
    stage = place(stage, idA!, RED_SQ_A);
    stage = place(stage, idB!, RED_SQ_B);
    stage = place(stage, idA!, RED_SQ_B); // idA takes idB's square
    expect(stage.placed.get(idA!)).toEqual(RED_SQ_B);
    expect(stage.placed.get(idB!)).toEqual(RED_SQ_A); // idB bounced back to idA's old square
    expect(stage.placed.size).toBe(2);
  });

  it('placing a tray piece onto an occupied square sends the target back to the tray', () => {
    const [idA, idB] = redIds();
    let stage = newStage('RED');
    stage = place(stage, idA!, RED_SQ_A);
    stage = place(stage, idB!, RED_SQ_A); // idB from tray onto idA's square
    expect(stage.placed.get(idB!)).toEqual(RED_SQ_A);
    expect(stage.placed.has(idA!)).toBe(false);
    expect(unplaced(stage)).toContain(idA);
    expect(stage.placed.size).toBe(1);
  });

  it('accepts every square in the color setup rows', () => {
    const id = redIds()[0]!;
    for (const r of SETUP_ROWS.RED) {
      for (let c = 0; c < 10; c++) {
        const stage = place(newStage('RED'), id, { r, c });
        expect(stage.placed.get(id)).toEqual({ r, c });
      }
    }
  });

  it('rejects squares outside the color own setup rows', () => {
    const id = redIds()[0]!;
    const stage = place(newStage('RED'), id, BLUE_SQ_A);
    expect(stage.placed.size).toBe(0);
    expect(pieceAtSquare(stage, BLUE_SQ_A)).toBeNull();
  });

  it('rejects a square in the opposite color setup rows even mid-board-adjacent', () => {
    const id = redIds()[0]!;
    const stage = place(newStage('RED'), id, { r: 3, c: 5 });
    expect(stage.placed.size).toBe(0);
  });

  it('rejects out-of-board rows and columns rather than throwing', () => {
    const id = redIds()[0]!;
    for (const sq of [{ r: -1, c: 0 }, { r: 10, c: 0 }, { r: 6, c: -1 }, { r: 6, c: 10 }]) {
      const stage = place(newStage('RED'), id, sq);
      expect(stage.placed.size).toBe(0);
      expect(pieceAtSquare(stage, sq)).toBeNull();
    }
  });

  it('is a no-op placing an already-placed piece back onto its own square', () => {
    const id = redIds()[0]!;
    let stage = place(newStage('RED'), id, RED_SQ_A);
    stage = place(stage, id, RED_SQ_A);
    expect(stage.placed.get(id)).toEqual(RED_SQ_A);
    expect(stage.placed.size).toBe(1);
  });
});

describe('clearStage', () => {
  it('empties all placements but keeps the color', () => {
    let stage = applyPreset(newStage('RED'), 'balanced')!;
    stage = clearStage(stage);
    expect(stage.color).toBe('RED');
    expect(stage.placed.size).toBe(0);
    expect(unplaced(stage)).toEqual(redIds());
  });
});

describe('applyPreset', () => {
  it('fills all 40 pieces and completes the stage', () => {
    const stage = applyPreset(newStage('RED'), 'balanced');
    expect(stage.placed.size).toBe(40);
    expect(isComplete(stage)).toBe(true);
  });

  it('every placed square is within the color own setup rows', () => {
    const stage = applyPreset(newStage('BLUE'), 'bombs-back');
    for (const sq of stage.placed.values()) {
      expect(SETUP_ROWS.BLUE).toContain(sq.r);
    }
  });

  it('leaves the stage unchanged for an unknown preset name', () => {
    const stage = applyPreset(newStage('RED'), 'not-a-real-preset');
    expect(stage.placed.size).toBe(0);
  });
});

describe('applyRandom', () => {
  it('fills all 40 pieces', () => {
    const stage = applyRandom(newStage('RED'));
    expect(stage.placed.size).toBe(40);
    expect(isComplete(stage)).toBe(true);
    expect(unplaced(stage)).toHaveLength(0);
  });

  it('every placed square is within the color own setup rows and distinct', () => {
    const stage = applyRandom(newStage('BLUE'));
    const keys = new Set<string>();
    for (const sq of stage.placed.values()) {
      expect(SETUP_ROWS.BLUE).toContain(sq.r);
      keys.add(`${sq.r},${sq.c}`);
    }
    expect(keys.size).toBe(40);
  });
});

describe('isComplete', () => {
  it('false when empty or partially placed, true at 40', () => {
    let stage = newStage('RED');
    expect(isComplete(stage)).toBe(false);
    stage = place(stage, redIds()[0]!, RED_SQ_A);
    expect(isComplete(stage)).toBe(false);
    stage = applyRandom(stage);
    expect(isComplete(stage)).toBe(true);
  });
});

describe('toPlacement', () => {
  it('has length 40 once complete and round-trips placed squares', () => {
    const stage = applyPreset(newStage('RED'), 'balanced');
    const placement = toPlacement(stage);
    expect(placement).toHaveLength(40);
    const asMap = new Map(placement);
    for (const id of redIds()) {
      expect(asMap.get(id)).toEqual(stage.placed.get(id));
    }
  });

  it('reflects partial staging too', () => {
    const stage = place(newStage('RED'), redIds()[0]!, RED_SQ_C);
    expect(toPlacement(stage)).toEqual([[redIds()[0], RED_SQ_C]]);
  });
});

describe('rankOf', () => {
  it('parses the rank out of a roster piece id', () => {
    expect(rankOf('RED-MARSHAL-0')).toBe('MARSHAL');
    expect(rankOf('BLUE-SCOUT-7')).toBe('SCOUT');
    expect(rankOf('RED-BOMB-5')).toBe('BOMB');
  });

  it('agrees with rosterPieceIds for every piece of both colors', () => {
    for (const color of ['RED', 'BLUE'] as const) {
      for (const id of rosterPieceIds(color)) {
        const rank = rankOf(id);
        expect(id).toBe(`${color}-${rank}-${id.split('-')[2]}`);
      }
    }
  });
});

describe('Stage type shape', () => {
  it('placed is a real Map, not a plain object', () => {
    const stage: Stage = newStage('RED');
    expect(stage.placed instanceof Map).toBe(true);
  });
});
