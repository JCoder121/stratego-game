import { BOARD_SIZE, type Color, type Rank, type Square } from '../../engine/index.js';
import { boardSquare, isLakeCell } from './geometry.js';
import { RANK_GLYPH } from './glyphs.js';

export interface BoardCallbacks {
  onSquareClick(sq: Square): void;
}

export interface BoardPiece {
  owner: Color;
  pos: Square;
  rank: Rank | null; // null ⇒ hidden enemy
  revealed: boolean;
}

export interface BoardProps {
  pieces: BoardPiece[]; // PlayerView.pieces or WatchView.pieces
  viewer: Color; // orientation (spectator ⇒ 'RED')
  selected?: Square | null;
  highlights?: Square[]; // legal destinations
  lastMove?: { from: Square; to: Square } | null;
}

// Re-exported for existing importers (e.g. screens/setup.ts) — the table itself now lives in
// glyphs.ts so screens/game.ts and store-update.ts can use it without pulling in this
// DOM-rendering module.
export { RANK_GLYPH };

function keyOf(sq: Square): string {
  return `${sq.r},${sq.c}`;
}

// renderBoard is called on every store update and always clears+rebuilds root's children (see
// below), but `root` itself is reused across calls — a plain addEventListener on every call would
// stack a new delegated listener each re-render. Keep one listener per root for its lifetime, and
// have it read the *current* viewer/callback out of this WeakMap instead of a stale closure.
const rootState = new WeakMap<HTMLElement, { viewer: Color; cb: BoardCallbacks }>();

/**
 * Render a 10x10 board of buttons into `root`. Idempotent — always clears and rebuilds, which
 * keeps this simple at the small scale of a Stratego board (100 cells) rather than diffing.
 */
export function renderBoard(root: HTMLElement, props: BoardProps, cb: BoardCallbacks): void {
  const { pieces, viewer } = props;
  const selectedKey = props.selected ? keyOf(props.selected) : null;
  const highlightKeys = new Set((props.highlights ?? []).map(keyOf));
  const lastFromKey = props.lastMove ? keyOf(props.lastMove.from) : null;
  const lastToKey = props.lastMove ? keyOf(props.lastMove.to) : null;

  const byKey = new Map<string, BoardPiece>();
  for (const p of pieces) byKey.set(keyOf(p.pos), p);

  root.textContent = '';
  root.classList.add('board');

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const sq = boardSquare(row, col, viewer);
      const key = keyOf(sq);

      const cellEl = document.createElement('button');
      cellEl.type = 'button';
      cellEl.className = 'cell';
      cellEl.dataset.r = String(row);
      cellEl.dataset.c = String(col);

      if (isLakeCell(row, col, viewer)) cellEl.classList.add('lake');
      if (selectedKey === key) cellEl.classList.add('selected');
      if (highlightKeys.has(key)) cellEl.classList.add('highlight');
      if (lastFromKey === key) cellEl.classList.add('last-from');
      if (lastToKey === key) cellEl.classList.add('last-to');

      const piece = byKey.get(key);
      if (piece) {
        cellEl.appendChild(renderPieceTile(piece));
      }

      root.appendChild(cellEl);
    }
  }

  // One delegated listener for the life of `root` (see rootState comment above) instead of one
  // per cell — cheap, and survives the clear-and-rebuild idempotent re-render.
  const alreadyWired = rootState.has(root);
  rootState.set(root, { viewer, cb });
  if (!alreadyWired) {
    root.addEventListener('click', (ev) => {
      const state = rootState.get(root);
      if (!state) return;
      const target = ev.target as HTMLElement | null;
      const cellEl = target?.closest<HTMLElement>('.cell');
      if (!cellEl || !root.contains(cellEl)) return;
      const row = Number(cellEl.dataset.r);
      const col = Number(cellEl.dataset.c);
      state.cb.onSquareClick(boardSquare(row, col, state.viewer));
    });
  }
}

function renderPieceTile(piece: BoardPiece): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'piece';
  tile.classList.add(piece.owner === 'RED' ? 'red' : 'blue');

  const known = piece.rank !== null;
  if (known) {
    tile.classList.add('known');
    if (piece.revealed) tile.classList.add('revealed');
    const glyph = document.createElement('span');
    glyph.className = 'rank-glyph';
    glyph.textContent = RANK_GLYPH[piece.rank as Rank];
    tile.appendChild(glyph);
  } else {
    tile.classList.add('hidden-back');
  }

  return tile;
}
