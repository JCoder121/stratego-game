# Stratego Engine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A faithful, terminal-first Stratego game engine with bot-vs-bot simulations and interactive human-vs-bot play, built for future web UI and ML self-play.

**Architecture:** A pure, total reducer core — `strategoReduce(state, action) → {state, events}` — that never throws or mutates and emits a discriminated-union event stream. Per-rank behavior lives in a `PIECE_DEFS` registry. Hidden information is handled by a `redact` projection so bots/CLI/future-ML consume only what a player may legally see. All randomness is injected via an `Rng` interface; state is plain JSON for free save/replay.

**Tech Stack:** TypeScript (strict, ESM, no build — run via `tsx`), Vitest 2 (unit + property), fast-check 3, Node 20+. These were chosen on merit for a deterministic replayable engine; they happen to match the sibling `../craps` project but are not copied wholesale — differences (attack-as-MOVE, hidden-info redaction, setup phase) are Stratego-specific.

## Global Constraints

- TypeScript strict mode + `noUncheckedIndexedAccess`; `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `noEmit`. ESM everywhere (`"type":"module"`); intra-repo imports use explicit `.js` extensions.
- The `engine/` layer imports nothing from `cli/`, `bots/`, or `sim/` and contains no I/O, no clock, and no randomness. All randomness enters through the injected `Rng` interface or through action payloads.
- `strategoReduce` is **total**: it never throws and never mutates its input. Any malformed or illegal action returns the unchanged state plus exactly one `REJECTED` event with a human-readable `reason`.
- `GameState` and all events/actions are plain JSON (no classes, no `Map`/`Set`, no functions): `JSON.parse(JSON.stringify(state))` is a complete save.
- Bots and CLI rendering consume only `PlayerView` (redacted). Full `GameState` never reaches a bot.
- Board is 10×10. Coordinates are `{ r, c }` with `r` 0–9 top-to-bottom, `c` 0–9 left-to-right. Row 0 is Blue's back row; row 9 is Red's back row. Red moves first.
- Lakes (0-indexed): rows 4–5, columns 2–3 and 6–7 (the standard two 2×2 lakes).
- Board rendering and all rank comparisons: higher `rankValue` wins except the documented Spy/Bomb/Flag special cases.
- Commit after every task with a `feat:`/`test:`/`chore:` message. Do not push (no remote yet).

---

## File Structure

```
stratego/
  package.json, tsconfig.json, vitest.config.ts, .gitignore
  src/
    engine/
      types.ts        # all domain types + Action/GameEvent unions + constants
      board.ts        # geometry: in-bounds, lakes, adjacency, ray-cast, coord<->algebraic
      pieceDefs.ts    # PIECE_DEFS registry: per-rank rankValue, mobility, combat
      combat.ts       # resolveCombat(attacker, defender) → outcome
      init.ts         # createGame(config) → SETUP state; roster helpers
      setups.ts       # preset formations + random placement + setup legality
      moves.ts        # legalMovesFor(state, pieceId) and legalActions(state)
      rules.ts        # two-square rule, win/draw detection
      validate.ts     # validateAction(state, action) → reason | null
      reduce.ts       # strategoReduce(state, action) → {state, events}
      redact.ts       # viewFor(state, color) → PlayerView
      index.ts        # barrel
    rng/
      rng.ts          # Rng interface, makeSeeded(seed), makeRandom()
    bots/
      types.ts        # Bot type
      random.ts       # random legal-action bot
      heuristic.ts    # simple heuristic bot
    cli/
      main.ts, parse.ts, render.ts
    sim/
      run.ts          # bot-vs-bot harness + stats
  test/
    unit/             # one file per engine module
    property/         # arbitraries.ts + invariants.test.ts
    sim/              # env-gated long self-play (SIM=1)
```

---

## Task 1: Project scaffold

**Files:**
- Create: `stratego/package.json`, `stratego/tsconfig.json`, `stratego/vitest.config.ts`, `stratego/.gitignore`
- Create: `stratego/src/engine/index.ts` (temporary stub), `stratego/test/unit/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` / `npm run typecheck` toolchain.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "stratego-engine",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:sim": "SIM=1 vitest run test/sim",
    "typecheck": "tsc --noEmit",
    "cli": "tsx src/cli/main.ts",
    "sim": "tsx src/sim/run.ts"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "fast-check": "^3.19.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`** (env-gated sim suite, mirroring the spec)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.SIM
      ? ['test/sim/**/*.test.ts']
      : ['test/unit/**/*.test.ts', 'test/property/**/*.test.ts'],
    testTimeout: process.env.SIM ? 300_000 : 10_000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 5: Create temporary barrel + smoke test**

`src/engine/index.ts`:
```ts
export const ENGINE_VERSION = '0.1.0';
```

`test/unit/smoke.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { ENGINE_VERSION } from '../../src/engine/index.js';

describe('scaffold', () => {
  test('engine barrel exports a version', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 6: Install and verify**

Run: `cd stratego && npm install && npm run typecheck && npm test`
Expected: typecheck clean; 1 test passing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold stratego engine project"
```

---

## Task 2: Domain types & constants

**Files:**
- Create: `src/engine/types.ts`
- Test: `test/unit/types.test.ts`

**Interfaces:**
- Produces:
  - `type Color = 'RED' | 'BLUE'`
  - `type Rank = 'MARSHAL' | 'GENERAL' | 'COLONEL' | 'MAJOR' | 'CAPTAIN' | 'LIEUTENANT' | 'SERGEANT' | 'MINER' | 'SCOUT' | 'SPY' | 'BOMB' | 'FLAG'`
  - `interface Square { r: number; c: number }`
  - `type PieceId = string` (e.g. `'RED-MARSHAL-0'`)
  - `interface Piece { id: PieceId; owner: Color; rank: Rank; revealed: boolean; pos: Square | null }` (`pos: null` ⇒ captured)
  - `type Phase = 'SETUP' | 'PLAY' | 'GAME_OVER'`
  - `interface GameConfig { maxPlies: number; seed?: number }`
  - `type MoveRecord = { pieceId: PieceId; from: Square; to: Square }`
  - `interface GameResult { winner: Color | null; reason: 'FLAG_CAPTURED' | 'NO_MOVES' | 'RESIGN' | 'PLY_CAP' | 'DEAD_POSITION' }` (`winner: null` ⇒ draw)
  - `interface GameState { config: GameConfig; phase: Phase; turn: Color; plyCount: number; pieces: Record<PieceId, Piece>; setupDone: Record<Color, boolean>; recentMoves: Record<PieceId, MoveRecord[]>; result: GameResult | null }`
  - `Action` union (see Step 1) and `GameEvent` union (see Step 2).
  - Constants: `ROSTER: Record<Rank, number>`, `RANKS: Rank[]`, `BOARD_SIZE = 10`, `LAKES: Square[]`, `SETUP_ROWS: Record<Color, number[]>`, `DEFAULT_MAX_PLIES = 2000`.

- [ ] **Step 1: Write `types.ts`**

```ts
export type Color = 'RED' | 'BLUE';

export type Rank =
  | 'MARSHAL' | 'GENERAL' | 'COLONEL' | 'MAJOR' | 'CAPTAIN'
  | 'LIEUTENANT' | 'SERGEANT' | 'MINER' | 'SCOUT' | 'SPY'
  | 'BOMB' | 'FLAG';

export interface Square { r: number; c: number }
export type PieceId = string;

export interface Piece {
  id: PieceId;
  owner: Color;
  rank: Rank;
  revealed: boolean;
  pos: Square | null; // null ⇒ captured/off-board
}

export type Phase = 'SETUP' | 'PLAY' | 'GAME_OVER';

export interface GameConfig { maxPlies: number; seed?: number }

export type MoveRecord = { pieceId: PieceId; from: Square; to: Square };

export interface GameResult {
  winner: Color | null; // null ⇒ draw
  reason: 'FLAG_CAPTURED' | 'NO_MOVES' | 'RESIGN' | 'PLY_CAP' | 'DEAD_POSITION';
}

export interface GameState {
  config: GameConfig;
  phase: Phase;
  turn: Color;
  plyCount: number;
  pieces: Record<PieceId, Piece>;
  setupDone: Record<Color, boolean>;
  recentMoves: Record<PieceId, MoveRecord[]>;
  result: GameResult | null;
}

// ---- Actions (input) ----
export type Action =
  | { type: 'SETUP_PLACE'; color: Color; pieceId: PieceId; to: Square }
  | { type: 'SETUP_PRESET'; color: Color; preset: string }
  | { type: 'SETUP_RANDOM'; color: Color; order: PieceId[] } // order = shuffled placement supplied by shell
  | { type: 'SETUP_DONE'; color: Color }
  | { type: 'MOVE'; color: Color; from: Square; to: Square } // attack = MOVE onto enemy square
  | { type: 'RESIGN'; color: Color };

// ---- Events (output) ----
export type GameEvent =
  | { type: 'SETUP_PLACED'; color: Color; pieceId: PieceId; to: Square }
  | { type: 'SETUP_CLEARED'; color: Color }
  | { type: 'SETUP_COMPLETED'; color: Color }
  | { type: 'PLAY_STARTED' }
  | { type: 'PIECE_MOVED'; pieceId: PieceId; from: Square; to: Square }
  | { type: 'STRIKE'; attacker: PieceId; defender: PieceId; attackerRank: Rank; defenderRank: Rank; outcome: 'ATTACKER' | 'DEFENDER' | 'BOTH' }
  | { type: 'PIECE_CAPTURED'; pieceId: PieceId }
  | { type: 'BOMB_DEFUSED'; bombId: PieceId; minerId: PieceId }
  | { type: 'FLAG_CAPTURED'; flagId: PieceId; by: PieceId }
  | { type: 'TURN_PASSED'; to: Color }
  | { type: 'GAME_OVER'; result: GameResult }
  | { type: 'REJECTED'; reason: string };

// ---- Constants ----
export const BOARD_SIZE = 10;
export const DEFAULT_MAX_PLIES = 2000;

export const RANKS: Rank[] = [
  'MARSHAL', 'GENERAL', 'COLONEL', 'MAJOR', 'CAPTAIN',
  'LIEUTENANT', 'SERGEANT', 'MINER', 'SCOUT', 'SPY', 'BOMB', 'FLAG',
];

export const ROSTER: Record<Rank, number> = {
  MARSHAL: 1, GENERAL: 1, COLONEL: 2, MAJOR: 3, CAPTAIN: 4,
  LIEUTENANT: 4, SERGEANT: 4, MINER: 5, SCOUT: 8, SPY: 1,
  BOMB: 6, FLAG: 1,
};

// Standard two 2x2 lakes (0-indexed): rows 4-5, cols 2-3 and 6-7.
export const LAKES: Square[] = [
  { r: 4, c: 2 }, { r: 4, c: 3 }, { r: 5, c: 2 }, { r: 5, c: 3 },
  { r: 4, c: 6 }, { r: 4, c: 7 }, { r: 5, c: 6 }, { r: 5, c: 7 },
];

// Row 0 = Blue back row, row 9 = Red back row. Each player fills their back 4 rows.
export const SETUP_ROWS: Record<Color, number[]> = {
  BLUE: [0, 1, 2, 3],
  RED: [6, 7, 8, 9],
};
```

- [ ] **Step 2: Write `test/unit/types.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { ROSTER, RANKS, LAKES, SETUP_ROWS } from '../../src/engine/types.js';

describe('constants', () => {
  test('roster sums to 40 pieces', () => {
    const total = Object.values(ROSTER).reduce((a, b) => a + b, 0);
    expect(total).toBe(40);
  });
  test('roster has all 12 ranks', () => {
    expect(RANKS).toHaveLength(12);
    for (const r of RANKS) expect(ROSTER[r]).toBeGreaterThan(0);
  });
  test('33 movable pieces (excludes 6 bombs + 1 flag)', () => {
    const movable = RANKS.filter((r) => r !== 'BOMB' && r !== 'FLAG')
      .reduce((a, r) => a + ROSTER[r], 0);
    expect(movable).toBe(33);
  });
  test('two 2x2 lakes = 8 squares, no overlap with setup rows', () => {
    expect(LAKES).toHaveLength(8);
    const setupRows = new Set([...SETUP_ROWS.RED, ...SETUP_ROWS.BLUE]);
    for (const l of LAKES) expect(setupRows.has(l.r)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- types`
Expected: PASS (roster totals 40, 33 movable, lakes valid).

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts test/unit/types.test.ts
git commit -m "feat: domain types, roster, board constants"
```

---

## Task 3: Board geometry

**Files:**
- Create: `src/engine/board.ts`
- Test: `test/unit/board.test.ts`

**Interfaces:**
- Consumes: `Square`, `LAKES`, `BOARD_SIZE` from `types.ts`.
- Produces:
  - `inBounds(sq: Square): boolean`
  - `isLake(sq: Square): boolean`
  - `sameSquare(a: Square, b: Square): boolean`
  - `isAdjacent(a: Square, b: Square): boolean` (orthogonal, distance 1)
  - `stepsBetween(a: Square, b: Square): Square[] | null` — squares strictly between `a` and `b` along a straight orthogonal line, or `null` if not on a straight orthogonal line. Empty array if adjacent.
  - `toAlg(sq: Square): string` (e.g. `{r:9,c:0}` → `'a1'`, `{r:0,c:0}` → `'a10'`) and `fromAlg(s: string): Square | null`.

- [ ] **Step 1: Write failing test `test/unit/board.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { inBounds, isLake, isAdjacent, stepsBetween, toAlg, fromAlg } from '../../src/engine/board.js';

describe('board geometry', () => {
  test('inBounds', () => {
    expect(inBounds({ r: 0, c: 0 })).toBe(true);
    expect(inBounds({ r: 9, c: 9 })).toBe(true);
    expect(inBounds({ r: -1, c: 0 })).toBe(false);
    expect(inBounds({ r: 10, c: 0 })).toBe(false);
  });
  test('isLake matches the two 2x2 lakes', () => {
    expect(isLake({ r: 4, c: 2 })).toBe(true);
    expect(isLake({ r: 5, c: 7 })).toBe(true);
    expect(isLake({ r: 4, c: 4 })).toBe(false);
    expect(isLake({ r: 0, c: 0 })).toBe(false);
  });
  test('isAdjacent orthogonal only', () => {
    expect(isAdjacent({ r: 3, c: 3 }, { r: 3, c: 4 })).toBe(true);
    expect(isAdjacent({ r: 3, c: 3 }, { r: 4, c: 4 })).toBe(false); // diagonal
    expect(isAdjacent({ r: 3, c: 3 }, { r: 3, c: 5 })).toBe(false); // two away
  });
  test('stepsBetween returns interior squares on a straight line', () => {
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 3 })).toEqual([{ r: 0, c: 1 }, { r: 0, c: 2 }]);
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 1 })).toEqual([]);
    expect(stepsBetween({ r: 0, c: 0 }, { r: 3, c: 3 })).toBeNull(); // diagonal
    expect(stepsBetween({ r: 0, c: 0 }, { r: 0, c: 0 })).toBeNull(); // same square
  });
  test('algebraic round-trip', () => {
    expect(toAlg({ r: 9, c: 0 })).toBe('a1');
    expect(toAlg({ r: 0, c: 0 })).toBe('a10');
    expect(fromAlg('a1')).toEqual({ r: 9, c: 0 });
    expect(fromAlg('j10')).toEqual({ r: 0, c: 9 });
    expect(fromAlg('z9')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- board`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/board.ts`**

```ts
import { BOARD_SIZE, LAKES, type Square } from './types.js';

export function inBounds(sq: Square): boolean {
  return sq.r >= 0 && sq.r < BOARD_SIZE && sq.c >= 0 && sq.c < BOARD_SIZE;
}

export function isLake(sq: Square): boolean {
  return LAKES.some((l) => l.r === sq.r && l.c === sq.c);
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.r === b.r && a.c === b.c;
}

export function isAdjacent(a: Square, b: Square): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return dr + dc === 1;
}

// Interior squares strictly between a and b along a straight orthogonal line.
// null if not colinear orthogonally or same square.
export function stepsBetween(a: Square, b: Square): Square[] | null {
  if (sameSquare(a, b)) return null;
  if (a.r !== b.r && a.c !== b.c) return null;
  const out: Square[] = [];
  if (a.r === b.r) {
    const step = b.c > a.c ? 1 : -1;
    for (let c = a.c + step; c !== b.c; c += step) out.push({ r: a.r, c });
  } else {
    const step = b.r > a.r ? 1 : -1;
    for (let r = a.r + step; r !== b.r; r += step) out.push({ r, c: a.c });
  }
  return out;
}

// Columns a..j (c 0..9); ranks 1..10 from Red's side (r 9 = rank 1, r 0 = rank 10).
export function toAlg(sq: Square): string {
  const file = String.fromCharCode('a'.charCodeAt(0) + sq.c);
  return `${file}${BOARD_SIZE - sq.r}`;
}

export function fromAlg(s: string): Square | null {
  const m = /^([a-j])(\d{1,2})$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  const c = m[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(m[2]);
  if (rank < 1 || rank > BOARD_SIZE) return null;
  const r = BOARD_SIZE - rank;
  return { r, c };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/board.ts test/unit/board.test.ts
git commit -m "feat: board geometry (bounds, lakes, adjacency, rays, algebraic)"
```

---

## Task 4: Piece registry & combat

**Files:**
- Create: `src/engine/pieceDefs.ts`, `src/engine/combat.ts`
- Test: `test/unit/combat.test.ts`

**Interfaces:**
- Consumes: `Rank`, `Piece` from `types.ts`.
- Produces:
  - In `pieceDefs.ts`: `interface PieceDef { rank: Rank; rankValue: number; movable: boolean; scout: boolean }` and `PIECE_DEFS: Record<Rank, PieceDef>`; helpers `rankValue(rank: Rank): number`, `isMovable(rank: Rank): boolean`, `isScout(rank: Rank): boolean`.
  - In `combat.ts`: `type CombatOutcome = 'ATTACKER' | 'DEFENDER' | 'BOTH'` and `resolveCombat(attacker: Rank, defender: Rank): CombatOutcome`.
- Combat rules (base): Spy defeats Marshal only when Spy is the attacker; any non-Miner attacking a Bomb loses (Bomb survives → `'DEFENDER'`); Miner defeats Bomb; attacker onto Flag always wins; equal movable ranks → `'BOTH'`; otherwise higher `rankValue` wins.

- [ ] **Step 1: Write failing test `test/unit/combat.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { resolveCombat } from '../../src/engine/combat.js';
import { rankValue } from '../../src/engine/pieceDefs.js';

describe('rankValue ordering', () => {
  test('marshal outranks general outranks scout', () => {
    expect(rankValue('MARSHAL')).toBeGreaterThan(rankValue('GENERAL'));
    expect(rankValue('GENERAL')).toBeGreaterThan(rankValue('SCOUT'));
  });
});

describe('resolveCombat', () => {
  test('higher rank wins as attacker or defender', () => {
    expect(resolveCombat('MARSHAL', 'GENERAL')).toBe('ATTACKER');
    expect(resolveCombat('GENERAL', 'MARSHAL')).toBe('DEFENDER');
  });
  test('equal movable ranks: both removed', () => {
    expect(resolveCombat('CAPTAIN', 'CAPTAIN')).toBe('BOTH');
  });
  test('spy attacks marshal and wins', () => {
    expect(resolveCombat('SPY', 'MARSHAL')).toBe('ATTACKER');
  });
  test('marshal attacks spy and wins', () => {
    expect(resolveCombat('MARSHAL', 'SPY')).toBe('ATTACKER');
  });
  test('spy loses to any non-marshal it attacks', () => {
    expect(resolveCombat('SPY', 'GENERAL')).toBe('DEFENDER');
    expect(resolveCombat('SPY', 'SCOUT')).toBe('DEFENDER');
  });
  test('miner defuses bomb', () => {
    expect(resolveCombat('MINER', 'BOMB')).toBe('ATTACKER');
  });
  test('non-miner dies to bomb, bomb survives', () => {
    expect(resolveCombat('MARSHAL', 'BOMB')).toBe('DEFENDER');
    expect(resolveCombat('SCOUT', 'BOMB')).toBe('DEFENDER');
    expect(resolveCombat('SPY', 'BOMB')).toBe('DEFENDER');
  });
  test('attacking the flag always wins', () => {
    expect(resolveCombat('SCOUT', 'FLAG')).toBe('ATTACKER');
    expect(resolveCombat('SPY', 'FLAG')).toBe('ATTACKER');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- combat`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/engine/pieceDefs.ts`**

```ts
import { RANKS, type Rank } from './types.js';

export interface PieceDef {
  rank: Rank;
  rankValue: number; // higher beats lower except special cases; Bomb/Flag = 0
  movable: boolean;
  scout: boolean;
}

const RANK_VALUES: Record<Rank, number> = {
  MARSHAL: 10, GENERAL: 9, COLONEL: 8, MAJOR: 7, CAPTAIN: 6,
  LIEUTENANT: 5, SERGEANT: 4, MINER: 3, SCOUT: 2, SPY: 1,
  BOMB: 0, FLAG: 0,
};

export const PIECE_DEFS: Record<Rank, PieceDef> = Object.fromEntries(
  RANKS.map((rank) => [
    rank,
    {
      rank,
      rankValue: RANK_VALUES[rank],
      movable: rank !== 'BOMB' && rank !== 'FLAG',
      scout: rank === 'SCOUT',
    },
  ]),
) as Record<Rank, PieceDef>;

export const rankValue = (rank: Rank): number => PIECE_DEFS[rank].rankValue;
export const isMovable = (rank: Rank): boolean => PIECE_DEFS[rank].movable;
export const isScout = (rank: Rank): boolean => PIECE_DEFS[rank].scout;
```

- [ ] **Step 4: Write `src/engine/combat.ts`**

```ts
import type { Rank } from './types.js';
import { rankValue } from './pieceDefs.js';

export type CombatOutcome = 'ATTACKER' | 'DEFENDER' | 'BOTH';

// attacker and defender are the ranks of the two pieces; attacker initiated.
export function resolveCombat(attacker: Rank, defender: Rank): CombatOutcome {
  if (defender === 'FLAG') return 'ATTACKER';
  if (defender === 'BOMB') return attacker === 'MINER' ? 'ATTACKER' : 'DEFENDER';
  if (attacker === 'SPY' && defender === 'MARSHAL') return 'ATTACKER';
  const av = rankValue(attacker);
  const dv = rankValue(defender);
  if (av === dv) return 'BOTH';
  return av > dv ? 'ATTACKER' : 'DEFENDER';
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- combat`
Expected: PASS (all pairings).

- [ ] **Step 6: Commit**

```bash
git add src/engine/pieceDefs.ts src/engine/combat.ts test/unit/combat.test.ts
git commit -m "feat: piece registry and combat resolution"
```

---

## Task 5: Game initialization & roster

**Files:**
- Create: `src/engine/init.ts`
- Test: `test/unit/init.test.ts`

**Interfaces:**
- Consumes: types + `ROSTER`, `RANKS`, `DEFAULT_MAX_PLIES`.
- Produces:
  - `rosterPieceIds(color: Color): PieceId[]` — the 40 ids for a color, id format `` `${color}-${rank}-${index}` `` (index 0-based within that rank).
  - `createGame(config?: Partial<GameConfig>): GameState` — SETUP phase, `turn: 'RED'`, all 80 pieces present with `pos: null`, `revealed: false`, `setupDone: {RED:false,BLUE:false}`, `recentMoves: {}`, `result: null`. `maxPlies` defaults to `DEFAULT_MAX_PLIES`.
  - `pieceAt(state: GameState, sq: Square): Piece | null`.
  - `piecesOf(state: GameState, color: Color): Piece[]`.

- [ ] **Step 1: Write failing test `test/unit/init.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { createGame, rosterPieceIds, pieceAt, piecesOf } from '../../src/engine/init.js';
import { ROSTER } from '../../src/engine/types.js';

describe('createGame', () => {
  test('starts in SETUP with RED to move and 80 pieces off-board', () => {
    const s = createGame();
    expect(s.phase).toBe('SETUP');
    expect(s.turn).toBe('RED');
    expect(Object.keys(s.pieces)).toHaveLength(80);
    expect(Object.values(s.pieces).every((p) => p.pos === null)).toBe(true);
    expect(s.result).toBeNull();
    expect(s.config.maxPlies).toBe(2000);
  });
  test('roster ids: 40 per color, counts match ROSTER', () => {
    const ids = rosterPieceIds('RED');
    expect(ids).toHaveLength(40);
    const s = createGame();
    const flags = piecesOf(s, 'RED').filter((p) => p.rank === 'FLAG');
    expect(flags).toHaveLength(ROSTER.FLAG);
    const scouts = piecesOf(s, 'RED').filter((p) => p.rank === 'SCOUT');
    expect(scouts).toHaveLength(ROSTER.SCOUT);
  });
  test('state is JSON-serializable (round-trips)', () => {
    const s = createGame();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  test('pieceAt returns null on empty board', () => {
    const s = createGame();
    expect(pieceAt(s, { r: 0, c: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- init`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/init.ts`**

```ts
import {
  DEFAULT_MAX_PLIES, RANKS, ROSTER,
  type Color, type GameConfig, type GameState, type Piece, type PieceId, type Square,
} from './types.js';
import { sameSquare } from './board.js';

export function rosterPieceIds(color: Color): PieceId[] {
  const ids: PieceId[] = [];
  for (const rank of RANKS) {
    for (let i = 0; i < ROSTER[rank]; i++) ids.push(`${color}-${rank}-${i}`);
  }
  return ids;
}

export function createGame(config: Partial<GameConfig> = {}): GameState {
  const pieces: Record<PieceId, Piece> = {};
  for (const color of ['RED', 'BLUE'] as const) {
    for (const rank of RANKS) {
      for (let i = 0; i < ROSTER[rank]; i++) {
        const id = `${color}-${rank}-${i}`;
        pieces[id] = { id, owner: color, rank, revealed: false, pos: null };
      }
    }
  }
  return {
    config: { maxPlies: config.maxPlies ?? DEFAULT_MAX_PLIES, seed: config.seed },
    phase: 'SETUP',
    turn: 'RED',
    plyCount: 0,
    pieces,
    setupDone: { RED: false, BLUE: false },
    recentMoves: {},
    result: null,
  };
}

export function pieceAt(state: GameState, sq: Square): Piece | null {
  for (const p of Object.values(state.pieces)) {
    if (p.pos && sameSquare(p.pos, sq)) return p;
  }
  return null;
}

export function piecesOf(state: GameState, color: Color): Piece[] {
  return Object.values(state.pieces).filter((p) => p.owner === color);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- init`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/init.ts test/unit/init.test.ts
git commit -m "feat: game initialization and roster helpers"
```

---

## Task 6: Legal moves

**Files:**
- Create: `src/engine/moves.ts`
- Test: `test/unit/moves.test.ts`

**Interfaces:**
- Consumes: `pieceAt`, board geometry, `isMovable`/`isScout`, `PlayerView`-independent full state.
- Produces:
  - `destinationsFor(state: GameState, pieceId: PieceId): Square[]` — all squares this piece may move to (including onto enemy pieces to attack), ignoring the two-square rule (that lives in `rules.ts` and is applied by `validate`).
  - `legalMovesForColor(state: GameState, color: Color): { from: Square; to: Square }[]` — every legal `MOVE` for that color during PLAY, ignoring the two-square rule.
- Rules: only own movable pieces move; a normal piece moves to an orthogonally adjacent square that is empty or holds an enemy; it cannot move onto a lake, off-board, or onto a friendly piece. A Scout moves any number of empty squares in a straight orthogonal line and may stop on the first enemy piece in that line (attack); the path (interior squares) must be empty and lake-free; a Scout may not pass through or land on a lake.

- [ ] **Step 1: Write failing test `test/unit/moves.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { createGame } from '../../src/engine/init.js';
import { destinationsFor } from '../../src/engine/moves.js';
import type { GameState, Square } from '../../src/engine/types.js';

// helper: place a piece by id onto a square in a mutable clone
function place(s: GameState, id: string, sq: Square): GameState {
  const c = JSON.parse(JSON.stringify(s)) as GameState;
  c.pieces[id]!.pos = sq;
  c.phase = 'PLAY';
  return c;
}

describe('destinationsFor', () => {
  test('marshal moves one square orthogonally into empty squares', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 2, c: 5 }); // lake-free interior square
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).toContainEqual({ r: 1, c: 5 });
    expect(dests).toContainEqual({ r: 3, c: 5 });
    expect(dests).toContainEqual({ r: 2, c: 4 });
    expect(dests).toContainEqual({ r: 2, c: 6 });
    expect(dests).toHaveLength(4);
  });
  test('cannot move onto a lake', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 3, c: 2 }); // just above lake (4,2)
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).not.toContainEqual({ r: 4, c: 2 });
  });
  test('cannot move onto a friendly piece; can move onto an enemy', () => {
    let s = createGame();
    s = place(s, 'RED-MARSHAL-0', { r: 2, c: 5 }); // lake-free interior square
    s = place(s, 'RED-SCOUT-0', { r: 2, c: 6 });   // friendly right
    s = place(s, 'BLUE-SCOUT-0', { r: 2, c: 4 });  // enemy left
    const dests = destinationsFor(s, 'RED-MARSHAL-0');
    expect(dests).not.toContainEqual({ r: 2, c: 6 });
    expect(dests).toContainEqual({ r: 2, c: 4 });
  });
  test('bomb and flag never move', () => {
    let s = createGame();
    s = place(s, 'RED-BOMB-0', { r: 5, c: 5 });
    s = place(s, 'RED-FLAG-0', { r: 9, c: 0 });
    expect(destinationsFor(s, 'RED-BOMB-0')).toEqual([]);
    expect(destinationsFor(s, 'RED-FLAG-0')).toEqual([]);
  });
  test('scout slides multiple empty squares and stops on first enemy', () => {
    let s = createGame();
    s = place(s, 'RED-SCOUT-0', { r: 9, c: 0 });
    s = place(s, 'BLUE-SCOUT-0', { r: 9, c: 4 }); // enemy 4 to the right
    const dests = destinationsFor(s, 'RED-SCOUT-0');
    expect(dests).toContainEqual({ r: 9, c: 1 });
    expect(dests).toContainEqual({ r: 9, c: 3 });
    expect(dests).toContainEqual({ r: 9, c: 4 }); // can attack enemy
    expect(dests).not.toContainEqual({ r: 9, c: 5 }); // blocked beyond enemy
  });
  test('scout cannot pass through a lake', () => {
    let s = createGame();
    s = place(s, 'RED-SCOUT-0', { r: 4, c: 0 }); // row 4 has lakes at c2,c3
    const dests = destinationsFor(s, 'RED-SCOUT-0');
    expect(dests).toContainEqual({ r: 4, c: 1 });
    expect(dests).not.toContainEqual({ r: 4, c: 4 }); // beyond lake, unreachable this row
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- moves`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/moves.ts`**

```ts
import { inBounds, isLake } from './board.js';
import { isMovable, isScout } from './pieceDefs.js';
import { pieceAt } from './init.js';
import type { Color, GameState, PieceId, Square } from './types.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

export function destinationsFor(state: GameState, pieceId: PieceId): Square[] {
  const p = state.pieces[pieceId];
  if (!p || !p.pos || !isMovable(p.rank)) return [];
  const from = p.pos;
  const out: Square[] = [];
  const maxSteps = isScout(p.rank) ? 9 : 1;
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= maxSteps; step++) {
      const to: Square = { r: from.r + dr * step, c: from.c + dc * step };
      if (!inBounds(to) || isLake(to)) break;
      const occupant = pieceAt(state, to);
      if (!occupant) { out.push(to); continue; }
      if (occupant.owner !== p.owner) out.push(to); // attack, then blocked
      break; // stop at first occupied square either way
    }
  }
  return out;
}

export function legalMovesForColor(
  state: GameState,
  color: Color,
): { from: Square; to: Square }[] {
  const moves: { from: Square; to: Square }[] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.owner !== color || !p.pos) continue;
    for (const to of destinationsFor(state, p.id)) moves.push({ from: p.pos, to });
  }
  return moves;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- moves`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/moves.ts test/unit/moves.test.ts
git commit -m "feat: legal move generation (normal + scout)"
```

---

## Task 7: Rules — two-square repetition, win & draw detection

**Files:**
- Create: `src/engine/rules.ts`
- Test: `test/unit/rules.test.ts`

**Interfaces:**
- Consumes: `MoveRecord`, `legalMovesForColor`, `piecesOf`, `isMovable`.
- Produces:
  - `violatesTwoSquare(state: GameState, pieceId: PieceId, from: Square, to: Square): boolean` — true if this move would be the third consecutive back-and-forth traversal of the same square pair for that piece. Uses `state.recentMoves[pieceId]` (most-recent-last, length ≤ 3 retained).
  - `recordMove(recent: MoveRecord[], rec: MoveRecord): MoveRecord[]` — append; if `rec.pieceId` differs from the tail's, this helper is only called per-piece so caller passes that piece's list; keep at most last 3.
  - `hasAnyLegalAction(state: GameState, color: Color): boolean` — any non-two-square-violating legal MOVE exists.
  - `movablePieceCount(state: GameState, color: Color): number`.
- Two-square semantics (from spec): illegal iff the piece's last two recorded moves were `X→Y` then `Y→X`, and the new move is `X→Y` again (completing a 3rd consecutive traversal of the {X,Y} pair).

- [ ] **Step 1: Write failing test `test/unit/rules.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { violatesTwoSquare, recordMove } from '../../src/engine/rules.js';
import { createGame } from '../../src/engine/init.js';
import type { GameState, MoveRecord, Square } from '../../src/engine/types.js';

const A: Square = { r: 5, c: 5 };
const B: Square = { r: 5, c: 6 };

function withRecent(recent: MoveRecord[]): GameState {
  const s = createGame();
  s.pieces['RED-SCOUT-0']!.pos = A;
  s.phase = 'PLAY';
  s.recentMoves['RED-SCOUT-0'] = recent;
  return s;
}

describe('two-square rule', () => {
  test('first A->B is fine', () => {
    const s = withRecent([]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, B)).toBe(false);
  });
  test('A->B, B->A, then A->B again is illegal', () => {
    const s = withRecent([
      { pieceId: 'RED-SCOUT-0', from: A, to: B },
      { pieceId: 'RED-SCOUT-0', from: B, to: A },
    ]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, B)).toBe(true);
  });
  test('A->B, B->A, then A->C (different) is legal', () => {
    const C: Square = { r: 4, c: 5 };
    const s = withRecent([
      { pieceId: 'RED-SCOUT-0', from: A, to: B },
      { pieceId: 'RED-SCOUT-0', from: B, to: A },
    ]);
    expect(violatesTwoSquare(s, 'RED-SCOUT-0', A, C)).toBe(false);
  });
});

describe('recordMove keeps last 3', () => {
  test('caps history length', () => {
    let rec: MoveRecord[] = [];
    for (let i = 0; i < 5; i++) rec = recordMove(rec, { pieceId: 'x', from: A, to: B });
    expect(rec.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- rules`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/rules.ts`**

```ts
import { sameSquare } from './board.js';
import { legalMovesForColor } from './moves.js';
import { isMovable } from './pieceDefs.js';
import type { Color, GameState, MoveRecord, PieceId, Square } from './types.js';

export function recordMove(recent: MoveRecord[], rec: MoveRecord): MoveRecord[] {
  return [...recent, rec].slice(-3);
}

export function violatesTwoSquare(
  state: GameState,
  pieceId: PieceId,
  from: Square,
  to: Square,
): boolean {
  const recent = state.recentMoves[pieceId] ?? [];
  if (recent.length < 2) return false;
  const prev = recent[recent.length - 1]!; // Y->X most recent
  const prev2 = recent[recent.length - 2]!; // X->Y before that
  // Illegal if the new move X->Y repeats prev2, and prev was its exact reverse.
  const newIsRepeatOfPrev2 = sameSquare(prev2.from, from) && sameSquare(prev2.to, to);
  const prevIsReverseOfPrev2 =
    sameSquare(prev.from, prev2.to) && sameSquare(prev.to, prev2.from);
  return newIsRepeatOfPrev2 && prevIsReverseOfPrev2;
}

export function movablePieceCount(state: GameState, color: Color): number {
  return Object.values(state.pieces).filter(
    (p) => p.owner === color && p.pos !== null && isMovable(p.rank),
  ).length;
}

export function hasAnyLegalAction(state: GameState, color: Color): boolean {
  const moves = legalMovesForColor(state, color);
  for (const m of moves) {
    const occupant = Object.values(state.pieces).find(
      (p) => p.pos && sameSquare(p.pos, m.from),
    );
    if (!occupant) continue;
    if (!violatesTwoSquare(state, occupant.id, m.from, m.to)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- rules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rules.ts test/unit/rules.test.ts
git commit -m "feat: two-square rule, movable counts, legal-action check"
```

---

## Task 8: Setups — presets, random, legality

**Files:**
- Create: `src/engine/setups.ts`
- Test: `test/unit/setups.test.ts`

**Interfaces:**
- Consumes: `rosterPieceIds`, `SETUP_ROWS`, `piecesOf`, board helpers.
- Produces:
  - `setupSquares(color: Color): Square[]` — the 40 legal placement squares for a color (its back 4 rows, all columns; none are lakes since lakes are in rows 4–5).
  - `isSetupComplete(state: GameState, color: Color): boolean` — all 40 of that color's pieces have `pos` within its setup rows and no two share a square.
  - `presetNames(): string[]` and `presetPlacement(color: Color, name: string): Record<PieceId, Square> | null` — returns a full id→square mapping for a named preset (at least `'balanced'` and `'bombs-back'`); flag on the back row, bombs guarding it.
  - `randomPlacement(color: Color, order: PieceId[]): Record<PieceId, Square>` — assigns the 40 pieces (in the given shuffled `order`, which must be a permutation of `rosterPieceIds(color)`) to `setupSquares(color)` positionally.

- [ ] **Step 1: Write failing test `test/unit/setups.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import {
  setupSquares, presetNames, presetPlacement, randomPlacement, isSetupComplete,
} from '../../src/engine/setups.js';
import { createGame, rosterPieceIds } from '../../src/engine/init.js';
import { SETUP_ROWS } from '../../src/engine/types.js';
import type { GameState } from '../../src/engine/types.js';

describe('setups', () => {
  test('setupSquares: 40 squares in the color back rows', () => {
    const sq = setupSquares('RED');
    expect(sq).toHaveLength(40);
    expect(sq.every((s) => SETUP_ROWS.RED.includes(s.r))).toBe(true);
  });
  test('every preset places all 40 pieces on distinct legal squares', () => {
    for (const name of presetNames()) {
      const placement = presetPlacement('RED', name)!;
      const ids = Object.keys(placement);
      expect(ids.sort()).toEqual(rosterPieceIds('RED').sort());
      const squares = Object.values(placement).map((s) => `${s.r},${s.c}`);
      expect(new Set(squares).size).toBe(40);
      expect(Object.values(placement).every((s) => SETUP_ROWS.RED.includes(s.r))).toBe(true);
    }
  });
  test('preset flag is on the very back row', () => {
    const placement = presetPlacement('RED', 'bombs-back')!;
    const flagSq = placement['RED-FLAG-0']!;
    expect(flagSq.r).toBe(9); // Red's back row
  });
  test('randomPlacement uses all squares exactly once', () => {
    const order = rosterPieceIds('BLUE');
    const placement = randomPlacement('BLUE', order);
    const squares = Object.values(placement).map((s) => `${s.r},${s.c}`);
    expect(new Set(squares).size).toBe(40);
  });
  test('isSetupComplete true after applying a preset', () => {
    let s: GameState = createGame();
    const placement = presetPlacement('RED', 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    expect(isSetupComplete(s, 'RED')).toBe(true);
    expect(isSetupComplete(s, 'BLUE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- setups`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/setups.ts`**

```ts
import { BOARD_SIZE, SETUP_ROWS, type Color, type GameState, type PieceId, type Square } from './types.js';
import { rosterPieceIds, piecesOf } from './init.js';

export function setupSquares(color: Color): Square[] {
  const rows = SETUP_ROWS[color];
  const out: Square[] = [];
  for (const r of rows) for (let c = 0; c < BOARD_SIZE; c++) out.push({ r, c });
  return out;
}

// Positional assignment: order[i] -> setupSquares[i].
function assignPositional(color: Color, order: PieceId[]): Record<PieceId, Square> {
  const squares = setupSquares(color);
  const map: Record<PieceId, Square> = {};
  order.forEach((id, i) => { map[id] = squares[i]!; });
  return map;
}

export function randomPlacement(color: Color, order: PieceId[]): Record<PieceId, Square> {
  return assignPositional(color, order);
}

// Presets are defined by an ordering of rosterPieceIds mapped positionally onto
// setupSquares (row-major from the front row toward the back row). rosterPieceIds
// returns ranks high→low then bombs then flag; setupSquares lists front→back, so
// the flag & bombs (end of roster) land on the back rows.
export function presetNames(): string[] {
  return ['balanced', 'bombs-back'];
}

export function presetPlacement(color: Color, name: string): Record<PieceId, Square> | null {
  const ids = rosterPieceIds(color); // high ranks first ... bombs, flag last
  if (name === 'balanced') {
    return assignPositional(color, ids);
  }
  if (name === 'bombs-back') {
    // Flag to the exact back corner, bombs adjacent; then the rest.
    const flag = ids.filter((i) => i.includes('-FLAG-'));
    const bombs = ids.filter((i) => i.includes('-BOMB-'));
    const rest = ids.filter((i) => !i.includes('-FLAG-') && !i.includes('-BOMB-'));
    // setupSquares is front→back; reverse so index 0 is the back row (flag first).
    const squares = setupSquares(color).slice().reverse();
    const order = [...flag, ...bombs, ...rest];
    const map: Record<PieceId, Square> = {};
    order.forEach((id, i) => { map[id] = squares[i]!; });
    return map;
  }
  return null;
}

export function isSetupComplete(state: GameState, color: Color): boolean {
  const pieces = piecesOf(state, color);
  if (pieces.some((p) => p.pos === null)) return false;
  const rows = new Set(SETUP_ROWS[color]);
  const seen = new Set<string>();
  for (const p of pieces) {
    const sq = p.pos!;
    if (!rows.has(sq.r)) return false;
    const key = `${sq.r},${sq.c}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- setups`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/setups.ts test/unit/setups.test.ts
git commit -m "feat: setup placement (presets, random, legality)"
```

---

## Task 9: RNG

**Files:**
- Create: `src/rng/rng.ts`
- Test: `test/unit/rng.test.ts`

**Interfaces:**
- Produces:
  - `interface Rng { next(): number /* [0,1) */; int(nExclusive: number): number; shuffle<T>(items: T[]): T[] }`
  - `makeSeeded(seed: number): Rng` — deterministic (mulberry32).
  - `makeRandom(): Rng` — uses `Math.random` (only ever constructed in shells, never in engine).

- [ ] **Step 1: Write failing test `test/unit/rng.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { makeSeeded } from '../../src/rng/rng.js';

describe('seeded rng', () => {
  test('same seed → identical sequence', () => {
    const a = makeSeeded(42);
    const b = makeSeeded(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
  test('int is within range', () => {
    const r = makeSeeded(1);
    for (let i = 0; i < 100; i++) {
      const n = r.int(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });
  test('shuffle is a permutation and deterministic for a seed', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const s1 = makeSeeded(7).shuffle(items);
    const s2 = makeSeeded(7).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(items);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- rng`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/rng/rng.ts`**

```ts
export interface Rng {
  next(): number;            // [0, 1)
  int(nExclusive: number): number;
  shuffle<T>(items: T[]): T[];
}

function make(nextFloat: () => number): Rng {
  const rng: Rng = {
    next: nextFloat,
    int: (n) => Math.floor(nextFloat() * n),
    shuffle: (items) => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
  return rng;
}

export function makeSeeded(seed: number): Rng {
  let a = seed >>> 0;
  return make(() => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

export function makeRandom(): Rng {
  return make(() => Math.random());
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- rng`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rng/rng.ts test/unit/rng.test.ts
git commit -m "feat: seeded + random RNG interface"
```

---

## Task 10: Validation

**Files:**
- Create: `src/engine/validate.ts`
- Test: `test/unit/validate.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `validateAction(state: GameState, action: Action): string | null` — returns a human-readable reason string if illegal, else `null`. Covers: phase gating (setup actions only in SETUP, MOVE/RESIGN only in PLAY), turn ownership, `SETUP_PLACE` legality (piece exists, belongs to color, target is an empty legal setup square), `SETUP_DONE` requires complete setup, `SETUP_RANDOM.order` must be a permutation of that color's roster, MOVE legality (own movable piece on `from`, `to` ∈ destinations, not a two-square violation).

- [ ] **Step 1: Write failing test `test/unit/validate.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { validateAction } from '../../src/engine/validate.js';
import { createGame } from '../../src/engine/init.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    s.setupDone[color] = true;
  }
  s.phase = 'PLAY';
  s.turn = 'RED';
  return s;
}

describe('validateAction', () => {
  test('rejects MOVE during SETUP', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('rejects action from the wrong color', () => {
    const s = playState();
    const r = validateAction(s, { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('rejects moving onto own piece', () => {
    const s = playState();
    // find two adjacent red pieces on rows 6..9 in the same column
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 7, c: 0 } });
    expect(r).toBeTruthy(); // 7,0 is occupied by red in 'balanced'
  });
  test('accepts a legal forward move into the empty middle', () => {
    const s = playState();
    const r = validateAction(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(r).toBeNull();
  });
  test('rejects SETUP_PLACE onto a non-setup row', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 5, c: 0 } });
    expect(r).toBeTruthy();
  });
  test('accepts SETUP_PLACE onto an empty legal square', () => {
    const s = createGame();
    const r = validateAction(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 9, c: 0 } });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- validate`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/validate.ts`**

```ts
import { sameSquare } from './board.js';
import { pieceAt } from './init.js';
import { destinationsFor } from './moves.js';
import { rosterPieceIds } from './init.js';
import { isMovable } from './pieceDefs.js';
import { setupSquares, isSetupComplete } from './setups.js';
import { violatesTwoSquare } from './rules.js';
import { SETUP_ROWS, type Action, type GameState, type Square } from './types.js';

function isSetupSquare(color: GameState['turn'], sq: Square): boolean {
  return SETUP_ROWS[color].includes(sq.r) && sq.c >= 0 && sq.c < 10;
}

export function validateAction(state: GameState, action: Action): string | null {
  if (state.phase === 'GAME_OVER') return 'game is over';

  if (action.type === 'SETUP_PLACE' || action.type === 'SETUP_PRESET' ||
      action.type === 'SETUP_RANDOM' || action.type === 'SETUP_DONE') {
    if (state.phase !== 'SETUP') return 'not in setup phase';
  }
  if (action.type === 'MOVE' || action.type === 'RESIGN') {
    if (state.phase !== 'PLAY') return 'not in play phase';
    if (action.color !== state.turn) return `it is ${state.turn}'s turn`;
  }

  switch (action.type) {
    case 'RESIGN':
      return null;

    case 'SETUP_DONE':
      if (!isSetupComplete(state, action.color)) return 'setup is incomplete';
      return null;

    case 'SETUP_PRESET':
      return null; // preset name validated in reducer (unknown → REJECTED there)

    case 'SETUP_RANDOM': {
      const expected = rosterPieceIds(action.color).sort();
      const got = [...action.order].sort();
      if (expected.length !== got.length || expected.some((id, i) => id !== got[i])) {
        return 'order is not a permutation of the roster';
      }
      return null;
    }

    case 'SETUP_PLACE': {
      const p = state.pieces[action.pieceId];
      if (!p) return 'no such piece';
      if (p.owner !== action.color) return 'piece belongs to the other player';
      if (!isSetupSquare(action.color, action.to)) return 'square is outside your setup rows';
      const occupant = pieceAt(state, action.to);
      if (occupant) return 'square is already occupied';
      return null;
    }

    case 'MOVE': {
      const p = pieceAt(state, action.from);
      if (!p) return 'no piece on the from square';
      if (p.owner !== action.color) return 'not your piece';
      if (!isMovable(p.rank)) return 'that piece cannot move';
      const legal = destinationsFor(state, p.id).some((d) => sameSquare(d, action.to));
      if (!legal) return 'illegal destination';
      if (violatesTwoSquare(state, p.id, action.from, action.to)) return 'two-square rule violation';
      return null;
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/validate.ts test/unit/validate.test.ts
git commit -m "feat: action validation"
```

---

## Task 11: The reducer

**Files:**
- Create: `src/engine/reduce.ts`
- Test: `test/unit/reduce.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `strategoReduce(state: GameState, action: Action): { state: GameState; events: GameEvent[] }` — pure, total, non-mutating. On invalid action (per `validateAction`) or any thrown error, returns the original state (unchanged reference is fine since we never mutate) plus a single `REJECTED` event. On valid action, returns a new deep-cloned state and the event list.
- Behavior:
  - `SETUP_PLACE`: set piece.pos; emit `SETUP_PLACED`.
  - `SETUP_PRESET`: unknown name → REJECTED; else clear that color's placements, apply preset, emit `SETUP_CLEARED` + `SETUP_PLACED`×40.
  - `SETUP_RANDOM`: apply positional placement from `order`; emit `SETUP_CLEARED` + `SETUP_PLACED`×40.
  - `SETUP_DONE`: mark `setupDone[color]=true`, emit `SETUP_COMPLETED`; when both done → `phase='PLAY'`, `turn='RED'`, emit `PLAY_STARTED`.
  - `MOVE` (no occupant at `to`): move piece; if Scout moved >1 square, set `revealed=true`; update `recentMoves`; emit `PIECE_MOVED`; then advance turn & check end conditions.
  - `MOVE` onto enemy (attack): both pieces become `revealed=true`; compute `resolveCombat`; emit `STRIKE`; apply outcome (`ATTACKER`: defender captured, attacker moves in — special `BOMB_DEFUSED`/`FLAG_CAPTURED` events; `DEFENDER`: attacker captured, defender stays; `BOTH`: both captured); clear the moved piece's `recentMoves` on any strike; if flag captured → game over; else advance turn & check end conditions.
  - After each PLAY action, `plyCount++`; end-condition order: flag captured (handled inline) → dead position (neither side movable → draw) → opponent has no legal action (`NO_MOVES`, opponent loses) → ply cap (`PLY_CAP` draw). Dead position is checked BEFORE no-moves because a movable-empty side also has zero legal moves. Emit `TURN_PASSED` then `GAME_OVER` when applicable.

- [ ] **Step 1: Write failing test `test/unit/reduce.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { strategoReduce } from '../../src/engine/reduce.js';
import { createGame } from '../../src/engine/init.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    s.setupDone[color] = true;
  }
  s.phase = 'PLAY';
  s.turn = 'RED';
  return s;
}

describe('reducer totality', () => {
  test('junk action → unchanged state + REJECTED', () => {
    const s = createGame();
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 0, c: 0 }, to: { r: 1, c: 0 } });
    expect(state).toEqual(s);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('REJECTED');
  });
  test('does not mutate input state', () => {
    const s = createGame();
    const snapshot = JSON.parse(JSON.stringify(s));
    strategoReduce(s, { type: 'SETUP_PLACE', color: 'RED', pieceId: 'RED-FLAG-0', to: { r: 9, c: 0 } });
    expect(s).toEqual(snapshot);
  });
});

describe('setup flow', () => {
  test('SETUP_PRESET then SETUP_DONE for both starts PLAY', () => {
    let s = createGame();
    let r = strategoReduce(s, { type: 'SETUP_PRESET', color: 'RED', preset: 'balanced' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_DONE', color: 'RED' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_PRESET', color: 'BLUE', preset: 'balanced' });
    s = r.state;
    r = strategoReduce(s, { type: 'SETUP_DONE', color: 'BLUE' });
    s = r.state;
    expect(s.phase).toBe('PLAY');
    expect(r.events.some((e) => e.type === 'PLAY_STARTED')).toBe(true);
  });
});

describe('moves and combat', () => {
  test('a quiet move advances the turn', () => {
    const s = playState();
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
    expect(events.some((e) => e.type === 'PIECE_MOVED')).toBe(true);
    expect(state.turn).toBe('BLUE');
    expect(state.plyCount).toBe(1);
  });
  test('attacker beats lower defender and moves in', () => {
    const s = playState();
    // place a red scout adjacent above a blue scout in open ground
    s.pieces['RED-SCOUT-0']!.pos = { r: 5, c: 0 };
    s.pieces['BLUE-MARSHAL-0']!.pos = { r: 4, c: 0 };
    // Red spy attacks blue marshal for a deterministic ATTACKER result
    s.pieces['RED-SPY-0']!.pos = { r: 5, c: 1 };
    s.pieces['BLUE-MARSHAL-0']!.pos = { r: 4, c: 1 };
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 5, c: 1 }, to: { r: 4, c: 1 } });
    expect(events.some((e) => e.type === 'STRIKE')).toBe(true);
    expect(state.pieces['BLUE-MARSHAL-0']!.pos).toBeNull();
    expect(state.pieces['RED-SPY-0']!.pos).toEqual({ r: 4, c: 1 });
  });
  test('capturing the flag ends the game', () => {
    const s = playState();
    s.pieces['RED-MARSHAL-0']!.pos = { r: 1, c: 0 };
    s.pieces['BLUE-FLAG-0']!.pos = { r: 0, c: 0 };
    const { state, events } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 1, c: 0 }, to: { r: 0, c: 0 } });
    expect(events.some((e) => e.type === 'FLAG_CAPTURED')).toBe(true);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.result?.winner).toBe('RED');
  });
  test('non-miner attacking a bomb dies, bomb stays', () => {
    const s = playState();
    s.pieces['RED-CAPTAIN-0']!.pos = { r: 1, c: 5 };
    s.pieces['BLUE-BOMB-0']!.pos = { r: 0, c: 5 };
    const { state } = strategoReduce(s, { type: 'MOVE', color: 'RED', from: { r: 1, c: 5 }, to: { r: 0, c: 5 } });
    expect(state.pieces['RED-CAPTAIN-0']!.pos).toBeNull();
    expect(state.pieces['BLUE-BOMB-0']!.pos).toEqual({ r: 0, c: 5 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- reduce`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/reduce.ts`**

```ts
import { sameSquare, stepsBetween } from './board.js';
import { resolveCombat } from './combat.js';
import { pieceAt } from './init.js';
import { isScout } from './pieceDefs.js';
import { presetPlacement, randomPlacement, setupSquares } from './setups.js';
import { hasAnyLegalAction, movablePieceCount, recordMove, violatesTwoSquare } from './rules.js';
import { rosterPieceIds } from './init.js';
import { validateAction } from './validate.js';
import type { Action, Color, GameEvent, GameState, Piece, PieceId, Square } from './types.js';

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
const other = (c: Color): Color => (c === 'RED' ? 'BLUE' : 'RED');

function reject(state: GameState, reason: string): { state: GameState; events: GameEvent[] } {
  return { state, events: [{ type: 'REJECTED', reason }] };
}

function applyEndConditions(
  s: GameState,
  events: GameEvent[],
): void {
  // Called after a non-flag-capturing PLAY action; s.turn already advanced.
  const mover = other(s.turn); // player who just moved
  // Dead position MUST be checked before NO_MOVES: a side with zero movable
  // pieces also has zero legal moves, so if both sides are movable-empty the
  // NO_MOVES branch would otherwise fire first and mis-report a draw as a win.
  if (movablePieceCount(s, 'RED') === 0 && movablePieceCount(s, 'BLUE') === 0) {
    s.phase = 'GAME_OVER';
    s.result = { winner: null, reason: 'DEAD_POSITION' };
    events.push({ type: 'GAME_OVER', result: s.result });
    return;
  }
  if (!hasAnyLegalAction(s, s.turn)) {
    s.phase = 'GAME_OVER';
    s.result = { winner: mover, reason: 'NO_MOVES' };
    events.push({ type: 'GAME_OVER', result: s.result });
    return;
  }
  if (s.plyCount >= s.config.maxPlies) {
    s.phase = 'GAME_OVER';
    s.result = { winner: null, reason: 'PLY_CAP' };
    events.push({ type: 'GAME_OVER', result: s.result });
  }
}

function doInner(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const invalid = validateAction(state, action);
  if (invalid) return reject(state, invalid);

  const s = clone(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'SETUP_PLACE': {
      s.pieces[action.pieceId]!.pos = action.to;
      events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: action.pieceId, to: action.to });
      return { state: s, events };
    }
    case 'SETUP_PRESET': {
      const placement = presetPlacement(action.color, action.preset);
      if (!placement) return reject(state, `unknown preset: ${action.preset}`);
      for (const p of Object.values(s.pieces)) if (p.owner === action.color) p.pos = null;
      events.push({ type: 'SETUP_CLEARED', color: action.color });
      for (const [id, sq] of Object.entries(placement)) {
        s.pieces[id]!.pos = sq;
        events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: id, to: sq });
      }
      return { state: s, events };
    }
    case 'SETUP_RANDOM': {
      const placement = randomPlacement(action.color, action.order);
      for (const p of Object.values(s.pieces)) if (p.owner === action.color) p.pos = null;
      events.push({ type: 'SETUP_CLEARED', color: action.color });
      for (const [id, sq] of Object.entries(placement)) {
        s.pieces[id]!.pos = sq;
        events.push({ type: 'SETUP_PLACED', color: action.color, pieceId: id, to: sq });
      }
      return { state: s, events };
    }
    case 'SETUP_DONE': {
      s.setupDone[action.color] = true;
      events.push({ type: 'SETUP_COMPLETED', color: action.color });
      if (s.setupDone.RED && s.setupDone.BLUE) {
        s.phase = 'PLAY';
        s.turn = 'RED';
        events.push({ type: 'PLAY_STARTED' });
      }
      return { state: s, events };
    }
    case 'RESIGN': {
      s.phase = 'GAME_OVER';
      s.result = { winner: other(action.color), reason: 'RESIGN' };
      events.push({ type: 'GAME_OVER', result: s.result });
      return { state: s, events };
    }
    case 'MOVE': {
      const mover = pieceAt(s, action.from)!;
      const target = pieceAt(s, action.to);
      const from = action.from;
      const to = action.to;
      const movedMultiple = isScout(mover.rank) &&
        (Math.abs(from.r - to.r) + Math.abs(from.c - to.c)) > 1;

      if (!target) {
        mover.pos = to;
        if (movedMultiple) mover.revealed = true;
        s.recentMoves[mover.id] = recordMove(s.recentMoves[mover.id] ?? [], { pieceId: mover.id, from, to });
        events.push({ type: 'PIECE_MOVED', pieceId: mover.id, from, to });
      } else {
        // strike
        mover.revealed = true;
        target.revealed = true;
        const outcome = resolveCombat(mover.rank, target.rank);
        events.push({
          type: 'STRIKE', attacker: mover.id, defender: target.id,
          attackerRank: mover.rank, defenderRank: target.rank, outcome,
        });
        s.recentMoves[mover.id] = []; // a strike breaks any oscillation
        if (target.rank === 'FLAG' && outcome === 'ATTACKER') {
          target.pos = null;
          mover.pos = to;
          events.push({ type: 'FLAG_CAPTURED', flagId: target.id, by: mover.id });
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
          s.plyCount += 1;
          s.phase = 'GAME_OVER';
          s.result = { winner: mover.owner, reason: 'FLAG_CAPTURED' };
          events.push({ type: 'GAME_OVER', result: s.result });
          return { state: s, events };
        }
        if (outcome === 'ATTACKER') {
          if (target.rank === 'BOMB') {
            events.push({ type: 'BOMB_DEFUSED', bombId: target.id, minerId: mover.id });
          }
          target.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
          mover.pos = to;
        } else if (outcome === 'DEFENDER') {
          mover.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: mover.id });
          // defender stays (incl. surviving bomb)
        } else { // BOTH
          mover.pos = null;
          target.pos = null;
          events.push({ type: 'PIECE_CAPTURED', pieceId: mover.id });
          events.push({ type: 'PIECE_CAPTURED', pieceId: target.id });
        }
      }

      s.plyCount += 1;
      s.turn = other(s.turn);
      events.push({ type: 'TURN_PASSED', to: s.turn });
      applyEndConditions(s, events);
      return { state: s, events };
    }
  }
}

export function strategoReduce(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  try {
    return doInner(state, action);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'internal error';
    return reject(state, `rejected: ${reason}`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- reduce`
Expected: PASS (all reducer tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/reduce.ts test/unit/reduce.test.ts
git commit -m "feat: total strategoReduce (setup, move, combat, end conditions)"
```

---

## Task 12: Redaction (hidden information)

**Files:**
- Create: `src/engine/redact.ts`
- Test: `test/unit/redact.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Piece`, `Color`.
- Produces:
  - `interface VisiblePiece { id: PieceId; owner: Color; pos: Square; rank: Rank | null; revealed: boolean }` (rank `null` ⇒ hidden enemy).
  - `interface PlayerView { viewer: Color; phase: Phase; turn: Color; plyCount: number; pieces: VisiblePiece[]; result: GameResult | null }`.
  - `viewFor(state: GameState, viewer: Color): PlayerView` — own pieces always show rank; enemy pieces on the board show rank only if `revealed`; captured pieces are omitted from `pieces`. Positions of all on-board pieces are visible.

- [ ] **Step 1: Write failing test `test/unit/redact.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { viewFor } from '../../src/engine/redact.js';
import { createGame } from '../../src/engine/init.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
  }
  s.phase = 'PLAY';
  return s;
}

describe('viewFor', () => {
  test('own ranks visible, enemy unrevealed ranks hidden', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const ownFlag = view.pieces.find((p) => p.id === 'RED-FLAG-0')!;
    expect(ownFlag.rank).toBe('FLAG');
    const enemy = view.pieces.find((p) => p.owner === 'BLUE')!;
    expect(enemy.rank).toBeNull();
    expect(enemy.pos).toBeDefined();
  });
  test('revealed enemy rank becomes visible', () => {
    const s = playState();
    s.pieces['BLUE-MARSHAL-0']!.revealed = true;
    const view = viewFor(s, 'RED');
    const revealed = view.pieces.find((p) => p.id === 'BLUE-MARSHAL-0')!;
    expect(revealed.rank).toBe('MARSHAL');
  });
  test('captured pieces are omitted', () => {
    const s = playState();
    s.pieces['BLUE-SCOUT-0']!.pos = null;
    const view = viewFor(s, 'RED');
    expect(view.pieces.find((p) => p.id === 'BLUE-SCOUT-0')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- redact`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/engine/redact.ts`**

```ts
import type { Color, GameResult, GameState, Phase, PieceId, Rank, Square } from './types.js';

export interface VisiblePiece {
  id: PieceId;
  owner: Color;
  pos: Square;
  rank: Rank | null; // null ⇒ hidden enemy
  revealed: boolean;
}

export interface PlayerView {
  viewer: Color;
  phase: Phase;
  turn: Color;
  plyCount: number;
  pieces: VisiblePiece[];
  result: GameResult | null;
}

export function viewFor(state: GameState, viewer: Color): PlayerView {
  const pieces: VisiblePiece[] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.pos === null) continue; // captured pieces are off-board
    const own = p.owner === viewer;
    pieces.push({
      id: p.id,
      owner: p.owner,
      pos: p.pos,
      rank: own || p.revealed ? p.rank : null,
      revealed: p.revealed,
    });
  }
  return {
    viewer,
    phase: state.phase,
    turn: state.turn,
    plyCount: state.plyCount,
    pieces,
    result: state.result,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- redact`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/redact.ts test/unit/redact.test.ts
git commit -m "feat: hidden-information redaction (viewFor)"
```

---

## Task 13: Engine barrel

**Files:**
- Modify: `src/engine/index.ts`
- Test: `test/unit/barrel.test.ts`

**Interfaces:**
- Produces: a single import surface re-exporting the public engine API and all types.

- [ ] **Step 1: Write failing test `test/unit/barrel.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { createGame, strategoReduce, viewFor, validateAction, legalMovesForColor } from '../../src/engine/index.js';

describe('engine barrel', () => {
  test('exposes the public API', () => {
    expect(typeof createGame).toBe('function');
    expect(typeof strategoReduce).toBe('function');
    expect(typeof viewFor).toBe('function');
    expect(typeof validateAction).toBe('function');
    expect(typeof legalMovesForColor).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- barrel`
Expected: FAIL (exports missing).

- [ ] **Step 3: Overwrite `src/engine/index.ts`**

```ts
export * from './types.js';
export { createGame, rosterPieceIds, pieceAt, piecesOf } from './init.js';
export { strategoReduce } from './reduce.js';
export { validateAction } from './validate.js';
export { destinationsFor, legalMovesForColor } from './moves.js';
export { viewFor, type PlayerView, type VisiblePiece } from './redact.js';
export { setupSquares, presetNames, presetPlacement, randomPlacement, isSetupComplete } from './setups.js';
export { resolveCombat, type CombatOutcome } from './combat.js';
export { rankValue, isMovable, isScout, PIECE_DEFS } from './pieceDefs.js';
export { hasAnyLegalAction, movablePieceCount, violatesTwoSquare } from './rules.js';

export const ENGINE_VERSION = '0.1.0';
```

- [ ] **Step 4: Update the scaffold smoke test**

Replace `test/unit/smoke.test.ts` contents:
```ts
import { describe, expect, test } from 'vitest';
import { ENGINE_VERSION } from '../../src/engine/index.js';

describe('scaffold', () => {
  test('engine barrel exports a version', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- barrel && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts test/unit/barrel.test.ts test/unit/smoke.test.ts
git commit -m "feat: engine public barrel"
```

---

## Task 14: Bots

**Files:**
- Create: `src/bots/types.ts`, `src/bots/random.ts`, `src/bots/heuristic.ts`
- Test: `test/unit/bots.test.ts`

**Interfaces:**
- Consumes: `PlayerView`, `Rng`, and — for legal-move generation from a view — a view-based mover. Since `destinationsFor` needs full `GameState`, bots reconstruct a full-information *proxy* only over their own pieces plus enemy positions with unknown rank. To avoid duplicating move logic, expose `legalMovesFromView(view: PlayerView): {from,to}[]` in `src/bots/moves-from-view.ts`.
- Produces:
  - `src/bots/moves-from-view.ts`: `legalMovesFromView(view: PlayerView): { from: Square; to: Square }[]` — legal MOVEs for `view.viewer` computed from visible positions (treats any enemy-occupied square as attackable; unknown ranks don't affect move legality). Ignores the two-square rule (the engine will reject those; bots re-pick — see below).
  - `type Bot = (view: PlayerView, rng: Rng) => Action`
  - `randomBot: Bot` — uniformly picks a legal MOVE; RESIGN only if none.
  - `heuristicBot: Bot` — prefers: (1) capturing an enemy flag if reachable; (2) attacking a revealed enemy of strictly lower rank with a known own piece; (3) otherwise a random forward-biased move.

- [ ] **Step 1: Write failing test `test/unit/bots.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot as heur } from '../../src/bots/heuristic.js';
import { legalMovesFromView } from '../../src/bots/moves-from-view.js';
import { createGame, strategoReduce, viewFor } from '../../src/engine/index.js';
import { presetPlacement } from '../../src/engine/setups.js';
import { makeSeeded } from '../../src/rng/rng.js';
import type { GameState } from '../../src/engine/types.js';

function playState(): GameState {
  const s = createGame();
  for (const color of ['RED', 'BLUE'] as const) {
    const placement = presetPlacement(color, 'balanced')!;
    for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    s.setupDone[color] = true;
  }
  s.phase = 'PLAY';
  return s;
}

describe('bots', () => {
  test('legalMovesFromView returns only MOVEs the engine accepts', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const moves = legalMovesFromView(view);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      const invalid = strategoReduce(s, { type: 'MOVE', color: 'RED', from: m.from, to: m.to }).events[0];
      // A valid move's first event is never REJECTED.
      expect(invalid?.type).not.toBe('REJECTED');
    }
  });
  test('randomBot produces an engine-accepted action', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const action = randomBot(view, makeSeeded(1));
    const { events } = strategoReduce(s, action);
    expect(events[0]!.type).not.toBe('REJECTED');
  });
  test('heuristicBot produces an engine-accepted action', () => {
    const s = playState();
    const view = viewFor(s, 'RED');
    const action = heur(view, makeSeeded(2));
    const { events } = strategoReduce(s, action);
    expect(events[0]!.type).not.toBe('REJECTED');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- bots`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/bots/moves-from-view.ts`**

```ts
import { inBounds, isLake } from '../engine/board.js';
import { isMovable, isScout } from '../engine/pieceDefs.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function occupantAt(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
}

export function legalMovesFromView(view: PlayerView): { from: Square; to: Square }[] {
  const out: { from: Square; to: Square }[] = [];
  for (const p of view.pieces) {
    if (p.owner !== view.viewer) continue;
    // Own pieces always show rank; treat null rank defensively as immovable.
    if (p.rank === null || !isMovable(p.rank)) continue;
    const maxSteps = isScout(p.rank) ? 9 : 1;
    for (const [dr, dc] of DIRS) {
      for (let step = 1; step <= maxSteps; step++) {
        const to: Square = { r: p.pos.r + dr * step, c: p.pos.c + dc * step };
        if (!inBounds(to) || isLake(to)) break;
        const occ = occupantAt(view, to);
        if (!occ) { out.push({ from: p.pos, to }); continue; }
        if (occ.owner !== view.viewer) out.push({ from: p.pos, to });
        break;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `src/bots/types.ts`**

```ts
import type { Action } from '../engine/types.js';
import type { PlayerView } from '../engine/redact.js';
import type { Rng } from '../rng/rng.js';

export type Bot = (view: PlayerView, rng: Rng) => Action;
```

- [ ] **Step 5: Write `src/bots/random.ts`**

```ts
import type { Bot } from './types.js';
import { legalMovesFromView } from './moves-from-view.js';

export const randomBot: Bot = (view, rng) => {
  const moves = legalMovesFromView(view);
  if (moves.length === 0) return { type: 'RESIGN', color: view.viewer };
  const m = moves[rng.int(moves.length)]!;
  return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
};

// Re-export so tests can import a single random module surface.
export { legalMovesFromView };
```

- [ ] **Step 6: Write `src/bots/heuristic.ts`**

```ts
import type { Bot } from './types.js';
import { legalMovesFromView } from './moves-from-view.js';
import { rankValue } from '../engine/pieceDefs.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

function at(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
}

export const heuristicBot: Bot = (view, rng) => {
  const moves = legalMovesFromView(view);
  if (moves.length === 0) return { type: 'RESIGN', color: view.viewer };

  // 1) capture a known enemy flag
  for (const m of moves) {
    const target = at(view, m.to);
    if (target && target.owner !== view.viewer && target.rank === 'FLAG') {
      return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
    }
  }
  // 2) attack a revealed enemy we strictly outrank
  const winning = moves.filter((m) => {
    const target = at(view, m.to);
    const mover = at(view, m.from);
    if (!target || target.owner === view.viewer) return false;
    if (target.rank === null || mover?.rank == null) return false; // unknown → skip
    if (target.rank === 'BOMB' && mover.rank !== 'MINER') return false;
    return rankValue(mover.rank) > rankValue(target.rank);
  });
  if (winning.length > 0) {
    const m = winning[rng.int(winning.length)]!;
    return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
  }
  // 3) forward-biased random (RED advances toward row 0, BLUE toward row 9)
  const forward = moves.filter((m) => (view.viewer === 'RED' ? m.to.r < m.from.r : m.to.r > m.from.r));
  const pool = forward.length > 0 ? forward : moves;
  const m = pool[rng.int(pool.length)]!;
  return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
};
```

- [ ] **Step 7: Run to verify pass**

Run: `npm test -- bots && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add src/bots test/unit/bots.test.ts
git commit -m "feat: random + heuristic bots over redacted views"
```

---

## Task 15: Simulation harness

**Files:**
- Create: `src/sim/run.ts`
- Test: `test/sim/sim.test.ts`

**Interfaces:**
- Consumes: engine API, bots, RNG.
- Produces:
  - `playGame(opts: { seed: number; red: Bot; blue: Bot; maxPlies?: number }): GameResult` — sets up both sides with seeded random placement, then alternates bot actions until `GAME_OVER`. A bot that returns a two-square-violating or otherwise rejected MOVE is re-queried up to 5 times with a fresh rng draw; if still rejected, the game resolves as a loss for that player (`RESIGN`) to guarantee termination.
  - `runSims(opts: { games: number; seed: number; red: Bot; blue: Bot }): { redWins: number; blueWins: number; draws: number; avgPlies: number; reasons: Record<string, number> }`.
  - A `main()` that runs `runSims({ games: 200, seed: 1, red: heuristicBot, blue: randomBot })` and prints the summary; invoked when run via `npm run sim`.

- [ ] **Step 1: Write failing test `test/sim/sim.test.ts`** (runs under `SIM=1`)

```ts
import { describe, expect, test } from 'vitest';
import { playGame, runSims } from '../../src/sim/run.js';
import { randomBot } from '../../src/bots/random.js';
import { heuristicBot } from '../../src/bots/heuristic.js';

describe('simulation', () => {
  test('a seeded random-vs-random game terminates with a result', () => {
    const result = playGame({ seed: 123, red: randomBot, blue: randomBot });
    expect(result).toBeTruthy();
    expect(['FLAG_CAPTURED', 'NO_MOVES', 'RESIGN', 'PLY_CAP', 'DEAD_POSITION']).toContain(result.reason);
  });
  test('100 seeded games all terminate; tallies are consistent', () => {
    const stats = runSims({ games: 100, seed: 7, red: heuristicBot, blue: randomBot });
    expect(stats.redWins + stats.blueWins + stats.draws).toBe(100);
    expect(stats.avgPlies).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `SIM=1 npm run test:sim`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/sim/run.ts`**

```ts
import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../engine/index.js';
import type { Action, Color, GameResult, GameState } from '../engine/types.js';
import type { Bot } from '../bots/types.js';
import { randomBot } from '../bots/random.js';
import { heuristicBot } from '../bots/heuristic.js';
import { makeSeeded, type Rng } from '../rng/rng.js';

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

export function playGame(opts: { seed: number; red: Bot; blue: Bot; maxPlies?: number }): GameResult {
  const maxPlies = opts.maxPlies ?? 2000;
  let s = setupBothRandom(opts.seed, maxPlies);
  const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
  const rng: Rng = makeSeeded(opts.seed ^ 0x9e3779b9);

  let guard = maxPlies * 4 + 100;
  while (s.phase === 'PLAY' && guard-- > 0) {
    const color = s.turn;
    const view = viewFor(s, color);
    let applied = false;
    for (let attempt = 0; attempt < 5 && !applied; attempt++) {
      const action: Action = bots[color](view, rng);
      const { state, events } = strategoReduce(s, action);
      if (events[0]?.type === 'REJECTED') continue; // re-query with fresh rng draw
      s = state;
      applied = true;
    }
    if (!applied) {
      s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
  }
  return s.result ?? { winner: null, reason: 'PLY_CAP' };
}

export function runSims(opts: { games: number; seed: number; red: Bot; blue: Bot }): {
  redWins: number; blueWins: number; draws: number; avgPlies: number; reasons: Record<string, number>;
} {
  let redWins = 0, blueWins = 0, draws = 0, plies = 0;
  const reasons: Record<string, number> = {};
  for (let i = 0; i < opts.games; i++) {
    const maxPlies = 2000;
    let s = setupBothRandom(opts.seed + i, maxPlies);
    const bots: Record<Color, Bot> = { RED: opts.red, BLUE: opts.blue };
    const rng = makeSeeded((opts.seed + i) ^ 0x9e3779b9);
    let guard = maxPlies * 4 + 100;
    while (s.phase === 'PLAY' && guard-- > 0) {
      const color = s.turn;
      const view = viewFor(s, color);
      let applied = false;
      for (let attempt = 0; attempt < 5 && !applied; attempt++) {
        const action = bots[color](view, rng);
        const { state, events } = strategoReduce(s, action);
        if (events[0]?.type === 'REJECTED') continue;
        s = state; applied = true;
      }
      if (!applied) s = strategoReduce(s, { type: 'RESIGN', color }).state;
    }
    const result = s.result ?? { winner: null, reason: 'PLY_CAP' };
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    plies += s.plyCount;
    if (result.winner === 'RED') redWins++;
    else if (result.winner === 'BLUE') blueWins++;
    else draws++;
  }
  return { redWins, blueWins, draws, avgPlies: plies / opts.games, reasons };
}

// npm run sim
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const stats = runSims({ games: 200, seed: 1, red: heuristicBot, blue: randomBot });
  console.log('Stratego sim — heuristic (RED) vs random (BLUE), 200 games');
  console.log(stats);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `SIM=1 npm run test:sim`
Expected: PASS (both sim tests). Then `npm run sim` prints a stats summary.

- [ ] **Step 5: Commit**

```bash
git add src/sim/run.ts test/sim/sim.test.ts
git commit -m "feat: bot-vs-bot simulation harness + stats"
```

---

## Task 16: Property / invariant tests

**Files:**
- Create: `test/property/arbitraries.ts`, `test/property/invariants.test.ts`

**Interfaces:**
- Consumes: engine API, bots, RNG, fast-check.
- Produces: property tests asserting the spec's invariants.

- [ ] **Step 1: Write `test/property/arbitraries.ts`**

```ts
import fc from 'fast-check';
import type { Action, Square } from '../../src/engine/types.js';

const sq: fc.Arbitrary<Square> = fc.record({
  r: fc.integer({ min: -2, max: 11 }),
  c: fc.integer({ min: -2, max: 11 }),
});

// Deliberately includes illegal colors/ids/squares to exercise reject paths.
export const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant('MOVE' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
    from: sq, to: sq,
  }),
  fc.record({
    type: fc.constant('SETUP_PLACE' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
    pieceId: fc.constantFrom('RED-FLAG-0', 'BLUE-SCOUT-3', 'GHOST-1'),
    to: sq,
  }),
  fc.record({
    type: fc.constant('RESIGN' as const),
    color: fc.constantFrom('RED' as const, 'BLUE' as const),
  }),
);
```

- [ ] **Step 2: Write `test/property/invariants.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { arbAction } from './arbitraries.js';
import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../../src/engine/index.js';
import { makeSeeded } from '../../src/rng/rng.js';
import { randomBot } from '../../src/bots/random.js';
import type { GameState } from '../../src/engine/types.js';

function randomPlayState(seed: number): GameState {
  let s = createGame({ maxPlies: 400, seed });
  const rng = makeSeeded(seed);
  for (const color of ['RED', 'BLUE'] as const) {
    s = strategoReduce(s, { type: 'SETUP_RANDOM', color, order: rng.shuffle(rosterPieceIds(color)) }).state;
    s = strategoReduce(s, { type: 'SETUP_DONE', color }).state;
  }
  return s;
}

describe('reducer totality on junk', () => {
  test('never throws, never mutates, junk yields REJECTED', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), arbAction, (seed, action) => {
      const s = randomPlayState(seed);
      const snapshot = JSON.parse(JSON.stringify(s));
      const { state, events } = strategoReduce(s, action);
      expect(s).toEqual(snapshot); // no mutation of input
      // Either accepted (no REJECTED) or a single REJECTED with a reason
      if (events[0]?.type === 'REJECTED') {
        expect(state).toEqual(snapshot);
        expect(typeof events[0].reason).toBe('string');
      }
    }), { numRuns: 200 });
  });
});

describe('serialization round-trip', () => {
  test('state survives JSON round-trip after a random move', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      const action = randomBot(viewFor(s, s.turn), makeSeeded(seed));
      s = strategoReduce(s, action).state;
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }), { numRuns: 100 });
  });
});

describe('piece conservation', () => {
  test('every piece is either on-board or captured; counts never exceed roster', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      for (let i = 0; i < 30 && s.phase === 'PLAY'; i++) {
        const action = randomBot(viewFor(s, s.turn), makeSeeded(seed + i));
        s = strategoReduce(s, action).state;
      }
      expect(rosterPieceIds('RED')).toHaveLength(40);
      expect(Object.keys(s.pieces)).toHaveLength(80); // pieces never created/destroyed as records
    }), { numRuns: 50 });
  });
});

describe('redaction never leaks unrevealed enemy ranks', () => {
  test('enemy pieces that are not revealed have null rank in the view', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
      let s = randomPlayState(seed);
      for (let i = 0; i < 20 && s.phase === 'PLAY'; i++) {
        const action = randomBot(viewFor(s, s.turn), makeSeeded(seed + i));
        s = strategoReduce(s, action).state;
      }
      const view = viewFor(s, 'RED');
      for (const vp of view.pieces) {
        if (vp.owner === 'BLUE' && !vp.revealed) expect(vp.rank).toBeNull();
      }
    }), { numRuns: 50 });
  });
});

describe('random games always terminate', () => {
  test('random-vs-random reaches GAME_OVER within the guard', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 30 }), (seed) => {
      let s = randomPlayState(seed);
      let guard = 400 * 4 + 100;
      while (s.phase === 'PLAY' && guard-- > 0) {
        let applied = false;
        for (let a = 0; a < 5 && !applied; a++) {
          const action = randomBot(viewFor(s, s.turn), makeSeeded(seed * 31 + a));
          const { state, events } = strategoReduce(s, action);
          if (events[0]?.type === 'REJECTED') continue;
          s = state; applied = true;
        }
        if (!applied) s = strategoReduce(s, { type: 'RESIGN', color: s.turn }).state;
      }
      expect(s.phase).toBe('GAME_OVER');
    }), { numRuns: 30 });
  });
});
```

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- invariants`
Expected: PASS (all property suites).

- [ ] **Step 4: Commit**

```bash
git add test/property
git commit -m "test: property invariants (totality, conservation, redaction, termination)"
```

---

## Task 17: CLI

**Files:**
- Create: `src/cli/parse.ts`, `src/cli/render.ts`, `src/cli/main.ts`
- Test: `test/unit/cli-parse.test.ts`, `test/unit/cli-render.test.ts`

**Interfaces:**
- Consumes: engine API, bots, RNG, board algebraic helpers.
- Produces:
  - `parse.ts`: `parseCommand(input: string, viewer: Color): { kind: 'action'; action: Action } | { kind: 'meta'; meta: 'help' | 'board' | 'quit' } | { kind: 'error'; message: string }`. Understands `move a2 a3`, `setup preset balanced`, `setup random`, `done`, `resign`, `help`, `board`, `quit`.
  - `render.ts`: `renderView(view: PlayerView): string` — an ASCII 10×10 grid from the viewer's perspective, own pieces shown by rank initial, enemy shown as `?` (or rank initial if revealed), lakes as `~`, empty as `.`. `renderEvents(events: GameEvent[]): string`.
  - `main.ts`: readline loop; human plays one color (default RED) vs `heuristicBot`; uses `makeRandom()`; prints the redacted board for the side to move; drives setup then play; ends on `GAME_OVER`.

- [ ] **Step 1: Write failing tests**

`test/unit/cli-parse.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { parseCommand } from '../../src/cli/parse.js';

describe('parseCommand', () => {
  test('parses a move in algebraic notation', () => {
    const r = parseCommand('move a2 a3', 'RED');
    expect(r).toEqual({ kind: 'action', action: { type: 'MOVE', color: 'RED', from: { r: 8, c: 0 }, to: { r: 7, c: 0 } } });
  });
  test('parses setup preset', () => {
    const r = parseCommand('setup preset balanced', 'RED');
    expect(r).toEqual({ kind: 'action', action: { type: 'SETUP_PRESET', color: 'RED', preset: 'balanced' } });
  });
  test('parses done and resign and meta', () => {
    expect(parseCommand('done', 'BLUE')).toEqual({ kind: 'action', action: { type: 'SETUP_DONE', color: 'BLUE' } });
    expect(parseCommand('resign', 'RED')).toEqual({ kind: 'action', action: { type: 'RESIGN', color: 'RED' } });
    expect(parseCommand('help', 'RED')).toEqual({ kind: 'meta', meta: 'help' });
  });
  test('bad input → error', () => {
    expect(parseCommand('move zz9 a2', 'RED').kind).toBe('error');
    expect(parseCommand('flibble', 'RED').kind).toBe('error');
  });
});
```

`test/unit/cli-render.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { renderView } from '../../src/cli/render.js';
import { createGame, viewFor } from '../../src/engine/index.js';
import { presetPlacement } from '../../src/engine/setups.js';
import type { GameState } from '../../src/engine/types.js';

describe('renderView', () => {
  test('renders a 10-row grid with lakes and hides enemy ranks', () => {
    const s: GameState = createGame();
    for (const color of ['RED', 'BLUE'] as const) {
      const placement = presetPlacement(color, 'balanced')!;
      for (const [id, sq] of Object.entries(placement)) s.pieces[id]!.pos = sq;
    }
    s.phase = 'PLAY';
    const out = renderView(viewFor(s, 'RED'));
    const lines = out.trimEnd().split('\n');
    // at least 10 grid rows present
    const gridRows = lines.filter((l) => /[.?~A-Z]/.test(l));
    expect(gridRows.length).toBeGreaterThanOrEqual(10);
    expect(out).toContain('~'); // lakes rendered
    expect(out).toContain('?'); // hidden enemy pieces
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- cli-parse cli-render`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/cli/parse.ts`**

```ts
import { fromAlg } from '../engine/board.js';
import type { Action, Color } from '../engine/types.js';

type Parsed =
  | { kind: 'action'; action: Action }
  | { kind: 'meta'; meta: 'help' | 'board' | 'quit' }
  | { kind: 'error'; message: string };

export function parseCommand(input: string, viewer: Color): Parsed {
  const parts = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [cmd, ...rest] = parts;
  if (!cmd) return { kind: 'error', message: 'empty command' };

  switch (cmd) {
    case 'help': return { kind: 'meta', meta: 'help' };
    case 'board': return { kind: 'meta', meta: 'board' };
    case 'quit': case 'exit': return { kind: 'meta', meta: 'quit' };
    case 'done': return { kind: 'action', action: { type: 'SETUP_DONE', color: viewer } };
    case 'resign': return { kind: 'action', action: { type: 'RESIGN', color: viewer } };
    case 'move': {
      if (rest.length !== 2) return { kind: 'error', message: 'usage: move <from> <to>' };
      const from = fromAlg(rest[0]!);
      const to = fromAlg(rest[1]!);
      if (!from || !to) return { kind: 'error', message: 'bad square (use a1..j10)' };
      return { kind: 'action', action: { type: 'MOVE', color: viewer, from, to } };
    }
    case 'setup': {
      if (rest[0] === 'preset' && rest[1]) {
        return { kind: 'action', action: { type: 'SETUP_PRESET', color: viewer, preset: rest[1] } };
      }
      if (rest[0] === 'random') {
        // main.ts fills in the shuffled order; signal via preset sentinel handled there.
        return { kind: 'action', action: { type: 'SETUP_RANDOM', color: viewer, order: [] } };
      }
      return { kind: 'error', message: 'usage: setup preset <name> | setup random' };
    }
    default:
      return { kind: 'error', message: `unknown command: ${cmd}` };
  }
}
```

- [ ] **Step 4: Write `src/cli/render.ts`**

```ts
import { BOARD_SIZE, type GameEvent, type Rank } from '../engine/types.js';
import { isLake } from '../engine/board.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';

const INITIAL: Record<Rank, string> = {
  MARSHAL: 'M', GENERAL: 'G', COLONEL: 'C', MAJOR: 'J', CAPTAIN: 'P',
  LIEUTENANT: 'L', SERGEANT: 'S', MINER: 'I', SCOUT: 'T', SPY: 'Y',
  BOMB: 'B', FLAG: 'F',
};

function glyph(vp: VisiblePiece | undefined, viewer: PlayerView['viewer']): string {
  if (!vp) return '.';
  if (vp.rank === null) return '?'; // hidden enemy
  const ch = INITIAL[vp.rank];
  return vp.owner === viewer ? ch : ch.toLowerCase();
}

export function renderView(view: PlayerView): string {
  const byPos = new Map<string, VisiblePiece>();
  for (const p of view.pieces) byPos.set(`${p.pos.r},${p.pos.c}`, p);

  const lines: string[] = [];
  lines.push(`   ${Array.from({ length: BOARD_SIZE }, (_, c) => String.fromCharCode(97 + c)).join(' ')}`);
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rankLabel = String(BOARD_SIZE - r).padStart(2, ' ');
    const cells: string[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isLake({ r, c })) { cells.push('~'); continue; }
      cells.push(glyph(byPos.get(`${r},${c}`), view.viewer));
    }
    lines.push(`${rankLabel} ${cells.join(' ')}`);
  }
  lines.push(`(you are ${view.viewer}; UPPER=yours, lower=known enemy, ?=hidden, ~=lake)`);
  return lines.join('\n');
}

export function renderEvents(events: GameEvent[]): string {
  return events.map((e) => {
    switch (e.type) {
      case 'STRIKE': return `STRIKE ${e.attackerRank} vs ${e.defenderRank} → ${e.outcome}`;
      case 'FLAG_CAPTURED': return 'FLAG CAPTURED!';
      case 'BOMB_DEFUSED': return 'bomb defused';
      case 'GAME_OVER': return `GAME OVER: ${e.result.winner ?? 'draw'} (${e.result.reason})`;
      case 'REJECTED': return `rejected: ${e.reason}`;
      default: return '';
    }
  }).filter(Boolean).join('\n');
}
```

- [ ] **Step 5: Run render/parse tests**

Run: `npm test -- cli-parse cli-render`
Expected: PASS.

- [ ] **Step 6: Write `src/cli/main.ts`** (interactive loop; not unit-tested — smoke-run manually)

```ts
import { createInterface } from 'node:readline';
import { createGame, strategoReduce, viewFor, rosterPieceIds } from '../engine/index.js';
import type { Action, Color, GameState } from '../engine/types.js';
import { parseCommand } from './parse.js';
import { renderView, renderEvents } from './render.js';
import { heuristicBot } from '../bots/heuristic.js';
import { makeRandom } from '../rng/rng.js';

const HUMAN: Color = 'RED';
const BOT: Color = 'BLUE';
const rng = makeRandom();

function apply(s: GameState, action: Action): GameState {
  const { state, events } = strategoReduce(s, action);
  const msg = renderEvents(events);
  if (msg) console.log(msg);
  return state;
}

async function main() {
  let s = createGame();
  console.log('Stratego — you are RED vs a heuristic bot (BLUE).');
  console.log('Setup: type "setup preset balanced", "setup random", or place pieces, then "done".');

  // Bot sets up immediately (random).
  s = apply(s, { type: 'SETUP_RANDOM', color: BOT, order: rng.shuffle(rosterPieceIds(BOT)) });
  s = apply(s, { type: 'SETUP_DONE', color: BOT });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  console.log(renderView(viewFor(s, HUMAN)));
  while (s.phase !== 'GAME_OVER') {
    if (s.phase === 'PLAY' && s.turn === BOT) {
      s = apply(s, heuristicBot(viewFor(s, BOT), rng));
      if (s.phase !== 'GAME_OVER') console.log(renderView(viewFor(s, HUMAN)));
      continue;
    }
    const line = await ask(s.phase === 'SETUP' ? 'setup> ' : 'move> ');
    const parsed = parseCommand(line, HUMAN);
    if (parsed.kind === 'meta') {
      if (parsed.meta === 'quit') break;
      if (parsed.meta === 'board') console.log(renderView(viewFor(s, HUMAN)));
      if (parsed.meta === 'help') console.log('commands: move a2 a3 | setup preset balanced | setup random | done | resign | board | quit');
      continue;
    }
    if (parsed.kind === 'error') { console.log(parsed.message); continue; }
    let action = parsed.action;
    if (action.type === 'SETUP_RANDOM') action = { ...action, order: rng.shuffle(rosterPieceIds(HUMAN)) };
    s = apply(s, action);
    if (s.phase === 'PLAY' && s.turn === HUMAN) console.log(renderView(viewFor(s, HUMAN)));
  }
  console.log('Game over.');
  rl.close();
}

main();
```

- [ ] **Step 7: Smoke-run the CLI**

Run: `printf 'setup random\ndone\nboard\nquit\n' | npm run cli`
Expected: prints boards, accepts setup, no crash, exits.

- [ ] **Step 8: Commit**

```bash
git add src/cli test/unit/cli-parse.test.ts test/unit/cli-render.test.ts
git commit -m "feat: interactive CLI (parse, render, human-vs-bot loop)"
```

---

## Task 18: README & final verification

**Files:**
- Create: `stratego/README.md`

**Interfaces:** none.

- [ ] **Step 1: Write `README.md`**

Document: what this is (faithful Stratego engine, terminal-first), the rules source + documented decisions (link the design spec), how to run (`npm test`, `npm run typecheck`, `npm run sim`, `npm run cli`), the architecture (pure reducer, registry, redaction, RNG injection), the v2/ML roadmap (web UI over the same engine; `PlayerView` as ML observation space, legal-action list as action space), and the deferred tournament variants.

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && SIM=1 npm run test:sim && npm run sim`
Expected: typecheck clean; all unit + property tests pass; sim tests pass; `npm run sim` prints stats with `redWins + blueWins + draws === 200` and every game terminated.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README and roadmap"
```

---

## Self-Review Notes

- **Spec coverage:** board/lakes/roster (Task 2), movement incl. Scout (Task 6), combat incl. Spy/Miner/Bomb/Flag (Task 4), attack-as-MOVE + both-reveal + bomb-stays (Task 11), two-square rule (Task 7), win/loss/draw with ply-cap + dead-position (Tasks 7/11), setup presets+random+manual (Tasks 8/17), redaction (Task 12), bots (Task 14), sims (Task 15), property invariants (Task 16), CLI (Task 17). Deferred variants documented (README, Task 18).
- **Determinism/ML readiness:** JSON state (Task 5 test), seeded RNG (Task 9), redacted view = observation space (Task 12) — all covered.
- **Type consistency:** `strategoReduce`, `viewFor`, `PlayerView`, `legalMovesFromView`, `Bot`, `resolveCombat`, `destinationsFor` names are used identically across tasks.
