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
