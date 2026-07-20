import { sameSquare } from './board.js';
import { pieceAt } from './init.js';
import { destinationsFor } from './moves.js';
import { rosterPieceIds } from './init.js';
import { isMovable } from './pieceDefs.js';
import { setupSquares, isSetupComplete } from './setups.js';
import { violatesTwoSquare } from './rules.js';
import { SETUP_ROWS, type Action, type GameState, type Square } from './types.js';

function isSetupSquare(color: GameState['turn'], sq: Square): boolean {
  return SETUP_ROWS[color].includes(sq.r) && sq.c >= 0 && sq.c < 10;
}

export function validateAction(state: GameState, action: Action): string | null {
  if (state.phase === 'GAME_OVER') return 'game is over';

  if (action.type === 'SETUP_PLACE' || action.type === 'SETUP_PRESET' ||
      action.type === 'SETUP_RANDOM' || action.type === 'SETUP_DONE') {
    if (state.phase !== 'SETUP') return 'not in setup phase';
  }
  if (action.type === 'MOVE' || action.type === 'RESIGN') {
    if (state.phase !== 'PLAY') return 'not in play phase';
    if (action.color !== state.turn) return `it is ${state.turn}'s turn`;
  }

  switch (action.type) {
    case 'RESIGN':
      return null;

    case 'SETUP_DONE':
      if (!isSetupComplete(state, action.color)) return 'setup is incomplete';
      return null;

    case 'SETUP_PRESET':
      return null; // preset name validated in reducer (unknown → REJECTED there)

    case 'SETUP_RANDOM': {
      const expected = rosterPieceIds(action.color).sort();
      const got = [...action.order].sort();
      if (expected.length !== got.length || expected.some((id, i) => id !== got[i])) {
        return 'order is not a permutation of the roster';
      }
      return null;
    }

    case 'SETUP_PLACE': {
      const p = state.pieces[action.pieceId];
      if (!p) return 'no such piece';
      if (p.owner !== action.color) return 'piece belongs to the other player';
      if (!isSetupSquare(action.color, action.to)) return 'square is outside your setup rows';
      const occupant = pieceAt(state, action.to);
      if (occupant) return 'square is already occupied';
      return null;
    }

    case 'MOVE': {
      const p = pieceAt(state, action.from);
      if (!p) return 'no piece on the from square';
      if (p.owner !== action.color) return 'not your piece';
      if (!isMovable(p.rank)) return 'that piece cannot move';
      const legal = destinationsFor(state, p.id).some((d) => sameSquare(d, action.to));
      if (!legal) return 'illegal destination';
      if (violatesTwoSquare(state, p.id, action.from, action.to)) return 'two-square rule violation';
      return null;
    }
  }
}
