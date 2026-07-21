# Stratego Engine

A faithful, terminal-first Stratego game engine in TypeScript — rules implemented from the
official Hasbro/Milton Bradley PDF (© 1986/1996, ref 4714-1). This is the engine, bot-vs-bot
simulations, and an interactive human-vs-bot CLI. There is no graphical UI yet; a web UI is
planned for v2, layered on top of this same engine (see Roadmap).

## Rules source & documented decisions

Full design spec: [`docs/superpowers/specs/2026-07-19-stratego-engine-design.md`](docs/superpowers/specs/2026-07-19-stratego-engine-design.md).

The official PDF leaves a few things ambiguous or unstated; this engine resolves them as follows
(all documented in the spec above):

- **Lakes**: standard two 2×2 lakes at rows 4–5, columns 2–3 and 6–7 (0-indexed).
- **Reveal model**: both ranks are revealed on *every* strike (attacker and defender alike),
  and stay revealed permanently — tracked per-piece, not just "known to have been attacked."
- **Bomb**: any non-Miner attacker dies against a Bomb, and the Bomb *stays on the board*. Only
  a Miner defuses it (removes it, moves in).
- **Spy**: beats the Marshal only when the Spy is the *attacker*; dies to everything else,
  including when the Marshal attacks it.
- **Scout**: may move any number of open squares in a straight line, and may move-and-strike in
  the same turn (attacking the first occupied square along the line — no jumping).
- **Two-square rule**: the only repetition rule in this edition — a piece may not complete a
  third consecutive back-and-forth traversal of the same two squares. No "more-squares/chasing"
  rule exists in this ruleset.
- **Win**: capture the enemy Flag. **Loss**: no legal action available on your turn (covers both
  "all movable pieces captured" and "fully boxed in").
- **Draws**: not defined by the PDF, so this engine adds two policies — a configurable ply cap
  (default 2000 plies) and dead-position detection (neither side has any movable piece left).

## Running it

```bash
npm install
npm test                 # unit + property tests
npm run typecheck        # tsc --noEmit
npm run sim               # bot-vs-bot stats (heuristic vs random, 200 seeded games)
SIM=1 npm run test:sim   # longer, env-gated self-play termination tests
npm run cli               # play as RED against the heuristic bot
```

### CLI

`npm run cli` starts an interactive game: you are RED, the heuristic bot is BLUE (which sets up
immediately). Commands:

- `setup random` — random legal placement
- `setup preset balanced` — a known-decent preset formation (also `bombs-back`)
- `move a2 a3` — move or attack (attacking is just moving onto an enemy-occupied square)
- `done` — finish setup
- `resign`
- `board` — reprint the current (redacted) board
- `help`
- `quit`

Input is read as an async line iterator, so you can also pipe a whole command script in, e.g.
`cat script.txt | npm run cli`.

## Web app

A browser UI (`src/web`, a small vanilla-TS/Vite client) sits alongside the CLI as a second shell
over the same engine, talking to a WebSocket server (`src/server`) that owns each room's
`GameState` and drives bot turns server-side.

### Dev workflow

Two dev servers, run in separate terminals:

```bash
npm run dev:server   # tsx watch src/server/main.ts — ws server on :3000, restarts on change
npm run dev:web       # vite — client dev server with hot reload, proxies /ws to :3000
```

Open the URL Vite prints (typically `http://localhost:5173`).

### LAN play

For a single build served straight off the ws server — useful for playing a friend over the same
network without two dev servers running:

```bash
npm run serve   # build:web, then tsx src/server/main.ts on :3000
```

Find your Mac's LAN IP and share `http://<mac-ip>:3000` with the other player:

```bash
ipconfig getifaddr en0
```

### Modes

- **Play a friend**: "Create room" gets you a 5-character room code (shown on your setup screen)
  to share; the other player enters it under "Join a room". Both place their pieces (a preset or
  Random, then Ready) and play once both are ready.
- **Play the bot**: Easy (`random` bot) or Hard (`heuristic` bot) — you're always RED, the bot
  sets up and moves for BLUE server-side.
- **Watch bots**: pick a difficulty for each side and a playback speed (or step through ply by
  ply) to spectate a bot-vs-bot game with no seat of your own.

### Reconnect

The client keeps its room/role/token in `sessionStorage` and reconnects with backoff (1s, 2s, 3s,
4s, capped at 5s) on any drop; the server resends the current `SETUP_STATUS`/`VIEW` on rejoin, so
a refresh or a flaky connection mid-game picks back up where it left off rather than losing the
seat. Each seated player sees an "opponent disconnected" banner while the other side is down.

### Tests

```bash
npm test              # unit + property + web logic tests (vitest)
npm run test:ws       # WS-gated server integration test (real sockets, not mocked)
npm run test:e2e      # Playwright smoke test — boots `npm run serve` and drives real browsers
SIM=1 npm run test:sim  # longer, env-gated self-play termination tests
```

`test:e2e` needs Chromium installed once (`npx playwright install chromium`); it's not run as
part of `npm test`.

## Architecture

```
src/
  engine/   # pure — no I/O, no RNG, no clock
  rng/      # Rng interface; seeded (mulberry32) + non-seeded impls, injected by shells
  bots/     # Bot = (view: PlayerView, rng: Rng) => Action — redacted view only
  cli/      # readline loop, command parsing, rendering
  sim/      # seeded bot-vs-bot harness → win/draw/termination stats
```

- **Pure total reducer**: `strategoReduce(state, action) -> { state, events }` never throws and
  never mutates its input. Any illegal or malformed action returns the *unchanged* state plus a
  single `REJECTED { reason }` event — there is no exception path a caller needs to catch.
- **Per-rank registry**: `PIECE_DEFS` (`src/engine/pieceDefs.ts`) holds each rank's value,
  movability, and Scout-ness, so combat/movement special cases (Spy, Miner, Bomb, Scout) are
  looked up rather than hardcoded through the reducer.
- **Hidden-information redaction**: `viewFor(state, color) -> PlayerView` strips unrevealed
  enemy ranks (position and ownership stay visible, as on a real board — only the rank is
  hidden). Bots and the CLI only ever see a `PlayerView`, never the true `GameState`. This same
  redacted view is the intended observation space for a future ML agent.
- **Injected RNG**: the engine itself never generates randomness — shells (CLI, sim harness)
  own an `Rng` and pass RNG-derived data in via actions (e.g. `SETUP_RANDOM`'s shuffled order)
  or into bots directly. This keeps the engine deterministic and headless.
- **JSON-serializable state**: `GameState` is plain JSON (no classes, no functions), so
  `JSON.parse(JSON.stringify(state))` round-trips cleanly — save/load and replay-by-replaying-
  actions come for free.

## Roadmap

- **v2: web UI** over this same engine (the reducer/events/redaction layer doesn't change;
  only a new shell consumes it, the same way the CLI does now).
- **ML agent**: train an agent to play optimally. `PlayerView` (from `viewFor`) is the intended
  observation space; the legal-action list is the action space. The engine is already
  deterministic, seeded, and fast enough for headless self-play.
- **Deferred tournament variants** from the PDF — Aggressor Advantage, Silent Defense, Rescue —
  as config-flag stubs; `GameConfig` is shaped so these can slot in later without breaking saved
  games.

### Known v1 limitation

The bundled bots (`randomBot`, `heuristicBot`) pick moves from the redacted `PlayerView`, which
does not include per-piece move history — so they can't see the two-square rule coming and will
sometimes propose a move that gets `REJECTED` by the engine. After a few failed retries a bot
resigns rather than loop forever, which is why roughly half of bot-vs-bot games in `npm run sim`
end in `RESIGN` rather than `FLAG_CAPTURED`. The engine itself is correct — every game still
terminates, and no illegal action is ever actually applied to the board. Making the bots smarter
about the two-square rule (or exposing enough history to plan around it) is future work, not an
engine bug.
