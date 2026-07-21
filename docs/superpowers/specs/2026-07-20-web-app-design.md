# Stratego Web App — Design

**Date:** 2026-07-20
**Status:** Approved (interview 2026-07-20)
**Scope:** Full end-to-end web app for the existing Stratego engine: online human vs human (two browsers), human vs bot, and bot-vs-bot watch mode. Run locally for now; deployable to a host later. The ML/RL work is explicitly split out into a future, separate guided-course project — Tasks 3–5 of the 2026-07-20 ML track design are shelved (Tasks 1–2 remain valid inputs to that future course).

## Goals

- A working, playable Stratego game — the original point of the project.
- Three modes in one web UI: human vs human (online, two browsers/devices), human vs bot (random or heuristic), bot vs bot (spectator watch mode).
- Server-authoritative hidden information: a client can never see enemy ranks, even via devtools.
- Existing CLI, sims, and 107 tests stay untouched and green.

## Key decisions (user interview)

| Decision | Choice |
|---|---|
| Multiplayer model | Online, two browsers, via room codes (not hotseat) |
| Hosting | Local only for now (`localhost`/LAN); deployment deferred |
| Architecture | Single Node server (HTTP + `ws`), server-authoritative; vanilla TS + Vite client (no framework) |
| Visual direction | Classic board-game look: felt board, red/blue tiles with rank insignia |
| Setup UX | Full: drag/drop manual placement + presets + random, with post-fill swapping |
| ML track | Deferred to a separate projectify-style RL course later (mini-variant vs full TBD then) |

## Architecture

```
stratego/
  src/engine|bots|cli|sim|rng    (untouched)
  src/server/                     (new)
    main.ts        — HTTP server (serves client build) + ws upgrade
    rooms.ts       — room registry: create/join by code, expiry, GC
    session.ts     — seat tokens → reconnect
    game-room.ts   — per-room loop: owns GameState, applies actions,
                     runs bot turns, broadcasts redacted views
    protocol.ts    — wire message types (imported by both sides)
  src/web/                        (new, Vite root)
    main.ts        — hash router
    screens/       — lobby, setup, game, watch
    board/         — board render + drag/tap interaction
    styles/
```

- **Data flow (one direction):** client sends `ACTION` → server `validateAction` → `strategoReduce` → if bot's turn, run bot (paced with `setTimeout`) → broadcast per-player `viewFor(state, color)` (+ spectator view for watch mode). Client is a dumb renderer of its latest `PlayerView`; the only client-side game logic is move-highlighting via the existing view-side legal-move logic.
- **Room:** `{ code, config, state: GameState, seats: {RED, BLUE}, sockets, mode }`. Modes are seat assignments: human/human, human/bot, bot/bot (humans spectate). In-memory only; server restart loses games (acceptable while local-only).
- **Dev workflow:** `npm run dev` = server on :3000 + Vite dev server with ws proxy. `npm run serve` = build client, single server serves everything; second device joins via `http://<mac-ip>:3000` on LAN.
- **Deps:** `ws` (+ types) is the only new runtime dependency; `vite` and `@playwright/test` are dev deps.

## Protocol

Discriminated unions in `src/server/protocol.ts`, shared by server and client.

- **Client→server:** `CREATE_ROOM {mode, botDifficulty?, watchSpeed?}` · `JOIN_ROOM {code}` · `REJOIN {code, token}` · `COMMIT_SETUP {placement}` (setup is staged entirely client-side — the engine has no un-place/swap action, so drag/swap/clear happen locally and the full 40-piece arrangement commits atomically on Ready; server replays it as `SETUP_PLACE`s + `SETUP_DONE` on a scratch state) · `ACTION {action, seq}` (`MOVE`/`RESIGN` only) · `REMATCH_REQUEST` · `WATCH_CONTROL {play|pause|step|speed}`.
- **Server→client:** `ROOM_CREATED {code, token, seat}` · `JOINED {seat, token}` · `VIEW {playerView, lastMove?, seq}` · `GAME_OVER {result, fullState}` (all ranks revealed at game end) · `OPPONENT_STATUS {connected|disconnected}` · `REMATCH_STATE` · `ERROR {code, msg}`.
- **Room codes:** 5 chars from an unambiguous alphabet (no `0/O/1/I`), e.g. `K3PXQ`. Rooms expire after 2h idle; empty rooms GC'd after 5 min.
- **Reconnect:** server issues a random seat token on join; client keeps it in `sessionStorage` and auto-`REJOIN`s on refresh/drop. Old socket for a token is closed if a new one adopts it. No forfeit timer in v1.
- **Setup phase:** both players place simultaneously; each sees only the opponent's placing/ready status. Bot seats set up instantly (random placement).
- **Watch mode:** creator picks each seat's bot (random/heuristic) + speed (0.5s / 1s / step-through). Spectator view shows both armies' ranks.
- **Rematch:** either side requests, both must accept; fresh `GameState`, same room and code.

## Client UI

Four hash-routed screens, vanilla TS + CSS (no framework):

1. **Lobby** — Create game (mode picker: vs friend / vs bot easy·hard / watch bots) or Join by code.
2. **Setup** — your four rows active; tray of unplaced pieces; drag-drop or tap-piece-then-tap-square; Preset / Random / Clear buttons; swap already-placed pieces by dragging; Ready button (`SETUP_DONE`).
3. **Game** — board centered; own pieces show rank insignia, enemy pieces show hidden backs (or revealed rank per `PlayerView`); select piece → legal destinations highlight; combat shown as a brief both-ranks reveal animation; captured-piece trays for both sides; move log; resign (with confirm). Game over → full board revealed + result banner + rematch button.
4. **Watch** — same board with both armies revealed; play/pause/step and speed controls.

Classic look in pure CSS: felt-green board, lake tiles, red/blue piece tiles with traditional rank numerals and icons. Target: laptop + tablet on LAN; no mobile-first work in v1.

## Error handling

- **Invalid actions:** rejected with `ERROR {code}`; since the client only offers legal moves, any rejection is treated as desync → client requests a fresh `VIEW`. All inbound messages pass a shape check + `validateAction` before touching state; the server never throws on bad input.
- **Ordering:** one synchronous action queue per room; `seq` numbers on actions; stale/duplicate actions dropped.
- **Disconnects:** socket drop marks the seat disconnected (opponent notified), state untouched; token rejoin restores. Explicit leave = resign with confirmation.
- **Duplicate/invalid joins:** full room or unknown code → error; second tab with the same token adopts the seat and closes the old socket.
- **Bot failure:** a throwing bot (unexpected — sims exercise them heavily) resigns its seat instead of hanging the room.

## Testing

- **Server unit (vitest, in-process, no network):** room registry (create/join/expire/GC); game-room action application over scripted games; **wire-redaction property test** — serialized `VIEW` messages to a player never contain enemy ranks pre-reveal (extends the v1 `viewFor` leak test to the wire format).
- **Protocol integration (vitest + real `ws` clients against in-process server):** full happy-path game, reconnect mid-game, simultaneous setup, watch-mode controls, rematch.
- **Client:** pure logic modules (board geometry, drag state machine) unit-tested; one Playwright smoke test — two browser contexts play a scripted short game through the real server, plus a screenshot for visual review.
- Existing 107 tests unchanged; `npm test` remains the single gate (Playwright behind its own script).

## Risks

- **Rank leakage over the wire** is the one unforgivable bug — mitigated by server-side-only redaction plus the wire-format property test.
- **Drag/drop fiddliness** is the main UI schedule risk — tap-tap placement is the fallback interaction and ships regardless.
- **LAN access** needs the server bound to `0.0.0.0`; document the `<mac-ip>` URL in the README.

## Out of scope (v1 web)

Deployment/hosting, accounts, ranked/Elo ladder, in-game chat, tournament variants, mobile-first layout, game persistence across server restarts, spectators for human games, ML bots (future separate RL course).
