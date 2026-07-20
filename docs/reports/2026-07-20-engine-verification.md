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

_(filled by Task 2)_

## 3. Large-batch simulation statistics

_(filled by Task 5)_

## 4. RESIGN investigation

_(filled by Task 5)_

## 5. CLI E2E

_(filled by Task 4)_

## 6. Findings & recommendation

_(filled by Task 6)_
