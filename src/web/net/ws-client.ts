import type { ClientMsg, Role, ServerMsg } from '../../server/protocol.js';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface Net {
  send(msg: ClientMsg): void;
  /** Subscribe to incoming server messages; returns an unsubscribe fn. */
  onMsg(fn: (msg: ServerMsg) => void): () => void;
  /** Subscribe to socket lifecycle status; returns an unsubscribe fn. */
  onStatus(fn: (s: ConnStatus) => void): () => void;
}

const SESSION_KEY = 'stratego.session';

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

/**
 * Opens a resilient WebSocket connection. Reconnects with `nextDelay` backoff while the tab is
 * alive; on reconnect (or first connect) with a saved session, sends REJOIN before anything else.
 * On ERROR BAD_TOKEN/NO_ROOM, clears the session and routes back to the lobby.
 *
 * `location`/`WebSocket` are only touched inside this function body (never at module import
 * time), so the rest of this module stays importable in a non-DOM test environment.
 */
export function connect(url?: string): Net {
  const target = url ?? `ws://${location.host}/ws`;
  const msgListeners = new Set<(msg: ServerMsg) => void>();
  const statusListeners = new Set<(s: ConnStatus) => void>();

  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(s: ConnStatus): void {
    for (const fn of statusListeners) fn(s);
  }

  function send(msg: ClientMsg): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function scheduleReconnect(): void {
    attempt += 1;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(open, nextDelay(attempt));
  }

  function open(): void {
    setStatus('connecting');
    const socket = new WebSocket(target);
    ws = socket;

    socket.addEventListener('open', () => {
      attempt = 0;
      setStatus('open');
      const session = loadSession();
      if (session) send({ t: 'REJOIN', code: session.code, token: session.token });
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
