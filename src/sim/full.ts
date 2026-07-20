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
