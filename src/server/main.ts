import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { staticHandler } from './static.js';
import { RoomRegistry } from './rooms.js';
import { GameRoom } from './game-room.js';
import { isClientMsg } from './protocol.js';
import type { ClientMsg, ServerMsg } from './protocol.js';
import { makeRandom } from '../rng/rng.js';

const SWEEP_INTERVAL_MS = 60_000;

export interface StartServerOpts {
  port: number;
  distDir: string | null;
  /** Bind address; defaults to all interfaces (node's default when omitted). */
  host?: string;
}

export interface StartedServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Per-connection attachment to a room. `epoch` is a unique marker minted every time a token
 * becomes "owned" by a connection (on join, on rejoin). `liveEpoch` (room -> token -> epoch)
 * records which epoch currently owns each token. A rejoin mints a fresh epoch and overwrites
 * the map entry *without* touching the old socket; when that old socket eventually fires
 * `close`, it compares its own captured epoch against the map's current value for that token —
 * if they differ, a newer connection has since re-adopted the token, so this stale close must
 * NOT call `room.disconnect` (that would incorrectly flip a live, just-rejoined seat back to
 * disconnected and spam a bogus OPPONENT_STATUS). This avoids any change to GameRoom internals:
 * disconnect() is only ever invoked by the connection that is still the token's current owner.
 */
interface Attachment {
  room: GameRoom;
  token: string;
  epoch: symbol;
}

function resolveDistDir(): string {
  return fileURLToPath(new URL('../../dist/web', import.meta.url));
}

export async function startServer(opts: StartServerOpts): Promise<StartedServer> {
  const registry = new RoomRegistry<GameRoom>({ now: Date.now, rng: makeRandom() });
  const sweepTimer = setInterval(() => registry.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  const serveStatic = opts.distDir ? staticHandler(opts.distDir) : null;
  const httpServer = createServer((req, res) => {
    if (!serveStatic) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const liveEpoch = new WeakMap<GameRoom, Map<string, symbol>>();

  function epochsFor(room: GameRoom): Map<string, symbol> {
    let m = liveEpoch.get(room);
    if (!m) {
      m = new Map();
      liveEpoch.set(room, m);
    }
    return m;
  }

  /** Marks `token` as owned by a fresh epoch and returns it, for the caller to remember. */
  function claim(room: GameRoom, token: string): symbol {
    const epoch = Symbol('conn');
    epochsFor(room).set(token, epoch);
    return epoch;
  }

  wss.on('connection', (ws: WebSocket) => {
    let attached: Attachment | null = null;

    const send = (m: ServerMsg): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const sendErr = (code: Extract<ServerMsg, { t: 'ERROR' }>['code'], msg: string): void => {
      send({ t: 'ERROR', code, msg });
    };

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        sendErr('BAD_MSG', 'malformed JSON');
        return;
      }
      if (!isClientMsg(parsed)) {
        sendErr('BAD_MSG', 'unrecognized message');
        return;
      }
      const msg: ClientMsg = parsed;

      if (msg.t === 'CREATE_ROOM') {
        let code = '';
        const room = new GameRoom({
          mode: msg.mode,
          bots: msg.bots ?? (msg.botDifficulty !== undefined
            ? { RED: msg.botDifficulty, BLUE: msg.botDifficulty }
            : undefined),
          watchSpeed: msg.watchSpeed,
          scheduler: { set: setTimeout, clear: clearTimeout },
          onEmptyChange: (empty) => {
            if (empty) registry.markEmpty(code);
            else registry.markOccupied(code);
          },
        });
        code = registry.create(room);
        const joined = room.joinHuman(send);
        if (!joined) {
          sendErr('ROOM_FULL', 'room is full');
          return;
        }
        attached = { room, token: joined.token, epoch: claim(room, joined.token) };
        send({ t: 'ROOM_CREATED', code, token: joined.token, role: joined.role });
        return;
      }

      if (msg.t === 'JOIN_ROOM') {
        const code = msg.code.toUpperCase();
        const room = registry.get(code);
        if (!room) {
          sendErr('NO_ROOM', 'no such room');
          return;
        }
        const joined = room.joinHuman(send);
        if (!joined) {
          sendErr('ROOM_FULL', 'room is full');
          return;
        }
        attached = { room, token: joined.token, epoch: claim(room, joined.token) };
        send({ t: 'JOINED', code, token: joined.token, role: joined.role });
        return;
      }

      if (msg.t === 'REJOIN') {
        const code = msg.code.toUpperCase();
        const room = registry.get(code);
        if (!room) {
          sendErr('NO_ROOM', 'no such room');
          return;
        }
        const role = room.rejoin(msg.token, send);
        if (role === null) {
          sendErr('BAD_TOKEN', 'invalid token');
          return;
        }
        // room.rejoin already pushed a fresh VIEW/SETUP_STATUS to `send` and notified the
        // opponent; only the epoch bookkeeping happens here.
        attached = { room, token: msg.token, epoch: claim(room, msg.token) };
        return;
      }

      if (!attached) {
        sendErr('BAD_MSG', 'not joined to a room');
        return;
      }
      attached.room.handle(attached.token, msg);
    });

    ws.on('close', () => {
      if (!attached) return;
      const current = liveEpoch.get(attached.room)?.get(attached.token);
      if (current !== attached.epoch) return; // superseded by a later rejoin; not our seat anymore
      attached.room.disconnect(attached.token);
    });
  });

  await new Promise<void>((resolve) => {
    if (opts.host !== undefined) httpServer.listen(opts.port, opts.host, resolve);
    else httpServer.listen(opts.port, resolve);
  });

  const address = httpServer.address();
  const port = address && typeof address === 'object' ? address.port : opts.port;

  return {
    port,
    async close(): Promise<void> {
      clearInterval(sweepTimer);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  startServer({ port, distDir: resolveDistDir(), host: '0.0.0.0' }).then(({ port: actualPort }) => {
    // eslint-disable-next-line no-console
    console.log(`Stratego server listening on 0.0.0.0:${actualPort}`);
  });
}
