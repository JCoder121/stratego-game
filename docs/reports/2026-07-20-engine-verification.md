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

`src/sim/full.ts` (new; `npm run sim:full`) runs 4 pairings × 500 games (seeds 1000–1499 per
pairing) through `playGameDetailed` (Task 3's `src/sim/analyze.ts`, untouched) and writes
`docs/reports/data/2026-07-20-sim-full.json`. Smoke run (`GAMES=20 OUT=/dev/null npm run
sim:full`) passed first; full run completed cleanly. Sanity checks: every pairing's
`redWins + blueWins + draws === 500`; every pairing's `endedBy` values sum to 500. Both hold
for all 4 pairings below.

| pairing (RED vs BLUE) | redWins | blueWins | draws | reasons | plies p50 / p90 / max |
| --- | --- | --- | --- | --- | --- |
| random vs random | 258 | 241 | 1 | FLAG_CAPTURED 218, RESIGN 262, NO_MOVES 19, PLY_CAP 1 | 262 / 1030 / 2000 |
| heuristic vs random | 183 | 317 | 0 | FLAG_CAPTURED 229, RESIGN 268, NO_MOVES 3 | 155 / 260 / 481 |
| random vs heuristic | 308 | 192 | 0 | FLAG_CAPTURED 222, RESIGN 276, NO_MOVES 2 | 155 / 261 / 389 |
| heuristic vs heuristic | 251 | 249 | 0 | FLAG_CAPTURED 270, RESIGN 230 | 111 / 190 / 272 |

**Unexpected result, flagged rather than silently accepted:** the brief's sanity check expected
"heuristic-vs-random pairings show heuristic winning a clear majority." The data shows the
opposite in both color arrangements: heuristic-RED beats random-BLUE only 183/500 (36.6%),
and random-RED beats heuristic-BLUE 308/500 (61.6%) — i.e. **random wins the majority against
heuristic regardless of which side plays it.** This isn't a fluke of one run: it also matches the
existing Task 1 baseline in Section 1 (`npm run sim`, heuristic=RED vs random=BLUE, 200 games:
redWins 81 / blueWins 119 — random already won there too). Root cause (read-only inspection of
`src/bots/heuristic.ts`, not modified): step 3 of the heuristic ("forward-biased random") pulls
from `legalMovesFromView`, which includes attack moves onto squares occupied by *unknown-rank*
enemies. Because the heuristic always prefers a forward move when one exists, it marches
aggressively into unrevealed enemy territory — including unknown Bombs — far more consistently
than `randomBot`, which picks uniformly among all 4 directions. This is a bot-strategy weakness,
not an engine bug (`src/bots/**` is not in this task's read-only scope, but no bot code was
changed — verification only). Flagging for Task 6 / future bot tuning, not blocking this task.

## 4. RESIGN investigation

**Aggregate:** across all 2,000 games, RESIGN ends 1,036 games (51.8%). Every single one of
those 1,036 is `FORCED_RESIGN` — `BOT_RESIGN` is **0** in all four pairings' `endedBy` breakdown.
In other words, in this dataset no bot ever chose the `RESIGN` action itself; `RESIGN` only
appears as the engine's fallback after a bot fails 5 straight action attempts.

| pairing | RESIGN share of games | BOT_RESIGN | FORCED_RESIGN |
| --- | --- | --- | --- |
| random vs random | 262/500 (52.4%) | 0 | 262 |
| heuristic vs random | 268/500 (53.6%) | 0 | 268 |
| random vs heuristic | 276/500 (55.2%) | 0 | 276 |
| heuristic vs heuristic | 230/500 (46.0%) | 0 | 230 |
| **total** | **1036/2000 (51.8%)** | **0** | **1036** |

**Forced-resign forensics — `engineLegalMoves` at the moment of forced resign:**

| pairing | forcedWithMovesLeft (>0) | forcedWithNoMoves (=0) |
| --- | --- | --- |
| random vs random | 262 | 0 |
| heuristic vs random | 268 | 0 |
| random vs heuristic | 276 | 0 |
| heuristic vs heuristic | 230 | 0 |
| **total** | **1036** | **0** |

`forcedWithNoMoves` is 0 in every pairing — no forced resign happened with zero engine-legal
moves, so the CRITICAL escalation condition (which would indicate the engine should have ended
the game via `NO_MOVES` first) never triggered. No STOP / no engine bug found.

**`forcedResignReasons` distribution:** in all four pairings, the *only* rejection reason ever
recorded is `"two-square rule violation"` — 262 / 268 / 276 / 230 games respectively (1,036/1,036
forced resigns, 100%). No other rejection reason (e.g. malformed move, occupied-by-own-piece,
out-of-bounds) appears anywhere in the dataset.

**Confirms the prior v1 hypothesis, with numbers.** The v1 build's suspicion — bots are blind to
`recentMoves` (the two-square rule) and get stuck retrying the same illegal oscillation until the
engine gives up and forces a resign — is confirmed exactly, not just "consistent with": 100% of
forced resigns are attributable to the two-square rule, and 100% of those had legal alternative
moves available (`engineLegalMoves` > 0, up to 27 in the samples below) that neither bot's
5-attempt retry loop ever found, because neither `randomBot` nor `heuristicBot` consults
`view`/`recentMoves` at all before proposing a move — they just resample from the same static
`legalMovesFromView` list, which doesn't filter out two-square violations. Aggregate 51.8% RESIGN
share is in the same range as the v1 build's ~56% observation (the earlier number likely came
from more heuristic-heavy pairings; heuristic-vs-heuristic here is actually the *lowest*-RESIGN
pairing at 46.0%, since more decisive FLAG_CAPTURED endings cut games short before oscillation
has time to recur).

**Sample forced-resign seeds, replayed by hand** (`playGameDetailed`, scratch script in
`.superpowers/sdd/`, run and deleted — not committed, per task instructions):

1. **heuristic vs heuristic, seed 1000** — RED wins by RESIGN at ply 175 (RED 10 survivors, BLUE
   24): BLUE's heuristic bot had 27 engine-legal moves on the board but all 5 retry attempts (its
   own resampled proposals) hit `"two-square rule violation"`, so the engine forced BLUE to
   resign despite BLUE holding more than double RED's remaining pieces.
2. **heuristic(RED) vs random(BLUE), seed 1000** — BLUE wins by RESIGN at ply 252 (RED 8
   survivors, BLUE 21): RED's heuristic bot, with 12 legal engine moves on the table, spent all 5
   attempts proposing two-square-violating moves and was force-resigned, handing BLUE the win
   from a clearly losing material position.
3. **random vs random, seed 1000** — BLUE wins by RESIGN at ply 170 (RED 21 survivors, BLUE 27):
   RED's random bot had only 7 legal engine moves left in an already-cramped, piece-down
   position, and by chance sampled a two-square-violating move on all 5 attempts, so the engine
   forced the resign — a legal (if losing) escape move existed but the naive uniform-random
   sampler never found it in 5 tries.

## 5. CLI E2E

`test/e2e/cli.test.ts` — black-box suite spawning `npx tsx src/cli/main.ts` with piped stdin,
7 scenarios, all pass (also included in `npm test`'s 105). Added `test/e2e/**/*.test.ts` to
`vitest.config.ts`'s `include` list, same as Task 2 did for `test/conformance`.

**CLI determinism (`src/cli/main.ts`):** added an opt-in `STRATEGO_SEED=<int>` env var that
swaps `makeRandom()` for `makeSeeded(Number(seedEnv))`; unset behavior (the default) is
unchanged. This makes both the bot's setup shuffle and its in-play move choice reproducible,
which the E2E suite's determinism test depends on.

| scenario | result |
| --- | --- |
| `help` prints command list; `quit` exits cleanly | PASS |
| unknown command and malformed squares produce error messages, not crashes | PASS |
| `setup preset balanced` + `done` starts play and renders the board | PASS |
| `setup random` + `done` also reaches play | PASS |
| a legal move is applied and the bot answers; `resign` ends the game (BLUE wins) | PASS |
| illegal move is rejected with a reason and the game continues to resign | PASS |
| deterministic under a fixed seed: identical transcripts across two runs | PASS |

**Adjustments vs. the brief (both flagged as possible in the brief; neither needed engine changes):**

1. **`move e5 e7` rejection scenario.** Ran as written and it passed on the first try — no
   adjustment needed. `e5` (`{r:5,c:4}`) is untouched by the preceding `move a4 a5` (column `a`
   only), so it's an empty no-man's-land square; the engine rejects a move from an empty source,
   the CLI prints `rejected: <reason>`, and the test only asserts the generic `rejected:` prefix
   (not a specific reason string), so it's robust to whichever validation reason fires first.
   Reworded the in-test comment to explain *why* e5 is empty rather than leaving the brief's
   stale "back-corner"/bombs framing (that language described a different from-square than the
   one actually used).
2. **Unused `cli`/`execFile` helper.** Removed entirely, per the brief's instruction — only
   `cliWithInput` (built on `child_process.spawn`) is used by any test, so the `execFile`-based
   `cli()` helper and its `promisify` import were dropped rather than kept dead.

Note: running the CLI (`npm run cli`) or the E2E suite requires filesystem access outside this
session's default sandbox — `tsx`'s child process opens an IPC pipe under `/tmp` — so both the
manual smoke test and `npx vitest run test/e2e/cli.test.ts` / `npm test` were run with the
sandbox disabled.

## 6. Findings & recommendation

_(filled by Task 6)_
