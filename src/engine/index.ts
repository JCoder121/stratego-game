export * from './types.js';
export { createGame, rosterPieceIds, pieceAt, piecesOf } from './init.js';
export { strategoReduce } from './reduce.js';
export { validateAction } from './validate.js';
export { destinationsFor, legalMovesForColor } from './moves.js';
export { viewFor, type PlayerView, type VisiblePiece } from './redact.js';
export { setupSquares, presetNames, presetPlacement, randomPlacement, isSetupComplete } from './setups.js';
export { resolveCombat, type CombatOutcome } from './combat.js';
export { rankValue, isMovable, isScout, PIECE_DEFS } from './pieceDefs.js';
export { hasAnyLegalAction, movablePieceCount, violatesTwoSquare } from './rules.js';

export const ENGINE_VERSION = '0.1.0';
