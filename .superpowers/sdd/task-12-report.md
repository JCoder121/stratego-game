# Task 12: Playwright smoke test + README + final verification — Report

## Status
DONE (pending controller's out-of-sandbox `npm run test:e2e` run).

## Commit
- `15e594a` — `feat(web): e2e smoke test and web app docs`
- Files: `playwright.config.ts` (new), `e2e/smoke.spec.ts` (new), `README.md`, `package.json`,
  `package-lock.json`, `.gitignore`, `src/web/screens/setup.ts`.

## What was built

### 1. Real UI gap found and fixed: room code was never shown
Traced the render path for a friend-game host: `main.ts`'s `renderRoomPlaceholder` (the only place
that ever rendered `Room ${code}`) is skipped almost immediately — `ensureStage` builds a Stage and
routes straight to `screens/setup.ts` the moment `role` and `phase==='SETUP'` are both known, which
in practice is by the very next render after `ROOM_CREATED`. So a friend-game creator had **no way
to see the code to share** — not a test-only problem, a real product bug. Fixed by adding a
`data-testid="room-code"` line (`Room code: ABCDE`) to the top of `screens/setup.ts`'s render,
gated on `store.code` being set. This is both the fix and the e2e test's read point.

### 2. `playwright.config.ts`
`testDir: 'e2e'`, `webServer: { command: 'npm run serve', port: 3000, reuseExistingServer: false,
timeout: 120_000 }` (generous because `serve` runs a full `vite build` before listening),
`fullyParallel: false` (both specs share one server/room-code-generator instance), screenshots
on failure + `retain-on-failure` traces, single chromium project.

### 3. `e2e/smoke.spec.ts` — two tests
- **Friend game**: two isolated `browser.newContext()`s. RED creates, reads the room code via
  `data-testid="room-code"`, BLUE joins by code. Both select the `balanced` preset (instant
  legal/complete) and click Ready. Waits for the 100-cell board + turn banner. Confirms RED moves
  first (`'Your move'`/`"Opponent's move"`), asserts zero `.cell.last-to` before any move. RED
  plays a move via a **preset-order-independent** helper (`makeLegalMove`): tries each of RED's own
  piece cells in board order until one produces a `.cell.highlight`, then clicks it — avoids
  hardcoding roster/preset internals (`src/engine/setups.ts` roster ordering is an implementation
  detail, not something a UI test should depend on). Asserts BLUE's board reflects the move via
  `.cell.last-to` (viewer-orientation-safe, unlike raw square coordinates). RED resigns via the
  inline two-button confirm (never `window.confirm`, per `screens/game.ts`'s own comment). Both
  contexts assert `.result-banner` reads `"Blue wins — Resignation"`. Screenshots both `.board`
  elements to `e2e/artifacts/`.
- **Vs-bot Easy**: single context, creates a `random`-bot room, ready up, confirms `'Your move'`,
  plays one move, then polls `.move-log-list li` growing from 1 → 2 within 5s (BOT_DELAY_MS is
  500ms server-side) as proof the bot actually replied, and re-confirms `'Your move'` afterward.
  Screenshots the board.

All waits are Playwright web-first `expect(...).toHaveText/toHaveCount(...)` assertions with
timeouts — no fixed `sleep`s anywhere in the spec.

### 4. `package.json`
Added `"test:e2e": "playwright test"`. `@playwright/test` devDependency and `package-lock.json`
were already dirty in the working tree (pre-installed per task setup) — included in this commit
as instructed.

### 5. `.gitignore`
Added `e2e/artifacts/`, `playwright-report/`, `test-results/`.

### 6. `README.md`
New "Web app" section (placed after the CLI section, before Architecture): dev workflow
(`dev:server` + `dev:web`), LAN play via `npm run serve` + `ipconfig getifaddr en0`, the three
modes (friend/bot/watch) in the tone of the existing modes description, reconnect behavior
(sessionStorage + backoff + rejoin resend), and a test-commands block (`test`, `test:ws`,
`test:e2e`, `SIM=1 test:sim`) noting `test:e2e` needs `npx playwright install chromium` once and
isn't part of `npm test`.

## Verification (in-sandbox — this sandbox cannot bind sockets or run a real browser)
- `npm run typecheck` — clean.
- `npm run build:web` — succeeds (30 modules, ~130ms).
- `npm test` (vitest, non-e2e/non-ws) — 273 passed, 4 skipped, **6 failed**, all in
  `test/e2e/cli.test.ts` (spawns the CLI as a child process). Confirmed **pre-existing**: stashed
  my changes and reran — identical 6 failures on the unmodified branch tip. Not a regression, not
  touched by this task.
- `npm run test:ws` — fails with `EPERM: operation not permitted 0.0.0.0` (socket bind). Expected
  per the task's sandbox note (cannot bind sockets here) — same would happen on the unmodified
  branch in this sandbox.
- `npm run test:e2e` — **not run** (needs socket bind + real chromium launch, both unavailable in
  sandbox). Chromium 1228 is already present at `~/Library/Caches/ms-playwright` (pre-installed).
  This is the one the controller needs to run outside the sandbox.

## Self-review
- Checked no existing vitest file renders/snapshots `screens/setup.ts` output that the new
  room-code `<p>` would break (`test/web/store-update.test.ts` is the only setup-adjacent test and
  doesn't touch rendering) — confirmed safe.
- Confirmed `vitest.config.ts`'s `include` globs are scoped to `test/**`, so `e2e/**` is never
  picked up by `npm test` — no double-running or conflict between the two runners.
- Deliberately avoided hardcoding "front-row scout" mechanics from the task brief's self-review
  notes in favor of a generic legal-move finder, since roster-to-square assignment
  (`presetPlacement` in `src/engine/setups.ts`) is an internal detail that could change without any
  UI-visible behavior change — a test coupled to it would be needlessly brittle.

## Concerns for the controller
- `npm run test:e2e` has never actually been executed (sandbox can't bind :3000 or launch
  chromium) — this is the first real run. If it fails, most likely culprits to check first: (a)
  `webServer` timeout too tight on a slow first `vite build`, (b) a race in reading the room code
  if `SETUP_STATUS`/`ROOM_CREATED` ordering ever surfaces the placeholder screen first (should be
  covered by waiting on the "Set up your pieces" heading before reading the code, but worth
  checking if the code line is briefly absent), (c) `makeLegalMove`'s per-piece click loop being
  slower than expected under all 40 preset-placed pieces if early pieces are immovable in that
  particular preset draw — should still resolve, just want to flag the loop bound.

Report path: `/Users/jeffrey/Documents/claude_playground/stratego/.superpowers/sdd/task-12-report.md`

## Post-task fix: room code visibility gate
- **Issue**: setup.ts showed the room code for all game modes (friend, bot, watch), but only friend games (HUMAN_VS_HUMAN) can be joined by code.
- **Fix** (commit `523799f`): Added `mode` field to Store, set it optimistically in lobby.ts when creating/joining (HUMAN_VS_HUMAN/HUMAN_VS_BOT/BOT_VS_BOT), and gated the room-code `<p>` on `store.mode === 'HUMAN_VS_HUMAN'`. Updated test mock Store. Verified: typecheck clean, all 61 web tests pass, build succeeds.
- **E2E verification**: smoke.spec.ts only reads `[data-testid="room-code"]` in friend-game test (line 105), not in vs-bot test — no e2e selector breakage.
