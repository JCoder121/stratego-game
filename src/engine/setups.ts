import { BOARD_SIZE, SETUP_ROWS, type Color, type GameState, type PieceId, type Square } from './types.js';
import { rosterPieceIds, piecesOf } from './init.js';

export function setupSquares(color: Color): Square[] {
  const rows = SETUP_ROWS[color];
  const out: Square[] = [];
  for (const r of rows) for (let c = 0; c < BOARD_SIZE; c++) out.push({ r, c });
  return out;
}

// Positional assignment: order[i] -> setupSquares[i].
function assignPositional(color: Color, order: PieceId[]): Record<PieceId, Square> {
  const squares = setupSquares(color);
  const map: Record<PieceId, Square> = {};
  order.forEach((id, i) => { map[id] = squares[i]!; });
  return map;
}

export function randomPlacement(color: Color, order: PieceId[]): Record<PieceId, Square> {
  return assignPositional(color, order);
}

// Presets are defined by an ordering of rosterPieceIds mapped positionally onto
// setupSquares (row-major from the front row toward the back row). rosterPieceIds
// returns ranks high→low then bombs then flag; setupSquares lists front→back, so
// the flag & bombs (end of roster) land on the back rows.
export function presetNames(): string[] {
  return ['balanced', 'bombs-back'];
}

export function presetPlacement(color: Color, name: string): Record<PieceId, Square> | null {
  const ids = rosterPieceIds(color); // high ranks first ... bombs, flag last
  if (name === 'balanced') {
    return assignPositional(color, ids);
  }
  if (name === 'bombs-back') {
    // Flag to the exact back corner, bombs adjacent; then the rest.
    const flag = ids.filter((i) => i.includes('-FLAG-'));
    const bombs = ids.filter((i) => i.includes('-BOMB-'));
    const rest = ids.filter((i) => !i.includes('-FLAG-') && !i.includes('-BOMB-'));
    // setupSquares is front→back; reverse so index 0 is the back row (flag first).
    const squares = setupSquares(color).slice().reverse();
    const order = [...flag, ...bombs, ...rest];
    const map: Record<PieceId, Square> = {};
    order.forEach((id, i) => { map[id] = squares[i]!; });
    return map;
  }
  return null;
}

export function isSetupComplete(state: GameState, color: Color): boolean {
  const pieces = piecesOf(state, color);
  if (pieces.some((p) => p.pos === null)) return false;
  const rows = new Set(SETUP_ROWS[color]);
  const seen = new Set<string>();
  for (const p of pieces) {
    const sq = p.pos!;
    if (!rows.has(sq.r)) return false;
    const key = `${sq.r},${sq.c}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
