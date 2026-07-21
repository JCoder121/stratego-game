// End-to-end smoke test (Task 12) against the real server (playwright.config.ts's `webServer`
// runs `npm run serve` — the actual build + ws server, no mocking). Two scenarios:
//   A) friend game: two browser contexts play a room to a resignation and both see the result.
//   B) vs-bot Easy: solo human vs a random bot, confirms the bot actually replies.
//
// Selectors are kept resilient to preset/roster internals on purpose — rather than hardcoding
// "the front-row scout is at column N" (which depends on rosterPieceIds ordering, an
// implementation detail of src/engine/setups.ts), `makeLegalMove` below just tries each of the
// mover's own pieces in board order until one produces a highlighted destination, then takes it.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const ARTIFACTS_DIR = 'e2e/artifacts';
mkdirSync(ARTIFACTS_DIR, { recursive: true });

// ---- Shared helpers -----------------------------------------------------------------------

/** Lobby buttons are disabled until the ws connection is open (see screens/lobby.ts) — every
 *  flow starts by waiting for that instead of a fixed sleep. */
async function gotoLobby(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-action="create-friend"]')).toBeEnabled();
}

async function createFriendGame(page: Page): Promise<void> {
  await gotoLobby(page);
  await page.locator('[data-action="create-friend"]').click();
  await expect(page.getByRole('heading', { name: 'Set up your pieces' })).toBeVisible();
}

async function createBotGame(page: Page, difficulty: 'random' | 'heuristic'): Promise<void> {
  await gotoLobby(page);
  await page.locator(`input[name="bot-difficulty"][value="${difficulty}"]`).check();
  await page.locator('[data-action="create-bot"]').click();
  await expect(page.getByRole('heading', { name: 'Set up your pieces' })).toBeVisible();
}

async function joinGame(page: Page, code: string): Promise<void> {
  await gotoLobby(page);
  await page.locator('input[name="join-code"]').fill(code);
  await page.locator('[data-action="join"]').click();
  await expect(page.getByRole('heading', { name: 'Set up your pieces' })).toBeVisible();
}

/** Reads the room code the host's setup screen displays (see screens/setup.ts's
 *  `data-testid="room-code"` line, added for exactly this — the code never appears anywhere
 *  else in the DOM, since the room placeholder that also shows it is always skipped by the time
 *  a seated player reaches the setup screen). */
async function readRoomCode(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="room-code"]').innerText();
  const match = text.match(/Room code:\s*([A-Z0-9]{5})/);
  if (!match) throw new Error(`could not parse room code from "${text}"`);
  return match[1]!;
}

/** Picks the "balanced" preset (instantly legal/complete — see engine/setups.ts) and clicks
 *  Ready, then waits for the board (game or watch screen) to appear. */
async function presetAndReady(page: Page): Promise<void> {
  await page.locator('select[name="setup-preset"]').selectOption('balanced');
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
}

async function waitForPlay(page: Page): Promise<void> {
  await expect(page.locator('.board .cell')).toHaveCount(100);
  await expect(page.locator('.turn-banner')).toBeVisible();
}

/** Tries each of `ownClass`'s own pieces (in board order) until one has a legal destination
 *  (`.cell.highlight`), then plays it. Throws if no own piece has a legal move, which would
 *  itself indicate a real bug (an active player with zero legal moves should already be
 *  GAME_OVER via NO_MOVES) rather than a flaky test. */
async function makeLegalMove(page: Page, ownClass: 'red' | 'blue'): Promise<void> {
  const ownPieceCells = page.locator(`.cell:has(.piece.${ownClass})`);
  const count = await ownPieceCells.count();
  for (let i = 0; i < count; i++) {
    await ownPieceCells.nth(i).click();
    const highlights = page.locator('.cell.highlight');
    if ((await highlights.count()) > 0) {
      await highlights.first().click();
      return;
    }
  }
  throw new Error(`no legal move found for any .piece.${ownClass} on board`);
}

async function resign(page: Page): Promise<void> {
  await page.locator('.resign-btn').click();
  await page.locator('.resign-confirm-yes').click();
}

async function closeAll(...contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((c) => c.close()));
}

// ---- Test A: friend game end to end -----------------------------------------------------------

test('friend game: create, join, play a move, resign, both see the result', async ({ browser }) => {
  const redCtx = await browser.newContext();
  const blueCtx = await browser.newContext();
  try {
    const red = await redCtx.newPage();
    const blue = await blueCtx.newPage();

    await createFriendGame(red);
    const code = await readRoomCode(red);
    expect(code).toMatch(/^[A-Z0-9]{5}$/);

    await joinGame(blue, code);

    await presetAndReady(red);
    await presetAndReady(blue);

    await waitForPlay(red);
    await waitForPlay(blue);
    // RED moves first (engine default) — confirm before acting so a future engine change that
    // flips the starting side fails loudly here instead of producing a confusing NOT_YOUR_TURN.
    await expect(red.locator('.turn-banner')).toHaveText('Your move');
    await expect(blue.locator('.turn-banner')).toHaveText("Opponent's move");

    // No move has landed yet — sanity-check the lastMove highlight classes start absent.
    await expect(red.locator('.cell.last-to')).toHaveCount(0);

    await makeLegalMove(red, 'red');

    // BLUE sees RED's move land (same VIEW broadcast both players get) — the highlighted
    // destination classes are the shared, viewer-orientation-safe signal for "a move just
    // happened" that both screens/game.ts and screens/watch.ts render from.
    await expect(blue.locator('.cell.last-to')).toHaveCount(1);
    await expect(red.locator('.cell.last-to')).toHaveCount(1);
    await expect(blue.locator('.turn-banner')).toHaveText('Your move');

    await resign(red);

    await expect(red.locator('.result-banner')).toHaveText('Blue wins — Resignation');
    await expect(blue.locator('.result-banner')).toHaveText('Blue wins — Resignation');

    await red.locator('.board').screenshot({ path: `${ARTIFACTS_DIR}/friend-game-red-board.png` });
    await blue.locator('.board').screenshot({ path: `${ARTIFACTS_DIR}/friend-game-blue-board.png` });
  } finally {
    await closeAll(redCtx, blueCtx);
  }
});

// ---- Test B: vs-bot Easy, confirm the bot actually replies -------------------------------------

test('vs-bot Easy: human move gets a bot reply', async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();

    await createBotGame(page, 'random');
    await presetAndReady(page);
    await waitForPlay(page);
    await expect(page.locator('.turn-banner')).toHaveText('Your move');

    await makeLegalMove(page, 'red');
    await expect(page.locator('.move-log-list li')).toHaveCount(1);

    // Server pumps the bot's reply ~BOT_DELAY_MS (500ms) after the human's move lands — poll the
    // move log rather than sleeping a fixed amount.
    await expect(page.locator('.move-log-list li')).toHaveCount(2, { timeout: 5_000 });
    await expect(page.locator('.turn-banner')).toHaveText('Your move');

    await page.locator('.board').screenshot({ path: `${ARTIFACTS_DIR}/vs-bot-board.png` });
  } finally {
    await ctx.close();
  }
});
