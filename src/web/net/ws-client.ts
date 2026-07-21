import type { ClientMsg, Role, ServerMsg } from '../../server/protocol.js';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface Net {
  send(msg: ClientMsg): void;
  /** Subscribe to incoming server messages; returns an unsubscribe fn. */
  onMsg(fn: (msg: ServerMsg) => void): () => void;
  /** Subscribe to socket lifecycle status; returns an unsubscribe fn. */
  onStatus(fn: (s: ConnStatus) => void): () => void;
}

/**
 * Minimal shape `connect()` needs from a socket — matches the browser `WebSocket` API surface it
 * actually uses. Letting `connect()` take a factory that returns this (rather than reaching for
 * the global `WebSocket` directly) means tests can inject a fake socket and exercise the real
 * queueing/backoff/REJOIN logic in plain Node, no DOM required.
 */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: { data?: unknown }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Spec-fixed value of `WebSocket.OPEN` — hardcoded so this module never has to read the global
 *  `WebSocket` constructor just to check a ready-state (keeps `send`'s queue-vs-flush check
 *  DOM-free and testable). */
const OPEN = 1;

const SESSION_KEY = 'stratego.session';
const ROLES: ReadonlySet<string> = new Set(['RED', 'BLUE', 'SPECTATOR']);
const MAX_QUEUE = 20;

interface Session {
  code: string;
  token: string;
  role: Role;
}

/**
 * All storage access goes through `globalThis.sessionStorage` rather than `window.sessionStorage`
 * so this module never touches `window` at all — it can be imported (and these three functions
 * exercised) in a plain Node/vitest environment with no DOM, as long as the caller stubs
 * `sessionStorage` on globalThis first (e.g. `vi.stubGlobal`).
 */
export function saveSession(code: string, token: string, role: Role): void {
  try {
    globalThis.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token, role }));
  } catch {
    // storage unavailable (private mode, disabled, etc.) — session persistence is best-effort
  }
}

export function loadSession(): Session | null {
  try {
    const raw = globalThis.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, token, role } = parsed as Record<string, unknown>;
    if (typeof code !== 'string' || typeof token !== 'string' || typeof role !== 'string') return null;
    if (!ROLES.has(role)) return null;
    return { code, token, role: role as Role };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    globalThis.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Reconnect backoff: 1s, 2s, 3s, 4s, capped at 5s from then on. */
export function nextDelay(attempt: number): number {
  return Math.min(1000 * Math.max(attempt, 1), 5000);
}

function defaultSocketFactory(url: string): SocketLike {
  // Only reached when a caller doesn't inject its own factory, and only evaluated here (never at
  // module import time) — so referencing the global `WebSocket` stays safe in non-DOM tests.
  return new WebSocket(url) as unknown as SocketLike;
}

/**
 * Opens a resilient WebSocket connection. Reconnects with `nextDelay` backoff while the tab is
 * alive. Sends made while the socket isn't OPEN are queued (capped at `MAX_QUEUE`, dropping the
 * oldest once full) and flushed on `open` — REJOIN goes first if a saved session exists, then the
 * queued backlog. On ERROR BAD_TOKEN/NO_ROOM, clears the session and routes back to the lobby.
 *
 * `location`/`WebSocket` are only touched inside this function body (never at module import
 * time), and the default `url`/`socketFactory` params only read those globals when actually
 * invoked — so the rest of this module (and `connect` itself, given an injected factory and
 * explicit `url`) stays usable in a non-DOM test environment.
 */
export function connect(url?: string, socketFactory: SocketFactory = defaultSocketFactory): Net {
  const target = url ?? `ws://${location.host}/ws`;
  const msgListeners = new Set<(msg: ServerMsg) => void>();
  const statusListeners = new Set<(s: ConnStatus) => void>();

  let ws: SocketLike | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: ClientMsg[] = [];

  function setStatus(s: ConnStatus): void {
    for (const fn of statusListeners) fn(s);
  }

  /** Sends immediately if the socket is OPEN; otherwise enqueues (drop-oldest past MAX_QUEUE). */
  function send(msg: ClientMsg): void {
    if (ws && ws.readyState === OPEN) {
      ws.send(JSON.stringify(msg));
      return;
    }
    queue.push(msg);
    if (queue.length > MAX_QUEUE) queue.shift();
  }

  function flushQueue(): void {
    const pending = queue;
    queue = [];
    for (const msg of pending) send(msg);
  }

  function scheduleReconnect(): void {
    attempt += 1;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(open, nextDelay(attempt));
  }

  function open(): void {
    setStatus('connecting');
    const socket = socketFactory(target);
    ws = socket;

    socket.addEventListener('open', () => {
      attempt = 0;
      // REJOIN (if any) must land before the queued backlog, and status must flip to 'open'
      // only after both are sent — otherwise a status listener could react to 'open' and send
      // ahead of REJOIN.
      const session = loadSession();
      if (session) send({ t: 'REJOIN', code: session.code, token: session.token });
      flushQueue();
      setStatus('open');
    });

    socket.addEventListener('message', (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const msg = parsed as ServerMsg;
      if (msg.t === 'ERROR' && (msg.code === 'BAD_TOKEN' || msg.code === 'NO_ROOM')) {
        clearSession();
        location.hash = '#/';
      }
      for (const fn of msgListeners) fn(msg);
    });

    socket.addEventListener('close', () => {
      if (ws === socket) ws = null;
      setStatus('closed');
      scheduleReconnect();
    });

    // 'close' always follows 'error' for browser WebSockets, so reconnect scheduling lives
    // solely in the close handler above.
  }

  open();

  return {
    send,
    onMsg(fn) {
      msgListeners.add(fn);
      return () => msgListeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
  };
}
