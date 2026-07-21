import type { Action, Color, GameResult, Phase, PieceId, Rank, Square } from '../engine/index.js';
import type { PlayerView } from '../engine/index.js';

export type Mode = 'HUMAN_VS_HUMAN' | 'HUMAN_VS_BOT' | 'BOT_VS_BOT';
export type BotKind = 'random' | 'heuristic';
export type WatchSpeed = 500 | 1000 | 'step';
export type Role = Color | 'SPECTATOR';

/** Play-phase actions only (MOVE/RESIGN); setup actions use COMMIT_SETUP. */
export type PlayAction = Extract<Action, { type: 'MOVE' } | { type: 'RESIGN' }>;

/** All-revealed view for spectators and game-over broadcast. */
export interface WatchView {
  phase: Phase;
  turn: Color;
  plyCount: number;
  pieces: { owner: Color; pos: Square; rank: Rank; revealed: boolean }[];
  result: GameResult | null;
}

export interface StrikeSummary {
  attackerRank: Rank;
  defenderRank: Rank;
  outcome: 'ATTACKER' | 'DEFENDER' | 'BOTH';
}
export interface LastMove { from: Square; to: Square; by: Color; strike?: StrikeSummary }

/** Ranks are public once captured (every capture goes through a rank-revealing strike). */
export type CapturedRanks = Record<Color, Rank[]>;

export type ClientMsg =
  | { t: 'CREATE_ROOM'; mode: Mode; botDifficulty?: BotKind; bots?: { RED: BotKind; BLUE: BotKind }; watchSpeed?: WatchSpeed }
  | { t: 'JOIN_ROOM'; code: string }
  | { t: 'REJOIN'; code: string; token: string }
  | { t: 'COMMIT_SETUP'; placement: [PieceId, Square][] }
  | { t: 'ACTION'; action: PlayAction; seq: number }
  | { t: 'REMATCH_REQUEST' }
  | { t: 'WATCH_CONTROL'; control: 'play' | 'pause' | 'step' | 'speed'; speed?: WatchSpeed };

export type ServerMsg =
  | { t: 'ROOM_CREATED'; code: string; token: string; role: Role }
  | { t: 'JOINED'; code: string; token: string; role: Role }
  | { t: 'VIEW'; view: PlayerView | WatchView; captured: CapturedRanks; lastMove?: LastMove; seq: number }
  | { t: 'SETUP_STATUS'; ready: Record<Color, boolean> }
  | { t: 'GAME_OVER'; result: GameResult; finalView: WatchView; captured: CapturedRanks }
  | { t: 'OPPONENT_STATUS'; seat: Color; connected: boolean }
  | { t: 'REMATCH_STATE'; votes: Role[] }
  | { t: 'ERROR'; code: 'BAD_MSG' | 'NO_ROOM' | 'ROOM_FULL' | 'BAD_TOKEN' | 'NOT_YOUR_TURN' | 'INVALID_ACTION' | 'BAD_SETUP'; msg: string };

const CLIENT_TYPES = new Set(['CREATE_ROOM', 'JOIN_ROOM', 'REJOIN', 'COMMIT_SETUP', 'ACTION', 'REMATCH_REQUEST', 'WATCH_CONTROL']);

const MODES = new Set<Mode>(['HUMAN_VS_HUMAN', 'HUMAN_VS_BOT', 'BOT_VS_BOT']);
const BOT_KINDS = new Set<BotKind>(['random', 'heuristic']);
const WATCH_SPEEDS = new Set<WatchSpeed>([500, 1000, 'step']);
/** Numeric-only speeds accepted in WATCH_CONTROL's `speed` field (no 'step' there). */
const WATCH_CONTROL_SPEEDS = new Set<number>([500, 1000]);
const WATCH_CONTROLS = new Set(['play', 'pause', 'step', 'speed']);

function isSquare(x: unknown): x is Square {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return typeof s.r === 'number' && Number.isFinite(s.r) && typeof s.c === 'number' && Number.isFinite(s.c);
}

function isPlacement(x: unknown): x is [PieceId, Square][] {
  if (!Array.isArray(x)) return false;
  for (const entry of x) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [pieceId, sq] = entry as [unknown, unknown];
    if (typeof pieceId !== 'string') return false;
    if (!isSquare(sq)) return false;
  }
  return true;
}

function isBotKind(x: unknown): x is BotKind {
  return typeof x === 'string' && BOT_KINDS.has(x as BotKind);
}

function isWatchSpeed(x: unknown): x is WatchSpeed {
  return (typeof x === 'number' || typeof x === 'string') && WATCH_SPEEDS.has(x as WatchSpeed);
}

function isCreateRoom(m: Record<string, unknown>): boolean {
  if (typeof m.mode !== 'string' || !MODES.has(m.mode as Mode)) return false;
  if (m.botDifficulty !== undefined && !isBotKind(m.botDifficulty)) return false;
  if (m.bots !== undefined) {
    if (typeof m.bots !== 'object' || m.bots === null) return false;
    const bots = m.bots as Record<string, unknown>;
    if (!isBotKind(bots.RED) || !isBotKind(bots.BLUE)) return false;
  }
  if (m.watchSpeed !== undefined && !isWatchSpeed(m.watchSpeed)) return false;
  return true;
}

function isWatchControl(m: Record<string, unknown>): boolean {
  if (typeof m.control !== 'string' || !WATCH_CONTROLS.has(m.control)) return false;
  if (m.speed !== undefined && !(typeof m.speed === 'number' && WATCH_CONTROL_SPEEDS.has(m.speed))) return false;
  return true;
}

export function isClientMsg(x: unknown): x is ClientMsg {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.t !== 'string' || !CLIENT_TYPES.has(m.t)) return false;
  switch (m.t) {
    case 'JOIN_ROOM': return typeof m.code === 'string';
    case 'REJOIN': return typeof m.code === 'string' && typeof m.token === 'string';
    case 'COMMIT_SETUP': return isPlacement(m.placement);
    case 'ACTION': return typeof m.action === 'object' && m.action !== null && typeof m.seq === 'number' && ((m.action as { type?: unknown }).type === 'MOVE' || (m.action as { type?: unknown }).type === 'RESIGN');
    case 'CREATE_ROOM': return isCreateRoom(m);
    case 'WATCH_CONTROL': return isWatchControl(m);
    default: return true;
  }
}
