# Engine Verification (ML Track Task 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully verify the v1 Stratego engine (suites, rulebook-conformance scenarios, 2,000+ instrumented sims, CLI E2E) and produce a test report with a classified explanation of the ~56% RESIGN rate plus a go/no-go fix recommendation.

**Architecture:** Verification-only — engine behavior must not change. New code is additive: a conformance test suite (`test/conformance/`), an instrumented sim analytics module (`src/sim/analyze.ts` + `src/sim/full.ts`), a CLI E2E suite (`test/e2e/`) enabled by an opt-in `STRATEGO_SEED` env var in the CLI, and a written report under `docs/reports/`.

**Tech Stack:** TypeScript, vitest, tsx, node:child_process (E2E). No new dependencies.

## Global Constraints

- **Do not change engine behavior.** `src/engine/**` is read-only for this plan. If a test exposes a genuine rulebook violation, STOP and report it to the user — do not fix it unilaterally.
- The only permitted `src/` changes: new files `src/sim/analyze.ts`, `src/sim/full.ts`, and a seed-env tweak to `src/cli/main.ts` (Task 4) that leaves default behavior identical when `STRATEGO_SEED` is unset.
- All randomness must be seeded (`makeSeeded`) — every test and batch run must be reproducible.
- Existing commands must keep passing after every task: `npm test`, `npm run typecheck`.
- Spec: `docs/superpowers/specs/2026-07-20-ml-track-design.md` (Task 1 section).

## Engine facts the implementer needs (verified by reading the source)

- Board: `{r, c}` 0-indexed, 10×10. Row 0 = BLUE back row, row 9 = RED back row. Lakes at rows 4–5 × cols 2–3 and 6–7. Algebraic: `a1` = `{r:9,c:0}`, `a10` = `{r:0,c:0}` (`toAlg`/`fromAlg` in `src/engine/board.ts`).
- `strategoReduce(state, action) → {state, events}` is pure/total; invalid actions return `events[0].type === 'REJECTED'` with unchanged state.
- Piece ids: `` `${color}-${rank}-${index}` `` e.g. `RED-SPY-0`, `BLUE-BOMB-3`. `createGame()` returns all pieces with `pos: null`.
- Tests may construct mid-game states directly (existing convention — see `minimalDeadPositionState()` in `test/unit/reduce.test.ts`): set `pieces[id].pos`, `setupDone`, `phase: 'PLAY'`, `turn`.
- After every MOVE, `applyEndConditions` runs: dead-position check, then `hasAnyLegalAction(next player)` (NO_MOVES loss), then ply cap. **Minimal scenario states must give BOTH sides a spare movable piece** (e.g. a SCOUT parked far away) unless the test is deliberately about an end condition.
- Two-square rule (`violatesTwoSquare`): illegal to repeat move X→Y when the piece's last two recorded moves were X→Y then Y→X. `recentMoves` keeps last 3 per piece; a strike clears the striker's history.
- Sim RESIGN mechanics (`src/sim/run.ts`): the bot loop retries up to 5 rejected actions, then the *harness* submits RESIGN for that color. Bots also return RESIGN themselves when `legalMovesFromView` yields nothing. `legalMovesFromView` does NOT filter two-square (bots can't see `recentMoves`), while engine validation does — this asymmetry is the suspected resign driver.
- `viewFor(state, color)` → `PlayerView { viewer, phase, turn, plyCount, pieces: VisiblePiece[], result }`; enemy `rank: null` unless `revealed`.
- Bot signature: `type Bot = (view: PlayerView, rng: Rng) => Action` (`src/bots/types.ts`). Rng: `makeSeeded(seed)` → `{ next(), int(n), shuffle(a) }` (`src/rng/rng.ts`).
- CLI (`src/cli/main.ts`): human RED vs heuristic BLUE, async line iterator (piped input works), currently `makeRandom()` (nondeterministic). Output markers: `renderView` ends with `(you are RED; UPPER=yours, lower=known enemy, ?=hidden, ~=lake)`; `renderEvents` prints e.g. `STRIKE MARSHAL vs SCOUT → ATTACKER`, `GAME OVER: BLUE (RESIGN)`, `rejected: <reason>`; parse errors: `unknown command: <cmd>`, `bad square (use a1..j10)`; exit line `Game over.`. RESIGN is only valid during PLAY (rejected during setup).
- `balanced` preset, RED: roster order high→low onto rows 6,7,8,9 row-major ⇒ `RED-MARSHAL-0` at `{r:6,c:0}` = alg `a4`; `a5` (`{r:5,c:0}`) is open and not a lake ⇒ `move a4 a5` is a legal first move.

---

### Task 1: Baseline run + report scaffold

**Files:**
- Create: `docs/reports/2026-07-20-engine-verification.md` (scaffold; filled through the plan)

**Interfaces:**
- Produces: the report file all later tasks append to.

- [ ] **Step 1: Run the existing suites and capture output**

```bash
cd ~/Documents/claude_playground/stratego
npm test 2>&1 | tail -20
npm run typecheck && echo TYPECHECK_OK
SIM=1 npm run test:sim 2>&1 | tail -10
npm run sim
```

Expected: all tests pass (73 at last count), `TYPECHECK_OK`, sim prints 200-game stats object. If anything fails, STOP — report to the user before proceeding.

- [ ] **Step 2: Create the report scaffold with the baseline numbers**

Create `docs/reports/2026-07-20-engine-verification.md`:

```markdown
# Engine Verification Report — 2026-07-20

Pre-ML gate for the ML track (spec: docs/superpowers/specs/2026-07-20-ml-track-design.md, Task 1).

## 1. Baseline suites

| Check | Result |
| --- | --- |
| `npm test` (unit + property) | <PASS/FAIL, N tests — fill from Step 1 output> |
| `npm run typecheck` | <fill> |
| `SIM=1 npm run test:sim` | <fill> |
| `npm run sim` (200 games, heuristic vs random) | <paste stats object> |

## 2. Rules-conformance scenarios

_(filled by Task 2)_

## 3. Large-batch simulation statistics

_(filled by Task 5)_

## 4. RESIGN investigation

_(filled by Task 5)_

## 5. CLI E2E

_(filled by Task 4)_

## 6. Findings & recommendation

_(filled by Task 6)_
```

Replace the three `<fill>` markers in section 1 with the real Step 1 output before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/reports/2026-07-20-engine-verification.md
git commit -m "docs: verification report scaffold + baseline suite results"
```

---

### Task 2: Rules-conformance scenario suite

**Files:**
- Create: `test/conformance/rules.test.ts`

**Interfaces:**
- Consumes: engine barrel `src/engine/index.js` only.
- Produces: nothing for later tasks (self-contained suite); Task 6 cites its pass count.

These tests assert the rulebook decisions documented in README/spec, one scenario each, via directly-constructed states.

- [ ] **Step 1: Write the suite**

Create `test/conformance/rules.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createGame, strategoReduce, pieceAt } from '../../src/engine/index.js';
import type { Color, GameEvent, GameState, PieceId, Square } from '../../src/engine/types.js';

// Directly-constructed mid-game state (existing convention, cf. test/unit/reduce.test.ts).
// Both sides get their FLAG plus the listed pieces; add a far-corner SCOUT per side
// ("spares") so applyEndConditions doesn't end the game accidentally.
function stateWith(
  placements: Array<[PieceId, Square]>,
  opts: { turn?: Color; spares?: boolean; maxPlies?: number } = {},
): GameState {
  const s = createGame({ maxPlies: opts.maxPlies ?? 2000 });
  s.pieces['RED-FLAG-0']!.pos = { r: 9, c: 9 };
  s.pieces['BLUE-FLAG-0']!.pos = { r: 0, c: 9 };
  if (opts.spares !== false) {
    s.pieces['RED-SCOUT-7']!.pos = { r: 9, c: 4 };
    s.pieces['BLUE-SCOUT-7']!.pos = { r: 0, c: 4 };
  }
  for (const [id, sq] of placements) s.pieces[id]!.pos = sq;
  s.setupDone.RED = true;
  s.setupDone.BLUE = true;
  s.phase = 'PLAY';
  s.turn = opts.turn ?? 'RED';
  return s;
}

const mv = (color: Color, from: Square, to: Square) =>
  ({ type: 'MOVE', color, from, to }) as const;

function strikeEvent(events: GameEvent[]) {
  return events.find((e): e is Extract<GameEvent, { type: 'STRIKE' }> => e.type === 'STRIKE');
}

describe('combat table', () => {
  test('Spy attacking Marshal wins', () => {
    const s = stateWith([
      ['RED-SPY-0', { r: 5, c: 0 }],
      ['BLUE-MARSHAL-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('ATTACKER');
    expect(state.pieces['BLUE-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['RED-SPY-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Marshal attacking Spy wins (spy power is attack-only)', () => {
    const s = stateWith([
      ['RED-MARSHAL-0', { r: 5, c: 0 }],
      ['BLUE-SPY-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('ATTACKER');
    expect(state.pieces['BLUE-SPY-0']!.pos).toBeNull();
  });

  test('Spy attacking anything else dies', () => {
    const s = stateWith([
      ['RED-SPY-0', { r: 5, c: 0 }],
      ['BLUE-SCOUT-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('DEFENDER');
    expect(state.pieces['RED-SPY-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-SCOUT-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('equal ranks: both die', () => {
    const s = stateWith([
      ['RED-MAJOR-0', { r: 5, c: 0 }],
      ['BLUE-MAJOR-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('BOTH');
    expect(state.pieces['RED-MAJOR-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-MAJOR-0']!.pos).toBeNull();
  });

  test('both combatants become permanently revealed after a strike', () => {
    const s = stateWith([
      ['RED-GENERAL-0', { r: 5, c: 0 }],
      ['BLUE-COLONEL-0', { r: 4, c: 0 }],
    ]);
    const { state } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(state.pieces['RED-GENERAL-0']!.revealed).toBe(true);
    expect(state.pieces['BLUE-COLONEL-0']!.revealed).toBe(true); // captured but still marked
  });
});

describe('bombs and miners', () => {
  test('non-Miner attacking a Bomb dies; Bomb stays on the board', () => {
    const s = stateWith([
      ['RED-MARSHAL-0', { r: 5, c: 0 }],
      ['BLUE-BOMB-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('DEFENDER');
    expect(state.pieces['RED-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-BOMB-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Miner defuses a Bomb: bomb removed, miner moves in', () => {
    const s = stateWith([
      ['RED-MINER-0', { r: 5, c: 0 }],
      ['BLUE-BOMB-0', { r: 4, c: 0 }],
    ]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(events.some((e) => e.type === 'BOMB_DEFUSED')).toBe(true);
    expect(state.pieces['BLUE-BOMB-0']!.pos).toBeNull();
    expect(state.pieces['RED-MINER-0']!.pos).toEqual({ r: 4, c: 0 });
  });

  test('Bombs and Flags cannot move', () => {
    const s = stateWith([['RED-BOMB-0', { r: 5, c: 0 }]]);
    const bombMove = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(bombMove.events[0]!.type).toBe('REJECTED');
    const flagMove = strategoReduce(s, mv('RED', { r: 9, c: 9 }, { r: 8, c: 9 }));
    expect(flagMove.events[0]!.type).toBe('REJECTED');
  });
});

describe('movement', () => {
  test('non-Scout may not move two squares or diagonally', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 7, c: 0 }]]);
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 5, c: 0 })).events[0]!.type).toBe('REJECTED');
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 1 })).events[0]!.type).toBe('REJECTED');
  });

  test('may not move onto an own piece', () => {
    const s = stateWith([
      ['RED-CAPTAIN-0', { r: 7, c: 0 }],
      ['RED-MINER-0', { r: 6, c: 0 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 })).events[0]!.type).toBe('REJECTED');
  });

  test('Scout slides any distance along an open line', () => {
    const s = stateWith([['RED-SCOUT-0', { r: 8, c: 0 }]]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 2, c: 0 }));
    expect(events[0]!.type).toBe('PIECE_MOVED');
    expect(state.pieces['RED-SCOUT-0']!.pos).toEqual({ r: 2, c: 0 });
  });

  test('Scout multi-square move reveals it', () => {
    const s = stateWith([['RED-SCOUT-0', { r: 8, c: 0 }]]);
    const { state } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 2, c: 0 }));
    expect(state.pieces['RED-SCOUT-0']!.revealed).toBe(true);
  });

  test('Scout cannot jump over a piece', () => {
    const s = stateWith([
      ['RED-SCOUT-0', { r: 8, c: 0 }],
      ['BLUE-MINER-0', { r: 5, c: 0 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 3, c: 0 })).events[0]!.type).toBe('REJECTED');
  });

  test('Scout move-and-strike: attacks first occupied square along the line', () => {
    const s = stateWith([
      ['RED-SCOUT-0', { r: 8, c: 0 }],
      ['BLUE-MINER-0', { r: 4, c: 0 }],
    ]);
    const { events } = strategoReduce(s, mv('RED', { r: 8, c: 0 }, { r: 4, c: 0 }));
    expect(strikeEvent(events)?.outcome).toBe('ATTACKER'); // SCOUT(2) < MINER(3)? No: MINER outranks SCOUT
  });

  test('lake squares block movement and Scout lines', () => {
    // {r:4,c:2} is a lake. CAPTAIN beside it cannot enter; Scout line stops.
    const s = stateWith([
      ['RED-CAPTAIN-0', { r: 4, c: 1 }],
      ['RED-SCOUT-0', { r: 9, c: 2 }],
    ]);
    expect(strategoReduce(s, mv('RED', { r: 4, c: 1 }, { r: 4, c: 2 })).events[0]!.type).toBe('REJECTED');
    expect(strategoReduce(s, mv('RED', { r: 9, c: 2 }, { r: 4, c: 2 })).events[0]!.type).toBe('REJECTED');
  });
});

describe('two-square rule', () => {
  test('third identical back-and-forth traversal is rejected; other moves remain legal', () => {
    let s = stateWith([
      ['RED-CAPTAIN-0', { r: 7, c: 0 }],
      ['BLUE-CAPTAIN-0', { r: 2, c: 9 }],
    ]);
    const a: Square = { r: 7, c: 0 };
    const b: Square = { r: 6, c: 0 };
    const blueA: Square = { r: 2, c: 9 };
    const blueB: Square = { r: 3, c: 9 };
    // RED oscillates a->b, b->a while BLUE shuffles elsewhere.
    s = strategoReduce(s, mv('RED', a, b)).state;
    s = strategoReduce(s, mv('BLUE', blueA, blueB)).state;
    s = strategoReduce(s, mv('RED', b, a)).state;
    s = strategoReduce(s, mv('BLUE', blueB, blueA)).state;
    // Third traversal of a->b: must be rejected.
    const third = strategoReduce(s, mv('RED', a, b));
    expect(third.events[0]!.type).toBe('REJECTED');
    // But a different move by the same piece is fine.
    const sideways = strategoReduce(s, mv('RED', a, { r: 7, c: 1 }));
    expect(sideways.events[0]!.type).not.toBe('REJECTED');
  });

  test('a strike resets the oscillation history', () => {
    let s = stateWith([
      ['RED-MARSHAL-0', { r: 7, c: 0 }],
      ['BLUE-MINER-0', { r: 6, c: 1 }],
      ['BLUE-CAPTAIN-0', { r: 2, c: 9 }],
    ]);
    const a: Square = { r: 7, c: 0 };
    const b: Square = { r: 6, c: 0 };
    s = strategoReduce(s, mv('RED', a, b)).state;
    s = strategoReduce(s, mv('BLUE', { r: 2, c: 9 }, { r: 3, c: 9 })).state;
    s = strategoReduce(s, mv('RED', b, a)).state;
    s = strategoReduce(s, mv('BLUE', { r: 6, c: 1 }, { r: 6, c: 0 })).state; // miner steps to b
    // RED strikes the miner at b — legal even though it repeats a->b, because strikes
    // are moves too... verify engine treats the strike normally, then history clears.
    const strike = strategoReduce(s, mv('RED', a, b));
    expect(strike.events[0]!.type).not.toBe('REJECTED');
    expect(strikeEvent(strike.events)?.outcome).toBe('ATTACKER');
    expect(strike.state.recentMoves['RED-MARSHAL-0']).toEqual([]);
  });
});

describe('end conditions', () => {
  test('flag capture ends the game immediately with FLAG_CAPTURED', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 0, c: 8 }]]);
    const { state, events } = strategoReduce(s, mv('RED', { r: 0, c: 8 }, { r: 0, c: 9 }));
    expect(events.some((e) => e.type === 'FLAG_CAPTURED')).toBe(true);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: 'RED', reason: 'FLAG_CAPTURED' });
  });

  test('player with no legal action loses (NO_MOVES) when the turn passes to them', () => {
    // BLUE has only its flag + a bomb (immovable): after RED's move, BLUE has no action.
    const s = stateWith(
      [
        ['RED-CAPTAIN-0', { r: 7, c: 0 }],
        ['BLUE-BOMB-0', { r: 0, c: 0 }],
      ],
      { spares: false },
    );
    // Give RED a second movable piece so dead-position doesn't fire for RED... not needed:
    // RED-CAPTAIN-0 remains movable, so only BLUE is stuck.
    const { state } = strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: 'RED', reason: 'NO_MOVES' });
  });

  test('neither side movable → DEAD_POSITION draw', () => {
    // RED SERGEANT strikes BLUE SERGEANT (equal → BOTH die), leaving only flags.
    const s = stateWith(
      [
        ['RED-SERGEANT-0', { r: 5, c: 0 }],
        ['BLUE-SERGEANT-0', { r: 4, c: 0 }],
      ],
      { spares: false },
    );
    const { state } = strategoReduce(s, mv('RED', { r: 5, c: 0 }, { r: 4, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: null, reason: 'DEAD_POSITION' });
  });

  test('ply cap → draw at maxPlies', () => {
    const s = stateWith(
      [
        ['RED-CAPTAIN-0', { r: 7, c: 0 }],
        ['BLUE-CAPTAIN-0', { r: 2, c: 0 }],
      ],
      { maxPlies: 1 },
    );
    const { state } = strategoReduce(s, mv('RED', { r: 7, c: 0 }, { r: 6, c: 0 }));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result).toEqual({ winner: null, reason: 'PLY_CAP' });
  });

  test('actions after GAME_OVER are rejected', () => {
    const s = stateWith([['RED-CAPTAIN-0', { r: 0, c: 8 }]]);
    const over = strategoReduce(s, mv('RED', { r: 0, c: 8 }, { r: 0, c: 9 })).state;
    const after = strategoReduce(over, mv('BLUE', { r: 0, c: 4 }, { r: 1, c: 4 }));
    expect(after.events[0]!.type).toBe('REJECTED');
  });
});
```

Note on the Scout move-and-strike test: `MINER` outranks `SCOUT` (rank values: SCOUT=2, MINER=3), so verify against `src/engine/pieceDefs.ts` before asserting — the expected outcome is `DEFENDER` (scout dies) if rankValue(SCOUT) < rankValue(MINER). Adjust the single `expect` to the true combat table; the point of the test is that a strike happens at the first occupied square rather than a rejection.

- [ ] **Step 2: Run the suite; investigate any failure before touching anything**

```bash
npx vitest run test/conformance
```

Expected: all pass. A failure here is a *finding*, not something to code around: re-read the engine source, determine whether the test or the engine is wrong. If the engine is wrong → STOP, report to user (Global Constraints). If the test encodes the rulebook incorrectly, fix the test and note why.

- [ ] **Step 3: Run the full suite to confirm no interference**

```bash
npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Update report section 2**

In `docs/reports/2026-07-20-engine-verification.md` replace section 2's placeholder with the scenario list and pass count (one line per describe block is fine).

- [ ] **Step 5: Commit**

```bash
git add test/conformance/rules.test.ts docs/reports/2026-07-20-engine-verification.md
git commit -m "test: rulebook-conformance scenario suite (combat, movement, two-square, end conditions)"
```

---

### Task 3: Instrumented sim analytics module

**Files:**
- Create: `src/sim/analyze.ts`
- Test: `test/unit/analyze.test.ts`

**Interfaces:**
- Consumes: engine barrel (`strategoReduce`, `viewFor`, `createGame`, `rosterPieceIds`, `legalMovesForColor`, `violatesTwoSquare`, `pieceAt`, `movablePieceCount`), bots (`randomBot`, `heuristicBot`), `makeSeeded`.
- Produces (used by Task 5's `src/sim/full.ts`):
  - `interface GameRecord { seed: number; result: GameResult; plies: number; endedBy: 'ENGINE' | 'BOT_RESIGN' | 'FORCED_RESIGN'; forcedResign: ForcedResignInfo | null; survivors: Record<Color, number> }`
  - `interface ForcedResignInfo { color: Color; engineLegalMoves: number; viewLegalMoves: number; rejectionReasons: string[] }`
  - `function playGameDetailed(opts: { seed: number; red: Bot; blue: Bot; maxPlies?: number }): GameRecord`
  - `interface BatchStats { games: number; redWins: number; blueWins: number; draws: number; reasons: Record<string, number>; endedBy: Record<string, number>; forcedResignReasons: Record<string, number>; plies: { mean: number; p50: number; p90: number; max: number } }`
  - `function runBatch(opts: { games: number; seed: number; red: Bot; blue: Bot }): { stats: BatchStats; records: GameRecord[] }`

`playGameDetailed` replays the exact `playGame` loop from `src/sim/run.ts` (same setup, same rng derivation `seed ^ 0x9e3779b9`, same 5-attempt retry) but records *why* games end. Do not modify `run.ts` — duplicate the small loop so existing behavior stays byte-identical and the instrumented results remain comparable to the baseline.

- [ ] **Step 1: Write failing tests**

Create `test/unit/analyze.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { playGameDetailed, runBatch } from '../../src/sim/analyze.js';
import { playGame } from '../../src/sim/run.js';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot } from '../../src/bots/heuristic.js';

describe('playGameDetailed', () => {
  test('matches playGame outcome for the same seed (instrumentation is passive)', () => {
    for (const seed of [1, 2, 42, 123]) {
      const plain = playGame({ seed, red: heuristicBot, blue: randomBot });
      const detailed = playGameDetailed({ seed, red: heuristicBot, blue: randomBot });
      expect(detailed.result).toEqual(plain);
    }
  });

  test('classifies every game end', () => {
    const rec = playGameDetailed({ seed: 7, red: randomBot, blue: randomBot });
    expect(['ENGINE', 'BOT_RESIGN', 'FORCED_RESIGN']).toContain(rec.endedBy);
    expect(rec.plies).toBeGreaterThan(0);
    if (rec.endedBy === 'FORCED_RESIGN') {
      expect(rec.forcedResign).not.toBeNull();
      expect(rec.forcedResign!.rejectionReasons).toHaveLength(5);
    } else {
      expect(rec.forcedResign).toBeNull();
    }
  });
});

describe('runBatch', () => {
  test('tallies are consistent and reproducible', () => {
    const a = runBatch({ games: 30, seed: 11, red: heuristicBot, blue: randomBot });
    const b = runBatch({ games: 30, seed: 11, red: heuristicBot, blue: randomBot });
    expect(a.stats).toEqual(b.stats);
    expect(a.stats.redWins + a.stats.blueWins + a.stats.draws).toBe(30);
    const endedTotal = Object.values(a.stats.endedBy).reduce((x, y) => x + y, 0);
    expect(endedTotal).toBe(30);
    expect(a.stats.plies.p50).toBeGreaterThan(0);
    expect(a.stats.plies.max).toBeGreaterThanOrEqual(a.stats.plies.p90);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run test/unit/analyze.test.ts
```

Expected: FAIL — cannot resolve `../../src/sim/analyze.js`.

- [ ] **Step 3: Implement `src/sim/analyze.ts`**

```ts
import {
  createGame, strategoReduce, viewFor, rosterPieceIds,
  legalMovesForColor, violatesTwoSquare, pieceAt, movablePieceCount,
} from '../engine/index.js';
import type { Action, Color, GameResult, GameState } from '../engine/types.js';
import type { Bot } from '../bots/types.js';
import { legalMovesFromView } from '../bots/moves-from-view.js';
import { makeSeeded, type Rng } from '../rng/rng.js';

export interface ForcedResignInfo {
  color: Color;
  engineLegalMoves: number; // moves that pass two-square filtering — what was actually available
  viewLegalMoves: number;   // what the bot's view-based generator offered
  rejectionReasons: string[];
}

export interface GameRecord {
  seed: number;
  result: GameResult;
  plies: number;
  endedBy: 'ENGINE' | 'BOT_RESIGN' | 'FORCED_RESIGN';
  forcedResign: ForcedResignInfo | null;
  survivors: Record<Color, number>;
}

function setupBothRandom(seed: number, maxPlies: number): GameState {
  let s = createGame({ maxPlies, seed });
  const rng = makeSeeded(seed);
  for (const color of ['RED', 'BLUE'] as const) {
    const order = rng.shuffle(rosterPieceIds(color));
    s = strategoReduce(s, { type: 'SETUP_RANDOM', color, order }).state;
    s = strategoReduce(s, { type: 'SETUP_DONE', color }).state;
  }
  return s;
}

function engineLegalMoveCount(s: GameState, color: Color): number {
  let n = 0;
  for (const m of legalMovesForColor(s, color)) {
    const p = pieceAt(s, m.from);
    if (p && !violatesTwoSquare(s, p.id, m.from, m.to)) n++;
  }
  return n;
}

// Mirrors playGame in run.ts exactly (same rng derivation, same 5-attempt retry),
// with passive instrumentation of how the game ended. run.ts is left untouched so
// the baseline stays comparable.
export function playGameDetailed(opts: {
  seed: number; red: Bot; blue: Bot; maxPlies?: number;
}): GameRecord {
  const maxPlies = opts.maxPlies ?? 2000;
  let s = setupBothRandom(opts.seed, maxPlies);
  const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
  const rng: Rng = makeSeeded(opts.seed ^ 0x9e3779b9);

  let endedBy: GameRecord['endedBy'] = 'ENGINE';
  let forcedResign: ForcedResignInfo | null = null;

  let guard = maxPlies * 4 + 100;
  while (s.phase === 'PLAY' && guard-- > 0) {
    const color = s.turn;
    const view = viewFor(s, color);
    let applied = false;
    const rejectionReasons: string[] = [];
    for (let attempt = 0; attempt < 5 && !applied; attempt++) {
      const action: Action = bots[color](view, rng);
      const { state, events } = strategoReduce(s, action);
      if (events[0]?.type === 'REJECTED') {
        rejectionReasons.push(events[0].reason);
        continue;
      }
      if (action.type === 'RESIGN') endedBy = 'BOT_RESIGN';
      s = state;
      applied = true;
    }
    if (!applied) {
      endedBy = 'FORCED_RESIGN';
      forcedResign = {
        color,
        engineLegalMoves: engineLegalMoveCount(s, color),
        viewLegalMoves: legalMovesFromView(view).length,
        rejectionReasons,
      };
      s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
  }

  return {
    seed: opts.seed,
    result: s.result ?? { winner: null, reason: 'PLY_CAP' },
    plies: s.plyCount,
    endedBy,
    forcedResign,
    survivors: {
      RED: movablePieceCount(s, 'RED'),
      BLUE: movablePieceCount(s, 'BLUE'),
    },
  };
}

export interface BatchStats {
  games: number;
  redWins: number; blueWins: number; draws: number;
  reasons: Record<string, number>;
  endedBy: Record<string, number>;
  forcedResignReasons: Record<string, number>; // rejection-reason → count (deduped per game)
  plies: { mean: number; p50: number; p90: number; max: number };
}

export function runBatch(opts: {
  games: number; seed: number; red: Bot; blue: Bot;
}): { stats: BatchStats; records: GameRecord[] } {
  const records: GameRecord[] = [];
  for (let i = 0; i < opts.games; i++) {
    records.push(playGameDetailed({ seed: opts.seed + i, red: opts.red, blue: opts.blue }));
  }
  const sorted = records.map((r) => r.plies).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const stats: BatchStats = {
    games: opts.games,
    redWins: records.filter((r) => r.result.winner === 'RED').length,
    blueWins: records.filter((r) => r.result.winner === 'BLUE').length,
    draws: records.filter((r) => r.result.winner === null).length,
    reasons: {},
    endedBy: {},
    forcedResignReasons: {},
    plies: {
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: pct(50), p90: pct(90), max: sorted[sorted.length - 1]!,
    },
  };
  for (const r of records) {
    stats.reasons[r.result.reason] = (stats.reasons[r.result.reason] ?? 0) + 1;
    stats.endedBy[r.endedBy] = (stats.endedBy[r.endedBy] ?? 0) + 1;
    if (r.forcedResign) {
      for (const reason of new Set(r.forcedResign.rejectionReasons)) {
        stats.forcedResignReasons[reason] = (stats.forcedResignReasons[reason] ?? 0) + 1;
      }
    }
  }
  return { stats, records };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/analyze.test.ts
```

Expected: PASS. The first test (outcome parity with `playGame`) is the critical one — if it fails, the loop is not a faithful mirror; fix `analyze.ts`, never `run.ts`.

- [ ] **Step 5: Full suite + commit**

```bash
npm test && npm run typecheck
git add src/sim/analyze.ts test/unit/analyze.test.ts
git commit -m "feat: instrumented sim analytics (end-cause classification, forced-resign forensics)"
```

---

### Task 4: CLI determinism + E2E suite

**Files:**
- Modify: `src/cli/main.ts:12` (the `const rng = makeRandom();` line)
- Create: `test/e2e/cli.test.ts`

**Interfaces:**
- Consumes: the CLI as a black box (`npx tsx src/cli/main.ts` with piped stdin).
- Produces: `STRATEGO_SEED` env contract — when set to an integer the CLI is fully deterministic; Task 6 cites the E2E results.

- [ ] **Step 1: Add opt-in seeding to the CLI**

In `src/cli/main.ts`, replace:

```ts
const rng = makeRandom();
```

with:

```ts
// STRATEGO_SEED=<int> makes the whole session deterministic (used by E2E tests).
const seedEnv = process.env.STRATEGO_SEED;
const rng = seedEnv !== undefined ? makeSeeded(Number(seedEnv)) : makeRandom();
```

and change the rng import line to:

```ts
import { makeRandom, makeSeeded } from '../rng/rng.js';
```

Default behavior (env unset) is unchanged.

- [ ] **Step 2: Verify typecheck + manual smoke**

```bash
npm run typecheck
printf 'setup preset balanced\ndone\nmove a4 a5\nresign\n' | STRATEGO_SEED=42 npm run cli | tail -5
```

Expected: typecheck passes; output ends with `GAME OVER: BLUE (RESIGN)` then `Game over.` — the human resigning makes BLUE the winner.

- [ ] **Step 3: Write the E2E suite**

Create `test/e2e/cli.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function cli(input: string, seed = 42): Promise<string> {
  const { stdout } = await run(
    'npx', ['tsx', 'src/cli/main.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, STRATEGO_SEED: String(seed) },
      timeout: 30_000,
    },
  ).catch((e) => e as { stdout: string }); // CLI may exit nonzero on stdin close; keep stdout
  return stdout;
}

// execFile has no built-in stdin piping helper — spawn manually instead:
import { spawn } from 'node:child_process';
function cliWithInput(input: string, seed = 42): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/cli/main.ts'], {
      env: { ...process.env, STRATEGO_SEED: String(seed) },
      timeout: 30_000,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.write(input);
    child.stdin.end();
  });
}

describe('CLI E2E (piped input, seeded)', () => {
  test('help prints command list; quit exits cleanly', async () => {
    const out = await cliWithInput('help\nquit\n');
    expect(out).toContain('commands: move a2 a3');
    expect(out).toContain('Game over.');
  });

  test('unknown command and malformed squares produce error messages, not crashes', async () => {
    const out = await cliWithInput('flarp\nmove z9 a1\nmove a1\nquit\n');
    expect(out).toContain('unknown command: flarp');
    expect(out).toContain('bad square (use a1..j10)');
    expect(out).toContain('usage: move <from> <to>');
    expect(out).toContain('Game over.');
  });

  test('setup preset + done starts play and renders the board', async () => {
    const out = await cliWithInput('setup preset balanced\ndone\nquit\n');
    expect(out).toContain('(you are RED; UPPER=yours, lower=known enemy, ?=hidden, ~=lake)');
    expect(out).toContain('move> ');
  });

  test('setup random + done also reaches play', async () => {
    const out = await cliWithInput('setup random\ndone\nquit\n');
    expect(out).toContain('move> ');
  });

  test('a legal move is applied and the bot answers; resign ends the game', async () => {
    const out = await cliWithInput('setup preset balanced\ndone\nmove a4 a5\nresign\n');
    // Human moved without rejection…
    expect(out).not.toContain('rejected: illegal destination');
    // …and the game ends by resignation with BLUE the winner.
    expect(out).toContain('GAME OVER: BLUE (RESIGN)');
    expect(out).toContain('Game over.');
  });

  test('illegal move is rejected with a reason and the game continues', async () => {
    // a1 = {r:9,c:0} back-corner; in "balanced" the back rows hold bombs/flag area pieces —
    // moving a piece 2 squares or from an empty square must be rejected.
    const out = await cliWithInput('setup preset balanced\ndone\nmove e5 e7\nresign\n');
    expect(out).toContain('rejected:');
    expect(out).toContain('GAME OVER: BLUE (RESIGN)');
  });

  test('deterministic under a fixed seed: identical transcripts', async () => {
    const script = 'setup preset balanced\ndone\nmove a4 a5\nmove a5 a6\nresign\n';
    const [a, b] = await Promise.all([cliWithInput(script, 7), cliWithInput(script, 7)]);
    expect(a).toEqual(b);
  });
});
```

Remove the unused `cli`/`execFile` helper if it stays unused — keep only `cliWithInput`.

- [ ] **Step 4: Run the E2E suite**

```bash
npx vitest run test/e2e/cli.test.ts
```

Expected: PASS (each test spawns a process; the file takes ~10–30s total). Notes if a test fails:
- `move e5 e7` case: `e5` is `{r:5,c:4}` — verify it's empty after `move a4 a5`; the point is *some* rejection message appears; adjust the from/to to any clearly-illegal move if needed (e.g. `move a1 a3`, a two-square jump from the back row).
- Determinism test failing means `STRATEGO_SEED` isn't reaching both rngs — check Step 1.

- [ ] **Step 5: Full suite, report, commit**

```bash
npm test && npm run typecheck
```

Update report section 5 with the E2E scenario list + pass count. Then:

```bash
git add src/cli/main.ts test/e2e/cli.test.ts docs/reports/2026-07-20-engine-verification.md
git commit -m "test: CLI E2E suite over piped input; opt-in STRATEGO_SEED determinism"
```

---

### Task 5: Large-batch runner (2,000+ games) + RESIGN forensics

**Files:**
- Create: `src/sim/full.ts`
- Modify: `package.json` (add script `"sim:full": "tsx src/sim/full.ts"`)
- Create (generated): `docs/reports/data/2026-07-20-sim-full.json`

**Interfaces:**
- Consumes: `runBatch`, `playGameDetailed`, `GameRecord` from `src/sim/analyze.js` (Task 3); `randomBot`, `heuristicBot`.
- Produces: JSON stats file + console table that Task 6 pastes into the report.

- [ ] **Step 1: Write `src/sim/full.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runBatch, type BatchStats, type GameRecord } from './analyze.js';
import { randomBot } from '../bots/random.js';
import { heuristicBot } from '../bots/heuristic.js';
import type { Bot } from '../bots/types.js';

const GAMES_PER_PAIRING = Number(process.env.GAMES ?? 500);
const BASE_SEED = Number(process.env.SEED ?? 1000);
const OUT = process.env.OUT ?? 'docs/reports/data/2026-07-20-sim-full.json';

const BOTS: Record<string, Bot> = { random: randomBot, heuristic: heuristicBot };
const PAIRINGS: Array<[string, string]> = [
  ['random', 'random'],
  ['heuristic', 'random'],
  ['random', 'heuristic'],
  ['heuristic', 'heuristic'],
];

interface PairingReport {
  red: string; blue: string; stats: BatchStats;
  // Deeper forced-resign forensics: how many forced resigns happened while the
  // resigning side still had engine-legal moves (i.e. the bot failed, not the game).
  forcedWithMovesLeft: number;
  forcedWithNoMoves: number;
  sampleForcedSeeds: number[];
}

function forensics(records: GameRecord[]): Pick<PairingReport, 'forcedWithMovesLeft' | 'forcedWithNoMoves' | 'sampleForcedSeeds'> {
  const forced = records.filter((r) => r.forcedResign !== null);
  return {
    forcedWithMovesLeft: forced.filter((r) => r.forcedResign!.engineLegalMoves > 0).length,
    forcedWithNoMoves: forced.filter((r) => r.forcedResign!.engineLegalMoves === 0).length,
    sampleForcedSeeds: forced.slice(0, 10).map((r) => r.seed),
  };
}

const reports: PairingReport[] = [];
for (const [redName, blueName] of PAIRINGS) {
  const { stats, records } = runBatch({
    games: GAMES_PER_PAIRING,
    seed: BASE_SEED,
    red: BOTS[redName]!,
    blue: BOTS[blueName]!,
  });
  reports.push({ red: redName, blue: blueName, stats, ...forensics(records) });
  console.log(`\n=== ${redName} (RED) vs ${blueName} (BLUE) — ${GAMES_PER_PAIRING} games ===`);
  console.log(JSON.stringify(reports[reports.length - 1], null, 2));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ gamesPerPairing: GAMES_PER_PAIRING, baseSeed: BASE_SEED, reports }, null, 2));
console.log(`\nwrote ${OUT}`);
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, after `"sim"`, add:

```json
"sim:full": "tsx src/sim/full.ts",
```

- [ ] **Step 3: Smoke-run small, then run the full batch**

```bash
GAMES=20 OUT=/dev/null npm run sim:full     # smoke: completes in seconds, 4 pairing blocks print
npm run sim:full                             # full: 4 × 500 = 2,000 games
```

Expected full-run output: four pairing reports + `wrote docs/reports/data/2026-07-20-sim-full.json`. Sanity checks before proceeding:
- every pairing: `redWins + blueWins + draws === 500`;
- `endedBy` totals sum to 500;
- heuristic-vs-random pairings show heuristic winning a clear majority (baseline `npm run sim` showed this).

- [ ] **Step 4: Fill report sections 3 and 4**

Section 3: one table per pairing (wins/draws, `reasons`, `plies` percentiles). Section 4 (**the deliverable**), from `endedBy` + forensics fields:
- What share of games end in RESIGN, split `BOT_RESIGN` vs `FORCED_RESIGN`.
- Of forced resigns: how many had `engineLegalMoves > 0` (bot failure: legal moves existed but the bot never proposed one — the two-square blind spot) vs `=== 0` (impossible: engine should have ended the game first — if nonzero, that's a potential engine bug → STOP and report).
- Dominant `forcedResignReasons` strings (expect `two-square rule violation` to dominate; report the actual distribution).
- 2–3 sample seeds replayed by hand (`playGameDetailed` in a scratch script) narrating the final position in one sentence each.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/sim/full.ts package.json docs/reports/data/2026-07-20-sim-full.json docs/reports/2026-07-20-engine-verification.md
git commit -m "feat: 2k-game instrumented batch runner + resign forensics data"
```

---

### Task 6: Findings, recommendation, and wrap-up

**Files:**
- Modify: `docs/reports/2026-07-20-engine-verification.md` (section 6)

**Interfaces:**
- Consumes: all prior report sections + `docs/reports/data/2026-07-20-sim-full.json`.
- Produces: the go/no-go recommendation the user decides on (ML-track gate).

- [ ] **Step 1: Re-run everything from clean**

```bash
npm test && npm run typecheck && SIM=1 npm run test:sim
```

Expected: PASS across the board (unit + property + conformance + analyze + E2E + gated sims). Paste the final test count into report section 1.

- [ ] **Step 2: Write section 6 — findings & recommendation**

Structure (fill with the real numbers — no hedging, cite the data file):

```markdown
## 6. Findings & recommendation

### Engine correctness verdict
<one paragraph: suites + conformance + sim invariants all green / list any findings>

### RESIGN diagnosis
<the classified numbers from section 4, and the causal story: e.g. "all forced resigns
had engineLegalMoves > 0 and rejection reason 'two-square rule violation' — the engine
is correct; bots are blind to recentMoves and re-propose the banned oscillation">

### Go/no-go recommendation for the bot fix
Options for the user to decide (ML-track spec, Task 1 deliverable):
- **A (recommended if diagnosis confirms bot blindness):** expose the viewer's own
  `recentMoves` in `PlayerView` and filter two-square moves in `legalMovesFromView`
  — small, additive, kills the forced-resign class; ALSO improves ML observation
  quality (the model needs to see its own oscillation history to respect the rule).
- **B:** leave as-is; RESIGN games still carry a win/loss signal for training.
- <adjust/add options if the data says otherwise>

### Impact on the ML track
<one paragraph: is the engine trustworthy as training ground truth? any caveats for
the Task 2 research memo / Task 3 port (e.g. test-vector generation should include
forced-resign seeds as regression cases)>
```

- [ ] **Step 3: Commit and present to user**

```bash
git add docs/reports/2026-07-20-engine-verification.md
git commit -m "docs: engine verification findings + resign diagnosis + go/no-go recommendation"
```

Then report back to the user with: total test count, the four-pairing headline stats, the RESIGN diagnosis in two sentences, and the go/no-go question. **The user decides the fix before ML Task 2 begins** — do not implement option A (it touches `src/engine/redact.ts`, which is out of scope for this plan).

---

## Self-review (done at authoring time)

- **Spec coverage:** existing suites (Task 1) ✓; ≥2,000-game batch with distribution stats (Task 5) ✓; rules-conformance scenarios incl. Spy both directions, Scout move-and-strike, Miner/Bomb, two-square, lakes, flag capture, no-moves, both draw policies (Task 2) ✓; CLI E2E incl. malformed input and resign paths (Task 4) ✓; RESIGN classification + report + go/no-go (Tasks 3/5/6) ✓.
- **Placeholder scan:** report templates intentionally contain `<fill>` markers to be replaced with *measured* values at execution time; every code step is complete.
- **Type consistency:** `GameRecord`/`BatchStats`/`ForcedResignInfo` names match between Task 3 (definition) and Task 5 (consumption); engine imports all exist in `src/engine/index.ts`.
- **Known judgment calls flagged inline:** Scout-vs-Miner combat expectation (Task 2 Step 1 note), `move e5 e7` rejection scenario (Task 4 Step 4 note).
