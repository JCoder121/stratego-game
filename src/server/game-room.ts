import { randomBytes } from 'node:crypto';
import {
  createGame, rosterPieceIds, strategoReduce, validateAction, viewFor,
} from '../engine/index.js';
import type { Action, Color, GameState, PieceId, Square } from '../engine/index.js';
import { randomBot } from '../bots/random.js';
import { heuristicBot } from '../bots/heuristic.js';
import type { Bot } from '../bots/types.js';
import { makeRandom, makeSeeded } from '../rng/rng.js';
import type { Rng } from '../rng/rng.js';
import type {
  BotKind, CapturedRanks, ClientMsg, LastMove, Mode, Role, ServerMsg, WatchSpeed, WatchView,
} from './protocol.js';

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

export interface RoomOpts {
  mode: Mode;
  bots?: Partial<Record<Color, BotKind>>;
  watchSpeed?: WatchSpeed;
  seed?: number;
  scheduler: Scheduler;
  onEmptyChange?: (empty: boolean) => void;
}

interface Member {
  role: Role;
  connected: boolean;
  send: (m: ServerMsg) => void;
}

function randomToken(): string {
  return randomBytes(8).toString('hex');
}

function botFor(kind: BotKind): Bot {
  return kind === 'random' ? randomBot : heuristicBot;
}

/** Ranks are public once captured (every capture goes through a rank-revealing strike). */
export function capturedRanks(state: GameState): CapturedRanks {
  const out: CapturedRanks = { RED: [], BLUE: [] };
  for (const p of Object.values(state.pieces)) if (p.pos === null) out[p.owner].push(p.rank);
  return out;
}

/** All-revealed view for spectators and game-over broadcast: real ranks, no ids. */
export function watchView(state: GameState): WatchView {
  const pieces: WatchView['pieces'] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.pos === null) continue;
    pieces.push({ owner: p.owner, pos: p.pos, rank: p.rank, revealed: p.revealed });
  }
  return { phase: state.phase, turn: state.turn, plyCount: state.plyCount, pieces, result: state.result };
}

export class GameRoom {
  private state: GameState;
  private readonly members = new Map<string, Member>();
  private readonly botSeats: Partial<Record<Color, Bot>> = {};
  private readonly rng: Rng;
  private seq = 0;

  constructor(private readonly opts: RoomOpts) {
    this.rng = opts.seed !== undefined ? makeSeeded(opts.seed) : makeRandom();
    this.state = createGame({ seed: opts.seed });

    if (opts.mode === 'HUMAN_VS_BOT') {
      this.setupBotSeat('BLUE', opts.bots?.BLUE ?? 'heuristic');
    } else if (opts.mode === 'BOT_VS_BOT') {
      this.setupBotSeat('RED', opts.bots?.RED ?? 'heuristic');
      this.setupBotSeat('BLUE', opts.bots?.BLUE ?? 'heuristic');
    }
  }

  /** Bot seats set up (random shuffle) + SETUP_DONE immediately at construction. */
  private setupBotSeat(color: Color, kind: BotKind): void {
    const order = this.rng.shuffle(rosterPieceIds(color));
    this.state = strategoReduce(this.state, { type: 'SETUP_RANDOM', color, order }).state;
    this.state = strategoReduce(this.state, { type: 'SETUP_DONE', color }).state;
    this.botSeats[color] = botFor(kind);
  }

  private seatTaken(color: Color): boolean {
    for (const m of this.members.values()) if (m.role === color) return true;
    return false;
  }

  private assignSeat(): Role | null {
    switch (this.opts.mode) {
      case 'HUMAN_VS_HUMAN':
        if (!this.seatTaken('RED')) return 'RED';
        if (!this.seatTaken('BLUE')) return 'BLUE';
        return null;
      case 'HUMAN_VS_BOT':
        if (!this.seatTaken('RED')) return 'RED';
        return null;
      case 'BOT_VS_BOT':
        return 'SPECTATOR';
    }
  }

  joinHuman(send: (msg: ServerMsg) => void): { token: string; role: Role } | null {
    const role = this.assignSeat();
    if (role === null) return null;
    const token = randomToken();
    this.members.set(token, { role, connected: true, send });
    if (this.state.phase === 'SETUP') {
      this.broadcastSetupStatus();
    } else {
      send(this.viewMsg(role));
    }
    this.opts.onEmptyChange?.(false);
    return { token, role };
  }

  rejoin(token: string, send: (msg: ServerMsg) => void): Role | null {
    const m = this.members.get(token);
    if (!m) return null;
    m.connected = true;
    m.send = send;
    if (this.state.phase === 'SETUP') {
      send({ t: 'SETUP_STATUS', ready: { RED: this.state.setupDone.RED, BLUE: this.state.setupDone.BLUE } });
    } else {
      send(this.viewMsg(m.role));
    }
    if (m.role === 'RED' || m.role === 'BLUE') this.notifyOpponentStatus(m.role, true);
    this.opts.onEmptyChange?.(false);
    return m.role;
  }

  disconnect(token: string): void {
    const m = this.members.get(token);
    if (!m) return;
    m.connected = false;
    if (m.role === 'RED' || m.role === 'BLUE') this.notifyOpponentStatus(m.role, false);
    if (this.allDisconnected()) this.opts.onEmptyChange?.(true);
  }

  handle(token: string, msg: ClientMsg): void {
    const member = this.members.get(token);
    if (!member) return;
    switch (msg.t) {
      case 'COMMIT_SETUP':
        if (member.role !== 'RED' && member.role !== 'BLUE') return;
        this.commitSetup(member.role, msg.placement);
        return;
      case 'ACTION':
      case 'REMATCH_REQUEST':
      case 'WATCH_CONTROL':
        // Play actions, rematch voting, and watch controls: implemented in Task 4.
        return;
      default:
        return;
    }
  }

  private allDisconnected(): boolean {
    for (const m of this.members.values()) if (m.connected) return false;
    return true;
  }

  private notifyOpponentStatus(seat: Color, connected: boolean): void {
    const msg: ServerMsg = { t: 'OPPONENT_STATUS', seat, connected };
    for (const m of this.members.values()) {
      if (m.role === seat) continue;
      if (m.connected) m.send(msg);
    }
  }

  private broadcastSetupStatus(): void {
    const ready: Record<Color, boolean> = { RED: this.state.setupDone.RED, BLUE: this.state.setupDone.BLUE };
    const msg: ServerMsg = { t: 'SETUP_STATUS', ready };
    for (const m of this.members.values()) if (m.connected) m.send(msg);
  }

  private broadcastViews(lastMove: LastMove | undefined): void {
    this.seq++;
    for (const m of this.members.values()) if (m.connected) m.send(this.viewMsg(m.role, lastMove));
  }

  private sendTo(role: Role, msg: ServerMsg): void {
    for (const m of this.members.values()) {
      if (m.role === role) {
        m.send(msg);
        return;
      }
    }
  }

  private commitSetup(color: Color, placement: [PieceId, Square][]): void {
    let scratch = this.state;
    for (const [pieceId, to] of placement) {
      const action: Action = { type: 'SETUP_PLACE', color, pieceId, to };
      const err = validateAction(scratch, action);
      if (err) return this.sendTo(color, { t: 'ERROR', code: 'BAD_SETUP', msg: err });
      const result = strategoReduce(scratch, action);
      const rejected = result.events.find((e) => e.type === 'REJECTED');
      if (rejected) return this.sendTo(color, { t: 'ERROR', code: 'BAD_SETUP', msg: (rejected as { reason: string }).reason });
      scratch = result.state;
    }
    const done: Action = { type: 'SETUP_DONE', color };
    const err = validateAction(scratch, done);
    if (err) return this.sendTo(color, { t: 'ERROR', code: 'BAD_SETUP', msg: err });
    const result = strategoReduce(scratch, done);
    const rejected = result.events.find((e) => e.type === 'REJECTED');
    if (rejected) return this.sendTo(color, { t: 'ERROR', code: 'BAD_SETUP', msg: (rejected as { reason: string }).reason });

    this.state = result.state; // adopt atomically
    this.broadcastSetupStatus();
    if (this.state.phase === 'PLAY') this.broadcastViews(undefined);
  }

  private viewMsg(role: Role, lastMove?: LastMove): ServerMsg {
    const view = role === 'SPECTATOR' ? watchView(this.state) : viewFor(this.state, role);
    return { t: 'VIEW', view, captured: capturedRanks(this.state), lastMove, seq: this.seq };
  }
}
