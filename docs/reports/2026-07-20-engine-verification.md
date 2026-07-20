# Engine Verification Report — 2026-07-20

Pre-ML gate for the ML track (spec: docs/superpowers/specs/2026-07-20-ml-track-design.md, Task 1).

## 1. Baseline suites

| Check | Result |
| --- | --- |
| `npm test` (unit + property) | PASS, 73 tests |
| `npm run typecheck` | TYPECHECK_OK |
| `SIM=1 npm run test:sim` | PASS, 2 tests |
| `npm run sim` (200 games, heuristic vs random) | `{ redWins: 81, blueWins: 119, draws: 0, avgPlies: 156.305, reasons: { FLAG_CAPTURED: 88, RESIGN: 112 } }` |

## 2. Rules-conformance scenarios

`test/conformance/rules.test.ts` — 22 scenarios, all pass (also included in `npm test`'s 95).
Added `test/conformance/**/*.test.ts` to `vitest.config.ts`'s `include` list so `npm test` picks
up the suite (it was omitted from the original include globs).

| describe block | scenarios | result |
| --- | --- | --- |
| `combat table` | Spy beats Marshal (attacker only); Marshal beats Spy when Marshal attacks; Spy loses to anything else; equal ranks → BOTH die; both combatants permanently revealed after a strike | 5/5 PASS |
| `bombs and miners` | non-Miner dies to Bomb, Bomb stays; Miner defuses Bomb and moves in; Bombs/Flags cannot move | 3/3 PASS |
| `movement` | non-Scout can't move 2 squares or diagonally; can't move onto own piece; Scout slides any open distance; Scout multi-square move reveals it; Scout can't jump a piece; Scout move-and-strike hits first occupied square; lakes block movement and Scout lines | 7/7 PASS |
| `two-square rule` | third consecutive a↔b traversal rejected, other moves stay legal; a strike clears the mover's oscillation history | 2/2 PASS |
| `end conditions` | flag capture → immediate FLAG_CAPTURED win; no legal action → NO_MOVES loss; neither side movable → DEAD_POSITION draw; ply cap → PLY_CAP draw; actions after GAME_OVER rejected | 5/5 PASS |

**Test corrections (2, both fixed in the test — no engine changes):**

1. **Scout move-and-strike expected outcome** (brief-flagged). `src/engine/pieceDefs.ts` gives
   `SCOUT=2`, `MINER=3`, so MINER outranks SCOUT. Changed the assertion from `'ATTACKER'` to
   `'DEFENDER'`; the scenario still proves a strike happens at the first occupied square instead
   of a rejection.
2. **"a strike resets the oscillation history"** (found during Step 2, not flagged in the brief).
   The brief's scenario made the strike itself the third consecutive a↔b traversal of the mover,
   so `validateAction`/`violatesTwoSquare` (`src/engine/rules.ts`, `src/engine/validate.ts`)
   rejects it on the from/to pattern alone, before the strike-clears-history line in
   `src/engine/reduce.ts` is ever reached. Checked this against the documented rule text —
   README.md ("Two-square rule": "a piece may not complete a third consecutive back-and-forth
   traversal of the same two squares", no capture exception) and
   `docs/superpowers/specs/2026-07-19-stratego-engine-design.md` line 87 — both state the rule
   with no carve-out for attacks, so the engine's rejection matches the documented spec; this is
   not an engine bug. Re-scoped the test: one quiet move builds a non-empty, non-violating
   history, then a strike to a *third* square is asserted to succeed and clear
   `recentMoves[mover]` to `[]`, isolating the reset behavior from the two-square check.

## 3. Large-batch simulation statistics

_(filled by Task 5)_

## 4. RESIGN investigation

_(filled by Task 5)_

## 5. CLI E2E

_(filled by Task 4)_

## 6. Findings & recommendation

_(filled by Task 6)_
