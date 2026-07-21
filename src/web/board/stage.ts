// Pure client-staging model for the setup screen (Task 9). All setup logic — placement, swap
// semantics, presets, randomization, completion — lives here so screens/setup.ts stays a thin
// DOM/event layer over this. Nothing here touches the DOM or the network; a Stage is only
// committed to the server as a single COMMIT_SETUP once the player hits Ready (see toPlacement).
import {
  BOARD_SIZE,
  presetPlacement,
  randomPlacement,
  rosterPieceIds,
  SETUP_ROWS,
  type Color,
  type PieceId,
  type Rank,
  type Square,
} from '../../engine/index.js';

export interface Stage {
  color: Color;
  placed: Map<PieceId, Square>;
}

export function newStage(color: Color): Stage {
  return { color, placed: new Map() };
}

/** Unplaced roster ids, in roster order (rosterPieceIds' high-rank-first ordering). */
export function unplaced(stage: Stage): PieceId[] {
  return rosterPieceIds(stage.color).filter((id) => !stage.placed.has(id));
}

export function pieceAtSquare(stage: Stage, sq: Square): PieceId | null {
  for (const [id, at] of stage.placed) {
    if (at.r === sq.r && at.c === sq.c) return id;
  }
  return null;
}

function inOwnSetupRows(stage: Stage, sq: Square): boolean {
  if (sq.c < 0 || sq.c >= BOARD_SIZE) return false;
  return SETUP_ROWS[stage.color].includes(sq.r);
}

/**
 * Places `pieceId` at `sq`. Squares outside the color's own setup rows are rejected (returns
 * `stage` unchanged — screens are expected to also dim/disable those squares, but this stays
 * safe regardless of what the UI lets through, e.g. a stray drop event).
 *
 * Swap semantics when `sq` is already occupied by a *different* own piece:
 *  - if `pieceId` was already placed elsewhere, the two pieces trade squares;
 *  - if `pieceId` was still in the tray, the occupant is bumped back to the tray and `pieceId`
 *    takes its square.
 */
export function place(stage: Stage, pieceId: PieceId, sq: Square): Stage {
  if (!inOwnSetupRows(stage, sq)) return stage;

  const sourceSq = stage.placed.get(pieceId) ?? null;
  const targetId = pieceAtSquare(stage, sq);

  const placed = new Map(stage.placed);
  if (targetId !== null && targetId !== pieceId) {
    if (sourceSq !== null) {
      placed.set(targetId, sourceSq);
    } else {
      placed.delete(targetId);
    }
  }
  placed.set(pieceId, sq);
  return { color: stage.color, placed };
}

export function clearStage(stage: Stage): Stage {
  return { color: stage.color, placed: new Map() };
}

/** Unknown preset name ⇒ stage unchanged (defensive; screen only ever offers presetNames()). */
export function applyPreset(stage: Stage, name: string): Stage {
  const map = presetPlacement(stage.color, name);
  if (!map) return stage;
  return { color: stage.color, placed: new Map(Object.entries(map)) };
}

/** Shuffles the roster with Math.random and positionally assigns it via the engine's
 *  randomPlacement — mirrors what a server-side SETUP_RANDOM action would do, but resolved
 *  entirely client-side since nothing is sent to the server until Ready. */
export function applyRandom(stage: Stage): Stage {
  const order = [...rosterPieceIds(stage.color)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const map = randomPlacement(stage.color, order);
  return { color: stage.color, placed: new Map(Object.entries(map)) };
}

export function isComplete(stage: Stage): boolean {
  return stage.placed.size === rosterPieceIds(stage.color).length;
}

export function toPlacement(stage: Stage): [PieceId, Square][] {
  return Array.from(stage.placed.entries());
}

/** Parses the rank out of the `${color}-${RANK}-${index}` id format (see engine/init.ts). */
export function rankOf(pieceId: PieceId): Rank {
  const parts = pieceId.split('-');
  return parts[1] as Rank;
}
