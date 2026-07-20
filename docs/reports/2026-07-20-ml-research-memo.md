# ML Research Memo — Algorithm Choice for the Stratego Bot (Task 2)

**Date:** 2026-07-20
**Method:** web deep-research run — 5 search angles, 23 sources fetched, 114 claims extracted, top 25 adversarially verified (3 skeptic votes each): 21 confirmed, 4 refuted.
**Decision made here:** training algorithm, observation/action encoding, network size, training budget, expected strength, difficulty tiers.

## Recommendation

**PPO self-play with a past-checkpoint league and a high entropy floor.** The going-in prior (model-free PPO self-play over MCTS-style search) is **confirmed, with one required modification**: never train against only the latest self — sample opponents from a pool of frozen past checkpoints, and run entropy regularization far above library defaults (coefficient 0.05–0.2 vs the usual 0–0.01).

The runner-up worth keeping in mind: **MMD (magnetic mirror descent)** — PPO plus a mirror-descent regularizer, the other top performer in the key benchmark. It adds R-NaD-flavored anti-cycling at near-zero implementation cost and is a drop-in upgrade if plain PPO+league shows cycling in the Elo ladder.

## Why this algorithm (verified findings)

1. **Model-free self-play is the established SOTA for Stratego.** DeepNash (Science 2022, arXiv:2206.15378) reached human-expert level (84% vs Gravon experts, 97% vs prior bots) from scratch with **no search** and no explicit opponent-state modeling. [3-0 verified]
2. **Search is structurally handicapped here.** Stratego's game tree is ~10^535 nodes (10^175× Go), but the binding constraint is imperfect information: MCTS needs the true state, and Stratego can't be decomposed into poker-style subgames. [3-0]
3. **Determinization doesn't rescue search.** PIMC-style sampling suffers two error types that persist regardless of sample count — strategy fusion and non-locality (Frank & Basin; verified in Cowling et al. 2012 and Long et al. AAAI 2010). Determinized AlphaZero ("AlphaZe\*\*", Frontiers 2023) needed **25,000 search nodes per move** to hit ~60% vs heuristic bots in 8-piece Barrage, and still lost 84–96% vs an equilibrium-seeking opponent. That inference cost alone disqualifies search on an M1 Air. [3-0]
4. **Fancy game-theoretic algorithms don't beat tuned PPO.** The largest exploitability comparison of DRL algorithms in imperfect-info games (Rudolph et al., ICLR 2026, arXiv:2502.08938 — 7,000 runs, 345k CPU-hours) found NFSP, PSRO, ESCHER, and R-NaD **fail to outperform properly tuned generic policy-gradient methods** (MMD, PPO, PPG). Actionable detail: best entropy coefficients were 0.05–0.2. NFSP adds dual networks + reservoir buffers for no payoff at this scale. [2-1/3-0]
5. **Naive self-play is a proven failure mode.** Policy-gradient self-play dynamics "generally cycle, diverge or exhibit chaotic behavior" in imperfect-info games; greedy deterministic best-response (DQN-style) produces highly exploitable strategies. The league + entropy floor is the hobby-scale stand-in for R-NaD's regularizer. League-based PPO (OpenAI Five, AlphaStar) achieves strong practical play despite lacking Nash guarantees — and practical strength, not equilibrium, is our bar. [3-0]

## Design decisions

### Observation encoding (~50 stacked 10×10 planes)
- Own pieces: one-hot rank × 12 planes; own-revealed flag plane.
- Opponent pieces: unknown-unmoved, unknown-moved, and revealed-rank × 12 planes (moved/unmoved matters: unmoved = bomb/flag-likely).
- Static: lake mask.
- Scalars broadcast as planes: remaining piece counts per rank (both sides), ply count / move-cap fraction.
- History: last-k moves (k≈4) as from/to planes — `PlayerView.myRecentMoves` already exposes own history; opponent public moves come from observed transitions.

### Action encoding (factorized, DeepNash-style simplified)
DeepNash's verified interface is a shared torso + four heads (value, deployment, piece-select 10×10, displacement). Hobby simplification: **two policy heads — select-square (100) × move (36 = 4 directions × up to 9 scout steps) — with legality masking** from `legalMovesFromView`-equivalent logic. Deployment phase: start with a curated setup pool (the existing presets + random), not a learned placement head; revisit only if the league starts memorizing setups.

### Network (~1–3M parameters)
6–8 block ResNet CNN, 64–96 channels, policy + value heads. Trivial for 8GB unified memory; exports cleanly to ONNX for `onnxruntime-node` in the TS CLI (Task 5).

### Training loop
- League: pool of 5–10 frozen checkpoints; each game samples opponent = 50% latest / 50% past-checkpoint.
- Entropy coefficient 0.05–0.2 (tune within this band, not below it).
- Reward: sparse ±1 terminal only, plus small per-move penalty; hard move cap with draws scored slightly negative **for both** (blocks draw-farming); no capture-bonus shaping initially (known bias risk).
- Eval ladder (Task 4): Elo vs random, heuristic (~84% vs random since b3c9534), and past checkpoints; monitor game-length/outcome distributions for degeneracy.

### Budget & expected strength (engineering estimates — no verified source; revise after profiling)
- ~100k–500k self-play games, ~1–3 weeks of intermittent M1 wall-clock.
- Bottleneck is Python engine throughput, not the net: vectorize the Task 3 port; target >100 moves/sec/env. Profiling the port is the first open question below.
- Expected: **60–80% vs the strengthened heuristic bot** after a full run. The ">90% vs heuristic" Task 4 exit bar may require the full budget plus iteration — treat 90% as the exit criterion, 60–80% as the mid-training checkpoint expectation.

### Difficulty tiers (free artifacts of training — confirms compose-naturally)
- **Easy:** early checkpoint + softmax temperature ≈2 + 20% ε-random blending.
- **Medium:** mid-training checkpoint at T=1.
- **Hard:** final checkpoint at T→0 (argmax).
Checkpoints are Elo-rated by the league ladder anyway; pick tiers by target Elo. All inference-time — no extra training.

## Honest caveats (from adversarial verification)

- **Scale extrapolation is the central weakness.** The pro-PPO benchmark used games with millions of infostates — vastly smaller than Stratego. The anti-search evidence is DeepMind's framing plus 8-piece Barrage experiments, not full-Stratego head-to-heads.
- **Refuted claims (0-3 / 1-2 votes) — do not cite these:** (a) the TAG-framework claim that hobby-scale PPO beats MCTS at Stratego with 0.88 win rate; (b) "ISMCTS wins across all test domains"; (c) "Stratego's low-disambiguation regime specifically dooms PIMC" (the property framework is sound; its application to Stratego is inference); (d) a survey's garbled restatement of DeepNash's Gravon ranking.
- "Fail to outperform" in the ICLR benchmark means **parity**, not PPO superiority — the case for PPO is simplicity at equal strength, not dominance.
- R-NaD's Nash guarantee applies to idealized dynamics, not the deep instantiation; DeepNash needed datacenter compute irrelevant to an M1 Air.

## Open questions (feed into Task 3/4 specs)

1. Actual Python-port throughput on the M1 Air — does the 100k+ game budget need vectorization or a native extension?
2. Plain PPO vs MMD for the anti-cycling regularizer?
3. Curated setup pool vs learned deployment head?
4. Does sparse reward + move cap + draw penalty actually prevent degeneracy at this scale, or will shaped rewards be needed?

## Key sources

- DeepNash / R-NaD: arXiv:2206.15378 (Science 2022); DeepMind blog "Mastering Stratego".
- PPO vs game-theoretic DRL: Rudolph et al., arXiv:2502.08938 (ICLR 2026).
- ISMCTS & determinization failures: Cowling, Powley & Whitehouse 2012 (IEEE T-CIAIG); Long et al. AAAI 2010 (PIMC).
- Determinized AlphaZero at Stratego/Barrage: "AlphaZe\*\*", Frontiers in AI 2023.
- NFSP: Heinrich & Silver, arXiv:1603.01121.
- Self-play survey (cycling, league play): arXiv:2408.01072.
