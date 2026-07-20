import type { Bot } from './types.js';
import { legalMovesFromView } from './moves-from-view.js';
import { rankValue } from '../engine/pieceDefs.js';
import { resolveCombat } from '../engine/combat.js';
import type { PlayerView, VisiblePiece } from '../engine/redact.js';
import type { Square } from '../engine/types.js';

function at(view: PlayerView, sq: Square): VisiblePiece | undefined {
  return view.pieces.find((p) => p.pos.r === sq.r && p.pos.c === sq.c);
}

// Max rank value allowed to probe an unknown enemy piece. Scouts are cheap
// information-gatherers; miners additionally survive (and clear) bombs, the
// most common unknown killer. Everything above them stays out of unknowns.
const PROBE_VALUE_MAX = rankValue('MINER');

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
  // 2) attack a revealed enemy we are known to beat (combat rules, incl. spy>marshal, miner>bomb)
  const winning = moves.filter((m) => {
    const target = at(view, m.to);
    const mover = at(view, m.from);
    if (!target || target.owner === view.viewer) return false;
    if (target.rank === null || mover?.rank == null) return false; // unknown → not a known win
    return resolveCombat(mover.rank, target.rank) === 'ATTACKER';
  });
  if (winning.length > 0) {
    const m = winning[rng.int(winning.length)]!;
    return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
  }
  // 3) forward-biased random over SAFE moves: empty squares, plus unknown-probes
  //    by cheap pieces. Known-losing/trading attacks and unknown-attacks by
  //    valuable pieces are excluded — that material bleed is why v1 lost to random.
  const safe = moves.filter((m) => {
    const target = at(view, m.to);
    if (!target || target.owner === view.viewer) return true; // empty square
    const mover = at(view, m.from);
    if (mover?.rank == null) return false;
    if (target.rank === null) return rankValue(mover.rank) <= PROBE_VALUE_MAX; // probe unknowns cheaply
    return false; // known non-win → never
  });
  if (safe.length > 0) {
    // 3a) pursue: prefer safe moves that close distance to a revealed enemy
    //     the mover is known to beat (miners chase bombs, spy chases marshal).
    const chasing = safe.filter((m) => {
      const mover = at(view, m.from);
      if (mover?.rank == null) return false;
      const targets = view.pieces.filter(
        (p) => p.owner !== view.viewer && p.rank !== null && resolveCombat(mover.rank!, p.rank) === 'ATTACKER',
      );
      if (targets.length === 0) return false;
      const dist = (a: Square, b: Square) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
      const before = Math.min(...targets.map((t) => dist(m.from, t.pos)));
      const after = Math.min(...targets.map((t) => dist(m.to, t.pos)));
      return after < before;
    });
    const forward = safe.filter((m) => (view.viewer === 'RED' ? m.to.r < m.from.r : m.to.r > m.from.r));
    const pool = chasing.length > 0 ? chasing : forward.length > 0 ? forward : safe;
    const m = pool[rng.int(pool.length)]!;
    return { type: 'MOVE', color: view.viewer, from: m.from, to: m.to };
  }
  // 4) forced: every legal move is a bad attack — sacrifice the cheapest attacker
  let best = moves[0]!;
  let bestVal = Infinity;
  for (const m of moves) {
    const v = rankValue(at(view, m.from)?.rank ?? 'MARSHAL');
    if (v < bestVal) { bestVal = v; best = m; }
  }
  return { type: 'MOVE', color: view.viewer, from: best.from, to: best.to };
};
