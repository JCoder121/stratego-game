import { randomBytes } from 'node:crypto';
import {
  createGame, rosterPieceIds, strategoReduce, validateAction, viewFor,
} from '../engine/index.js';
import type { Action, Color, GameEvent, GameState, PieceId, Square } from '../engine/index.js';
import { randomBot } from '../bots/random.js';
import { heuristicBot } from '../bots/heuristic.js';
import type { Bot } from '../bots/types.js';
import { makeRandom, makeSeeded } from '../rng/rng.js';
import type { Rng } from '../rng/rng.js';
import type {
  BotKind, CapturedRanks, ClientMsg, LastMove, Mode, PlayAction, Role, ServerMsg, StrikeSummary,
  WatchSpeed, WatchView,
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
  /** Bot construction hook, overridable for tests (e.g. to inject a throwing bot). */
  botFactory?: (kind: BotKind) => Bot;
}

interface Member {
  role: Role;
  connected: boolean;
  send: (m: ServerMsg) => void;
  lastSeq: number;
}

/** vs-bot pacing (HUMAN_VS_BOT and construction-time bot moves outside watch mode). */
export const BOT_DELAY_MS = 500;

function randomToken(): string {
  return randomBytes(8).toString('hex');
}

const DEFAULT_BOTS: Record<BotKind, Bot> = { random: randomBot, heuristic: heuristicBot };
function defaultBotFactory(kind: BotKind): Bot {
  return DEFAULT_BOTS[kind];
}

const other = (c: Color): Color => (c === 'RED' ? 'BLUE' : 'RED');

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
  private readonly botKinds: Partial<Record<Color, BotKind>> = {};
  private readonly botFactory: (kind: BotKind) => Bot;
  private readonly rng: Rng;
  private seq = 0;
  private timer: unknown = null;
  /** Only meaningful for BOT_VS_BOT; always true otherwise (pump() only consults it in BOT_VS_BOT). */
  private playing: boolean;
  private watchSpeed: WatchSpeed;
  private readonly rematchVotes = new Set<Color>();

  constructor(private readonly opts: RoomOpts) {
    this.botFactory = opts.botFactory ?? defaultBotFactory;
    this.rng = opts.seed !== undefined ? makeSeeded(opts.seed) : makeRandom();
    this.state = createGame({ seed: opts.seed });
    this.playing = opts.mode !== 'BOT_VS_BOT';
    this.watchSpeed = opts.watchSpeed ?? 1000;

    if (opts.mode === 'HUMAN_VS_BOT') {
      this.setupBotSeat('BLUE', opts.bots?.BLUE ?? 'heuristic');
    } else if (opts.mode === 'BOT_VS_BOT') {
      this.setupBotSeat('RED', opts.bots?.RED ?? 'heuristic');
      this.setupBotSeat('BLUE', opts.bots?.BLUE ?? 'heuristic');
    }
    this.pump();
  }

  /** Bot seats set up (random shuffle) + SETUP_DONE immediately at construction, and again on rematch. */
  private setupBotSeat(color: Color, kind: BotKind): void {
    if (!this.botSeats[color]) {
      this.botKinds[color] = kind;
      this.botSeats[color] = this.botFactory(kind);
    }
    const order = this.rng.shuffle(rosterPieceIds(color));
    this.state = strategoReduce(this.state, { type: 'SETUP_RANDOM', color, order }).state;
    this.state = strategoReduce(this.state, { type: 'SETUP_DONE', color }).state;
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
    this.members.set(token, { role, connected: true, send, lastSeq: 0 });
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
        this.handleAction(member, msg);
        return;
      case 'REMATCH_REQUEST':
        this.handleRematch(member);
        return;
      case 'WATCH_CONTROL':
        this.handleWatchControl(msg);
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

  private broadcastGameOver(): void {
    if (!this.state.result) return;
    const msg: ServerMsg = {
      t: 'GAME_OVER',
      result: this.state.result,
      finalView: watchView(this.state),
      captured: capturedRanks(this.state),
    };
    for (const m of this.members.values()) if (m.connected) m.send(msg);
  }

  private sendTo(role: Role, msg: ServerMsg): void {
    for (const m of this.members.values()) {
      if (m.role === role) {
        if (m.connected) m.send(msg);
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
    if (this.state.phase === 'PLAY') {
      this.broadcastViews(undefined);
      this.pump();
    }
  }

  // ---- Play actions (MOVE/RESIGN) ----

  private handleAction(member: Member, msg: Extract<ClientMsg, { t: 'ACTION' }>): void {
    if (!member.connected) return; // never invoke a stale send callback
    if (member.role !== 'RED' && member.role !== 'BLUE') {
      member.send({ t: 'ERROR', code: 'INVALID_ACTION', msg: 'spectators cannot act' });
      return;
    }
    if (msg.seq <= member.lastSeq) return; // stale, silently dropped
    member.lastSeq = msg.seq;

    const action = msg.action;
    if (action.color !== member.role) {
      member.send({ t: 'ERROR', code: 'INVALID_ACTION', msg: 'action color does not match your seat' });
      return;
    }

    // RESIGN is allowed from either seated player at any time during PLAY, unlike MOVE — the
    // engine itself turn-gates RESIGN (validateAction), so an off-turn resign is handled here.
    if (action.type === 'RESIGN') {
      if (this.state.phase !== 'PLAY') {
        member.send({ t: 'ERROR', code: 'INVALID_ACTION', msg: 'game is not in play' });
        return;
      }
      this.resign(action.color);
      this.pump();
      return;
    }

    if (this.state.phase === 'PLAY' && action.color !== this.state.turn) {
      member.send({ t: 'ERROR', code: 'NOT_YOUR_TURN', msg: `it is ${this.state.turn}'s turn` });
      return;
    }
    const err = this.applyChecked(action);
    if (err) {
      member.send({ t: 'ERROR', code: 'INVALID_ACTION', msg: err });
      return;
    }
    this.pump();
  }

  /** On-turn resign goes through the normal engine reducer path (validateAction/strategoReduce
   * enforce turn there, matching bot-crash resigns). Off-turn resign is handled server-side —
   * the engine can't express it — but broadcasts GAME_OVER exactly the same way applyChecked
   * does for a reducer-driven game end. */
  private resign(color: Color): void {
    if (color === this.state.turn) {
      this.applyChecked({ type: 'RESIGN', color });
      return;
    }
    this.clearTimer();
    this.state = { ...this.state, phase: 'GAME_OVER', result: { winner: other(color), reason: 'RESIGN' } };
    this.broadcastGameOver();
  }

  /** Validates + reduces a play action, adopts state, broadcasts VIEW (w/ lastMove) and, if the
   * game just ended, GAME_OVER — exactly once, since a GAME_OVER'd state rejects all further actions. */
  private applyChecked(action: PlayAction): string | null {
    const err = validateAction(this.state, action);
    if (err) return err;
    const result = strategoReduce(this.state, action);
    const rejected = result.events.find((e): e is Extract<GameEvent, { type: 'REJECTED' }> => e.type === 'REJECTED');
    if (rejected) return rejected.reason;

    this.state = result.state;
    this.broadcastViews(this.buildLastMove(action, result.events));
    if (result.events.some((e) => e.type === 'GAME_OVER')) this.broadcastGameOver();
    return null;
  }

  private buildLastMove(action: PlayAction, events: GameEvent[]): LastMove | undefined {
    if (action.type !== 'MOVE') return undefined;
    const strikeEvent = events.find((e): e is Extract<GameEvent, { type: 'STRIKE' }> => e.type === 'STRIKE');
    const strike: StrikeSummary | undefined = strikeEvent
      ? { attackerRank: strikeEvent.attackerRank, defenderRank: strikeEvent.defenderRank, outcome: strikeEvent.outcome }
      : undefined;
    return { from: action.from, to: action.to, by: action.color, strike };
  }

  // ---- Bot pacing ----

  private delayMs(): number {
    if (this.opts.mode === 'BOT_VS_BOT') return this.watchSpeed === 'step' ? 0 : this.watchSpeed;
    return BOT_DELAY_MS;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.opts.scheduler.clear(this.timer);
      this.timer = null;
    }
  }

  private runBotPly(bot: Bot): void {
    try {
      const action = bot(viewFor(this.state, this.state.turn), this.rng);
      if (action.type !== 'MOVE' && action.type !== 'RESIGN') throw new Error('bot returned a non-play action');
      const err = this.applyChecked(action);
      if (err) throw new Error(err);
    } catch {
      this.applyChecked({ type: 'RESIGN', color: this.state.turn });
    }
  }

  private pump(): void {
    if (this.state.phase !== 'PLAY') return;
    const bot = this.botSeats[this.state.turn];
    if (!bot || (this.opts.mode === 'BOT_VS_BOT' && !this.playing)) return;
    this.timer = this.opts.scheduler.set(() => {
      this.timer = null;
      this.runBotPly(bot);
      this.pump();
    }, this.delayMs());
  }

  // ---- Watch controls (BOT_VS_BOT spectating) ----

  private handleWatchControl(msg: Extract<ClientMsg, { t: 'WATCH_CONTROL' }>): void {
    if (this.opts.mode !== 'BOT_VS_BOT') return;
    switch (msg.control) {
      case 'play':
        this.playing = true;
        this.pump();
        return;
      case 'pause':
        this.playing = false;
        this.clearTimer();
        return;
      case 'step': {
        this.playing = false; // otherwise a later 'speed' would silently resume autoplay
        this.clearTimer();
        const bot = this.botSeats[this.state.turn];
        if (this.state.phase === 'PLAY' && bot) this.runBotPly(bot);
        return;
      }
      case 'speed':
        if (msg.speed !== undefined) this.watchSpeed = msg.speed;
        if (this.playing) {
          this.clearTimer();
          this.pump();
        }
        return;
    }
  }

  // ---- Rematch ----

  private requiredRematchVoters(): Color[] {
    switch (this.opts.mode) {
      case 'HUMAN_VS_HUMAN': return ['RED', 'BLUE'];
      case 'HUMAN_VS_BOT': return ['RED'];
      case 'BOT_VS_BOT': return [];
    }
  }

  private handleRematch(member: Member): void {
    if (!member.connected) return;
    if (this.state.phase !== 'GAME_OVER') {
      member.send({ t: 'ERROR', code: 'INVALID_ACTION', msg: 'rematch can only be requested once the game is over' });
      return;
    }
    if (this.opts.mode === 'BOT_VS_BOT') {
      if (member.role === 'SPECTATOR') this.doRematch();
      return;
    }
    if (member.role !== 'RED' && member.role !== 'BLUE') return;
    this.rematchVotes.add(member.role);
    if (this.requiredRematchVoters().every((r) => this.rematchVotes.has(r))) {
      this.doRematch();
    } else {
      this.broadcastRematchState();
    }
  }

  private broadcastRematchState(): void {
    const msg: ServerMsg = { t: 'REMATCH_STATE', votes: [...this.rematchVotes] };
    for (const m of this.members.values()) if (m.connected) m.send(msg);
  }

  private doRematch(): void {
    this.clearTimer();
    this.rematchVotes.clear();
    this.state = createGame({ seed: this.opts.seed });
    for (const color of ['RED', 'BLUE'] as const) {
      if (this.botSeats[color]) this.setupBotSeat(color, this.botKinds[color]!);
    }
    if (this.opts.mode === 'BOT_VS_BOT') this.playing = false;
    this.broadcastSetupStatus();
    if (this.state.phase === 'PLAY') this.broadcastViews(undefined);
    this.pump();
  }

  private viewMsg(role: Role, lastMove?: LastMove): ServerMsg {
    const view = role === 'SPECTATOR' ? watchView(this.state) : viewFor(this.state, role);
    return { t: 'VIEW', view, captured: capturedRanks(this.state), lastMove, seq: this.seq };
  }
}
