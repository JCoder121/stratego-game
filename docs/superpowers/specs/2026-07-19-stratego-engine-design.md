# Stratego Engine v1 — Design Spec

2026-07-19. Terminal-first engine + simulations; UI in v2 (craps-engine pattern).

## Goals

- Faithful rendition of the official Hasbro Stratego rules (Milton Bradley PDF, © 1986/1996, ref 4714-1), with every deviation/clarification documented here.
- V1 scope: pure engine + bot-vs-bot simulations + interactive terminal play (human vs bot).
- Future-proofed for v2 web UI and a future ML agent (fast headless self-play, JSON-serializable state, clean observation/action interfaces).

## Stack

TypeScript (strict + `noUncheckedIndexedAccess`, ES2022/ESNext/Bundler, ESM, no build — run via `tsx`), Vitest 2, fast-check 3, Node 20+. Own git repo at `~/Documents/claude_playground/stratego`. Same conventions as `../craps`.

npm scripts: `test`, `test:watch`, `test:sim` (env-gated `SIM=1`, long timeout), `typecheck`, `cli`, `sim`.

## Architecture

Pure total reducer core; shells (CLI now, web later) and bots consume it.

```
src/
  engine/          # PURE — no I/O, no RNG, no clock
    types.ts       # Rank, Color, Square, Piece, Phase, GameState, Action, GameEvent unions
    init.ts        # createGame(config) → SETUP-phase state
    validate.ts    # validateAction(state, action) → reason | null
    reduce.ts      # strategoReduce(state, action) → {state, events} — total, never throws,
                   #   never mutates; illegal/malformed input → same state + REJECTED event
    pieceDefs.ts   # PIECE_DEFS: Record<Rank, PieceDef> registry —
                   #   { rank, rankValue, canMove, movement(), resolveCombat() }
                   #   encodes Spy>Marshal, Miner defuses Bomb, Scout rays, Bomb/Flag immobile
    movement.ts    # board geometry: adjacency, lakes, Scout ray-cast, blocking
    combat.ts      # combat resolution table → 'ATTACKER' | 'DEFENDER' | 'BOTH'
    rules.ts       # two-square rule, win/draw detection
    redact.ts      # viewFor(state, color) → PlayerView with unrevealed enemy ranks hidden
    setups.ts      # preset formations + setup-legality helpers
    index.ts       # barrel
  rng/rng.ts       # Rng interface; makeSeeded(seed) (mulberry32) + makeRandom();
                   #   injected by shells for random setup + bot tie-breaks — never inside engine
  bots/
    types.ts       # Bot = (view: PlayerView, rng: Rng) → Action   ← redacted view ONLY
    random.ts      # uniform random legal action
    heuristic.ts   # attack-when-winning, flag defense, basic piece values
  cli/
    main.ts        # readline loop; owns RNG; human vs bot; redacted ASCII board per mover
    parse.ts       # "move b4 b5" etc. → Action | meta | error
    render.ts      # state/events → strings
  sim/
    run.ts         # seeded bot-vs-bot harness: N games → stats (win rates, game length,
                   #   piece survival, termination); `npm run sim`
test/
  unit/            # per-module: each rank's movement, every combat pairing, setup legality,
                   #   two-square rule, win/draw conditions, redaction
  property/        # arbitraries.ts + invariants.test.ts (see Testing)
  sim/             # env-gated long self-play runs
```

Boundary rules (load-bearing):
- Engine imports nothing from cli/bots/sim; all randomness enters via actions or injected `Rng`.
- Bots and CLI rendering consume only `PlayerView` (redacted) — enforced by types.
- State is plain JSON: `JSON.parse(JSON.stringify(state))` is the save-game story; deterministic replay = log actions, replay them.

### State & actions (sketch)

- `GameState`: `{ config, phase: 'SETUP'|'PLAY'|'GAME_OVER', board (10×10 of pieceId|null), pieces: Record<PieceId, Piece>, turn: Color, plyCount, recentMoves (for two-square rule), captured, result }`
- `Piece`: `{ id, owner, rank, revealed: boolean, pos | 'CAPTURED' }`
- Actions: `SETUP_PLACE` / `SETUP_PRESET` / `SETUP_RANDOM` (carries rng-derived placement), `SETUP_DONE`, `MOVE {from,to}` (attack = MOVE onto enemy square), `RESIGN`.
- Events (discriminated union): `PIECE_MOVED`, `STRIKE` (attacker+defender ranks — both reveal), `PIECE_CAPTURED`, `BOMB_DEFUSED`, `FLAG_CAPTURED`, `GAME_OVER {winner|draw, reason}`, `REJECTED {reason}`, setup events. Fine-grained enough to drive v2 animation.

## Rules (from the official PDF)

Board 10×10; two 2×2 lakes; each player sets up 40 pieces anywhere in their back 4 rows; Red moves first.

Roster per player: Marshal(10)×1, General(9)×1, Colonel(8)×2, Major(7)×3, Captain(6)×4, Lieutenant(5)×4, Sergeant(4)×4, Miner(3)×5, Scout(2)×8, Spy×1, Bomb×6, Flag×1 = 40 (33 movable).

- One action per turn: move or attack. Orthogonal one square; no diagonals, no jumping, no lakes, no occupied-by-own squares. Bomb/Flag never move.
- **Scout**: any number of open squares in a straight line; may move AND attack in the same turn (explicit in this PDF); moving multiple squares reveals it.
- **Attack**: optional, orthogonally adjacent only, attacker taps and both players declare ranks (both pieces become `revealed`). Lower rank is captured; attacker moves into the square on a win; defender never moves; equal ranks → both removed.
- **Spy**: beats the Marshal only as attacker; dies to everything else including when attacked by the Marshal. (Spy→Bomb dies; Spy→Flag wins.)
- **Bomb**: any non-Miner attacker dies, Bomb stays on the board. Miner defuses it, removes it, moves in. Bomb/Flag cannot attack.
- **Two-square rule** (only repetition rule in this edition): a piece cannot move back and forth between the same two squares in three consecutive turns. No "chasing/more-squares" rule exists in this PDF.
- **Win**: attack/move onto the enemy Flag. **Loss**: no legal action on your turn (covers both all-movables-captured and fully-boxed-in).

### Documented decisions (PDF ambiguities)

1. **Lake squares** (prose never states them; figure-derived standard): rows 5–6 (1-indexed from Red's side), columns 3–4 and 7–8.
2. **Two-square rule semantics**: a `MOVE A→B` is illegal if that piece's last two moves were `A→B` then `B→A` (i.e. it would complete a third consecutive traversal of the same pair). Tracked via per-piece recent-move history; resets when the piece moves elsewhere.
3. **Reveal model**: base rules reveal both ranks on every strike; survivors stay `revealed=true` permanently. Redaction hides only unrevealed enemy ranks (positions/counts of pieces are always visible, as on a real board).
4. **Zero-legal-action = loss**, even with movable pieces still on the board (boxed in).
5. **Draw policy** (PDF defines none): draw if (a) configurable ply cap reached (default 2000 plies) or (b) dead position — neither side has any movable piece. Reason recorded in `GAME_OVER`.
6. **Scout attack path**: target must be the first occupied square along the open line (no jumping).

### Deferred (v2+)

- Optional tournament variants from the PDF — Aggressor Advantage, Silent Defense, Rescue — as config flags; `config` object shaped so they slot in without breaking saves.
- Web UI (Vite app over the same engine, craps `store.ts` adapter pattern).
- **ML agent trained to play optimally** (user-requested): `PlayerView` is the observation space, the legal-action list the action space; engine already headless/fast/seeded for self-play.

## Setup modes (v1)

Presets (a few known-decent formations in `setups.ts`), fully random (shuffled via injected seeded RNG), and manual terminal placement (`SETUP_PLACE` per piece, with validation).

## Error handling

The reducer is total: any malformed or illegal action returns the unchanged state plus `REJECTED {reason}` with a human-readable message. CLI surfaces the reason; bots must never generate rejects (asserted in sims).

## Testing

- **Unit**: every rank's movement including edge/lake/block cases; the full combat matrix (every attacker×defender pairing); setup legality; two-square rule; win/loss/draw paths; redaction output.
- **Property (fast-check)**: piece conservation (never created; removed only via capture events); serialization round-trip; reducer totality on junk (well-typed-illegal, shaped-ish junk, `fc.anything()` — no throw, no mutation, exactly one REJECTED); turn/phase coherence; **redaction never leaks an unrevealed enemy rank**; random-legal-move games always terminate under the draw policy.
- **Sim (env-gated)**: thousands of seeded random-vs-random and heuristic-vs-random games — termination, zero rejects from bots, stats sanity (first-move advantage, game lengths, piece survival).

## Success criteria

`npm test` + `npm run typecheck` green; `npm run sim` completes N=1000 seeded games with zero illegal actions and 100% termination; a human can play a full game against the heuristic bot in the terminal without seeing hidden enemy ranks.
