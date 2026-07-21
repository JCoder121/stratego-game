// Dev-only scratch screen — no storybook here, so this is the manual visual check for Task 8's
// board renderer. Never linked from the lobby; only reachable by typing #/dev-board, and only
// wired up when import.meta.env.DEV is true (see main.ts).
import type { Square } from '../../engine/index.js';
import type { BoardPiece } from '../board/render.js';
import { renderBoard } from '../board/render.js';

const SAMPLE_PIECES: BoardPiece[] = [
  // RED — a mix of own known ranks plus one revealed-in-combat piece.
  { owner: 'RED', pos: { r: 9, c: 0 }, rank: 'MARSHAL', revealed: false },
  { owner: 'RED', pos: { r: 9, c: 1 }, rank: 'SPY', revealed: false },
  { owner: 'RED', pos: { r: 8, c: 0 }, rank: 'BOMB', revealed: false },
  { owner: 'RED', pos: { r: 6, c: 4 }, rank: 'SCOUT', revealed: false },
  { owner: 'RED', pos: { r: 5, c: 4 }, rank: 'MINER', revealed: true },
  { owner: 'RED', pos: { r: 9, c: 9 }, rank: 'FLAG', revealed: false },

  // BLUE — from RED's viewpoint most are hidden (rank: null); one is revealed from combat.
  { owner: 'BLUE', pos: { r: 0, c: 0 }, rank: null, revealed: false },
  { owner: 'BLUE', pos: { r: 0, c: 1 }, rank: null, revealed: false },
  { owner: 'BLUE', pos: { r: 1, c: 4 }, rank: 'GENERAL', revealed: true },
  { owner: 'BLUE', pos: { r: 3, c: 6 }, rank: null, revealed: false },
];

const SELECTED: Square = { r: 6, c: 4 };
const HIGHLIGHTS: Square[] = [
  { r: 5, c: 4 }, // occupied by own piece — still shown to exercise overlap with a piece tile
  { r: 4, c: 4 },
  { r: 6, c: 5 },
  { r: 6, c: 3 },
];
const LAST_MOVE = { from: { r: 1, c: 4 }, to: { r: 3, c: 6 } };

export function render(root: HTMLElement): void {
  root.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'Board dev scratch';
  root.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Dev-only sanity check for Task 8 geometry/renderer — RED and BLUE orientation side by side, ' +
    'with selection/highlight/lastMove classes exercised. Click a cell to log its engine square.';
  root.appendChild(hint);

  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr 1fr';
  wrap.style.gap = '1.5rem';
  root.appendChild(wrap);

  for (const viewer of ['RED', 'BLUE'] as const) {
    const col = document.createElement('div');
    const label = document.createElement('h2');
    label.textContent = `viewer: ${viewer}`;
    col.appendChild(label);

    const boardRoot = document.createElement('div');
    col.appendChild(boardRoot);
    wrap.appendChild(col);

    renderBoard(
      boardRoot,
      {
        pieces: SAMPLE_PIECES,
        viewer,
        selected: SELECTED,
        highlights: HIGHLIGHTS,
        lastMove: LAST_MOVE,
      },
      {
        onSquareClick(sq: Square) {
          // eslint-disable-next-line no-console
          console.log(`[dev-board] ${viewer} clicked engine square`, sq);
        },
      },
    );
  }
}
