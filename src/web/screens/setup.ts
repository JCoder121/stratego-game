// Setup screen (Task 9) — thin DOM/event layer over the pure staging model in board/stage.ts.
// Nothing here decides placement legality or swap semantics; every mutation goes through
// place()/applyPreset()/applyRandom()/clearStage() and the resulting Stage is written back onto
// the store, then this module redraws itself. The only network call is the final Ready ⇒
// COMMIT_SETUP — everything before that is local staging (see stage.ts's header comment).
import type { Store } from '../main.js';
import {
  presetNames,
  RANKS,
  ROSTER,
  SETUP_ROWS,
  type Color,
  type PieceId,
  type Rank,
  type Square,
} from '../../engine/index.js';
import { boardSquare } from '../board/geometry.js';
import { RANK_GLYPH, renderBoard, type BoardPiece } from '../board/render.js';
import {
  applyPreset,
  applyRandom,
  clearStage,
  isComplete,
  pieceAtSquare,
  place,
  rankOf,
  toPlacement,
  unplaced,
  type Stage,
} from '../board/stage.js';

// Tap-tap selection is pure UI state (which piece is "picked up", waiting for a destination tap).
// It has to survive re-renders triggered by unrelated store updates (e.g. the opponent's
// SETUP_STATUS ping arriving mid-selection) but must reset whenever a fresh staging session
// begins — main.ts bumps store.setupGen every time it rebuilds store.stage (initial entry into
// SETUP, and again on every rematch). Module-level state is the only place to park this, since
// render() always redraws `root` from scratch (same destructive-rebuild pattern as lobby.ts).
let selectedPieceId: PieceId | null = null;
let selectedGen = -1;

const DRAG_RANK_PREFIX = 'rank:';
const DRAG_PIECE_PREFIX = 'piece:';

export function render(root: HTMLElement, store: Store): void {
  const stage = store.stage;
  if (!stage) return; // main.ts only routes here once a fresh stage exists

  if (store.setupGen !== selectedGen) {
    selectedPieceId = null;
    selectedGen = store.setupGen;
  }

  const locked = store.setupLocked;
  const ownRows = new Set(SETUP_ROWS[stage.color]);

  root.textContent = '';

  const heading = document.createElement('h1');
  heading.textContent = 'Set up your pieces';
  root.appendChild(heading);

  const layout = document.createElement('div');
  layout.className = 'setup-layout';
  root.appendChild(layout);

  // ---- Board ----
  const boardCol = document.createElement('div');
  boardCol.className = 'setup-board-col';
  layout.appendChild(boardCol);

  const boardRoot = document.createElement('div');
  boardCol.appendChild(boardRoot);

  const pieces: BoardPiece[] = toPlacement(stage).map(([id, sq]) => ({
    owner: stage.color,
    pos: sq,
    rank: rankOf(id),
    revealed: false,
  }));

  renderBoard(
    boardRoot,
    {
      pieces,
      viewer: stage.color,
      selected: selectedPieceId ? stage.placed.get(selectedPieceId) ?? null : null,
    },
    {
      onSquareClick(sq: Square) {
        if (locked || !ownRows.has(sq.r)) return;
        if (selectedPieceId) {
          const id = selectedPieceId;
          selectedPieceId = null;
          mutate(store, root, place(stage, id, sq));
          return;
        }
        const occupant = pieceAtSquare(stage, sq);
        if (occupant) {
          selectedPieceId = occupant;
          render(root, store);
        }
      },
    },
  );

  decorateBoardCells(boardRoot, store, root, stage, ownRows, locked);

  const statusLine = document.createElement('p');
  statusLine.className = 'hint setup-opponent-status';
  statusLine.textContent = opponentStatusText(store, stage.color);
  boardCol.appendChild(statusLine);

  if (store.setupError) {
    const err = document.createElement('p');
    err.className = 'setup-error';
    err.textContent = store.setupError;
    boardCol.appendChild(err);
  }

  // ---- Tray + controls ----
  const trayCol = document.createElement('div');
  trayCol.className = 'setup-tray-col';
  layout.appendChild(trayCol);

  const trayHeading = document.createElement('h2');
  trayHeading.textContent = 'Pieces';
  trayCol.appendChild(trayHeading);

  const tray = document.createElement('div');
  tray.className = 'setup-tray';
  trayCol.appendChild(tray);

  const remainingByRank = new Map<Rank, PieceId[]>();
  for (const id of unplaced(stage)) {
    const rank = rankOf(id);
    const bucket = remainingByRank.get(rank);
    if (bucket) bucket.push(id);
    else remainingByRank.set(rank, [id]);
  }
  for (const rank of RANKS) {
    const ids = remainingByRank.get(rank) ?? [];
    tray.appendChild(renderTrayTile(rank, ids, ROSTER[rank], locked, stage.color, store, root, stage));
  }

  const controls = document.createElement('div');
  controls.className = 'setup-controls';
  trayCol.appendChild(controls);

  const presetSelect = document.createElement('select');
  presetSelect.name = 'setup-preset';
  presetSelect.disabled = locked;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Preset…';
  placeholder.disabled = true;
  placeholder.selected = true;
  presetSelect.appendChild(placeholder);
  for (const name of presetNames()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    presetSelect.appendChild(opt);
  }
  presetSelect.addEventListener('change', () => {
    if (!presetSelect.value) return;
    selectedPieceId = null;
    mutate(store, root, applyPreset(stage, presetSelect.value));
  });
  controls.appendChild(presetSelect);

  controls.appendChild(
    actionButton('Random', locked, () => {
      selectedPieceId = null;
      mutate(store, root, applyRandom(stage));
    }),
  );

  controls.appendChild(
    actionButton('Clear', locked, () => {
      selectedPieceId = null;
      mutate(store, root, clearStage(stage));
    }),
  );

  const readyBtn = actionButton('Ready', locked || !isComplete(stage), () => {
    store.setupLocked = true;
    store.setupError = null;
    store.net.send({ t: 'COMMIT_SETUP', placement: toPlacement(stage) });
    render(root, store);
  });
  readyBtn.classList.add('setup-ready');
  controls.appendChild(readyBtn);
}

/** Writes the newly-staged state back onto the store (single source of truth — see main.ts's
 *  store note) and redraws. There's no server round trip for local staging moves, so this screen
 *  has to trigger its own re-render instead of waiting on a net.onMsg callback. */
function mutate(store: Store, root: HTMLElement, next: Stage): void {
  store.stage = next;
  render(root, store);
}

function actionButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function rankLabel(rank: Rank): string {
  return rank.charAt(0) + rank.slice(1).toLowerCase();
}

function renderTrayTile(
  rank: Rank,
  ids: PieceId[],
  total: number,
  locked: boolean,
  color: Color,
  store: Store,
  root: HTMLElement,
  stage: Stage,
): HTMLButtonElement {
  const representative = ids[0] ?? null;
  const usable = representative !== null && !locked;

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tray-tile';
  tile.classList.add(color === 'RED' ? 'red' : 'blue');
  tile.disabled = !usable;
  tile.draggable = usable;
  if (representative !== null && selectedPieceId === representative) tile.classList.add('selected');

  const glyph = document.createElement('span');
  glyph.className = 'rank-glyph';
  glyph.textContent = RANK_GLYPH[rank];
  tile.appendChild(glyph);

  const label = document.createElement('span');
  label.className = 'tray-tile-label';
  label.textContent = rankLabel(rank);
  tile.appendChild(label);

  const countEl = document.createElement('span');
  countEl.className = 'tray-tile-count';
  countEl.textContent = `${ids.length}/${total}`;
  tile.appendChild(countEl);

  if (usable && representative !== null) {
    tile.addEventListener('click', () => {
      selectedPieceId = representative;
      render(root, store);
    });
    tile.addEventListener('dragstart', (ev: DragEvent) => {
      ev.dataTransfer?.setData('text/plain', `${DRAG_RANK_PREFIX}${rank}`);
    });
  }

  return tile;
}

/** Single pass over the rendered board cells: dims/disables squares outside the color's own
 *  setup rows, and wires HTML5 drag/drop on the interactive own-row squares — both the tray→board
 *  drop target and (for already-placed pieces) board→board dragstart, all funneled through the
 *  same place() call tap-tap uses. */
function decorateBoardCells(
  boardRoot: HTMLElement,
  store: Store,
  root: HTMLElement,
  stage: Stage,
  ownRows: Set<number>,
  locked: boolean,
): void {
  boardRoot.querySelectorAll<HTMLElement>('.cell').forEach((cellEl) => {
    const row = Number(cellEl.dataset.r);
    const col = Number(cellEl.dataset.c);
    const sq = boardSquare(row, col, stage.color);

    if (!ownRows.has(sq.r)) {
      cellEl.classList.add('setup-dim');
      return;
    }

    cellEl.addEventListener('dragover', (ev: DragEvent) => {
      if (locked) return;
      ev.preventDefault();
    });
    cellEl.addEventListener('drop', (ev: DragEvent) => {
      if (locked) return;
      ev.preventDefault();
      const data = ev.dataTransfer?.getData('text/plain') ?? '';
      const id = resolveDragPayload(data, stage);
      if (!id) return;
      selectedPieceId = null;
      mutate(store, root, place(stage, id, sq));
    });

    const occupant = pieceAtSquare(stage, sq);
    if (occupant && !locked) {
      cellEl.draggable = true;
      cellEl.addEventListener('dragstart', (ev: DragEvent) => {
        ev.dataTransfer?.setData('text/plain', `${DRAG_PIECE_PREFIX}${occupant}`);
      });
    }
  });
}

function resolveDragPayload(data: string, stage: Stage): PieceId | null {
  if (data.startsWith(DRAG_PIECE_PREFIX)) {
    const id = data.slice(DRAG_PIECE_PREFIX.length);
    return stage.placed.has(id) ? id : null;
  }
  if (data.startsWith(DRAG_RANK_PREFIX)) {
    const rank = data.slice(DRAG_RANK_PREFIX.length);
    return unplaced(stage).find((pid) => rankOf(pid) === rank) ?? null;
  }
  return null;
}

function opponentStatusText(store: Store, own: Color): string {
  const opponent: Color = own === 'RED' ? 'BLUE' : 'RED';
  const label = opponent === 'RED' ? 'Red' : 'Blue';
  const ready = store.setupStatus?.[opponent] ?? false;
  if (store.setupLocked) {
    return ready ? `${label} is also ready — starting…` : `Waiting for ${label} to finish setup…`;
  }
  return ready ? `${label} is ready.` : `${label} is still placing pieces…`;
}
