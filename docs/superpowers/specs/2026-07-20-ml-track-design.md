# Stratego ML Track — Design

**Date:** 2026-07-20
**Status:** Approved (interview 2026-07-20)
**Scope:** Verify the v1 engine end-to-end, then research, train, and integrate a machine-learning bot that decisively beats the current heuristic bot. Web UI, manual-placement UX, and visualization remain deferred (unchanged from the v1 roadmap).

## Goals

- **Verify before training:** the user has not personally tested v1; the engine must pass a full verification pass (beyond unit tests) before it becomes the ground truth for training data.
- **Train a model to play Stratego well.** Success bar for v1 of the ML track: **>90% win rate vs the heuristic bot**, with an Elo ladder (random / heuristic / model checkpoints) as the measurement instrument. "DeepNash-level optimal" is explicitly out of scope (billions of games, industrial compute).
- **Both play modes:** trained model must be playable human-vs-model (existing CLI) and model-vs-bot (existing sim harness).

## Key decisions (user interview)

| Decision | Choice |
|---|---|
| Training compute | Local M1 Air (8GB), scoped down — small nets, hours-scale runs. Can scale to other hardware later. |
| Language | **TS stays canonical** for engine/CLI/UI. **Python** (`ml/` subdir, same repo) for the training loop only — a parity-tested engine mirror. ONNX bridges trained models back to TS for inference (`onnxruntime-node`). |
| Success bar | Crush current bots (>90% vs heuristic, Elo ladder). |
| 56% RESIGN rate | Investigate during verification (Task 1), then user decides on a fix before ML work proceeds. |
| Testing style | Automated only; user reviews the test report (no manual playtest gate). |

**Why dual engines:** RL training needs millions of in-process engine steps next to PyTorch; a TS↔Python IPC bridge would cripple throughput, and TS-only training (tfjs-node) has no serious RL ecosystem. The v1 engine's design (pure total reducer, seeded RNG, JSON state, redacted `viewFor` views) was built for exactly this — the port is mechanical, and a parity harness (shared JSON test vectors, same seeds → identical state hashes) keeps the mirror honest.

## Task breakdown (each task = its own spec → plan → implementation cycle)

### Task 1 — Full engine verification (pre-ML gate)
- Run existing suites: 73 unit/property tests, typecheck, `SIM=1` gated sims.
- **Large-batch sims:** ≥2,000 seeded games across all bot pairings (random/heuristic × random/heuristic) and setup modes, with distribution stats: win/loss/draw/resign rates, game lengths, piece-survival profiles.
- **Rules-conformance scenarios:** scripted replays of every rulebook edge case — Spy vs Marshal (both attack directions), Scout move-and-strike, Miner/Bomb, two-square rule, lake blocking, flag capture, no-legal-move loss, both draw policies (ply cap, dead position).
- **CLI E2E:** piped-input full games, malformed input, resign/quit paths.
- **RESIGN investigation:** instrument sims to classify why ~56% of games end in RESIGN (two-square dead-ends); determine whether games are degenerate or bots are merely weak.
- **Deliverable:** test report + go/no-go recommendation on fixing bot move-history awareness. **User decides** before Task 2.

### Task 2 — ML research memo
- Survey imperfect-information game AI as applied to Stratego: DeepNash/R-NaD, ISMCTS + determinization, NFSP, PPO self-play with checkpoint leagues — each sized against 8GB M1 reality.
- Prior going in (to be confirmed or overturned by the memo): model-free self-play (small policy/value net, PPO + past-checkpoint league) over MCTS-style search, which published work suggests fails in Stratego.
- **Deliverable:** memo recommending algorithm, observation/action encoding, network size, training budget, and expected strength. Algorithm choice is made *here*, not earlier.

### Task 3 — Python engine port + parity harness
- `ml/` Python package mirroring `strategoReduce` and `viewFor`.
- TS side exports JSON test vectors (seeded games: action sequences + per-step state hashes); Python replays them and must match exactly. Parity suite runs in CI alongside the TS tests.
- Throughput benchmark (steps/sec) — must support the training budget from Task 2.

### Task 4 — Training pipeline v1
- Self-play generation, training loop, checkpointing, metrics — per the Task 2 memo.
- Eval ladder: Elo vs random bot, heuristic bot, and past model checkpoints.
- **Exit criterion:** >90% win rate vs heuristic bot (both colors, across setup modes).

### Task 5 — Integration
- Export trained model to ONNX; new TS bot backed by `onnxruntime-node` implementing the existing bot interface over redacted views.
- Human-vs-model via existing CLI; model-vs-bot in the sim harness; document how to pick a checkpoint.

## Error handling & risks

- **Parity drift** (biggest correctness risk): any TS engine change must regenerate test vectors; parity suite failure blocks training.
- **Degenerate self-play** (resign loops, draw farming): Task 1's investigation feeds this; eval ladder + game-length/outcome distribution monitoring in Task 4 detects it.
- **8GB memory ceiling:** small nets, small replay buffers, gradient accumulation; if a wall is hit, fall back to user's Windows GPU box or cloud (explicitly deferred, not designed here).

## Out of scope

Web UI, manual-placement UX, visualization, tournament variants, captured-pile view — all remain deferred per the v1 roadmap.
