// Real-socket integration suite. Gated behind WS=1 (like SIM=1 for test/sim) because the
// sandboxed dev shell this suite is normally authored in cannot bind TCP sockets; run it with
// `npm run test:ws` outside the sandbox. Under plain `npm test` these tests are collected (they
// live under test/server/**, which vitest.config.ts always includes) but skipped cleanly.
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startServer } from '../../src/server/main.js';
import type { StartedServer } from '../../src/server/main.js';
import type { ClientMsg, ServerMsg } from '../../src/server/protocol.js';
import { fullPlacement } from './helpers.js';

const RUN = process.env.WS === '1';

function send(ws: WebSocket, msg: ClientMsg): void {
  ws.send(JSON.stringify(msg));
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Waits for the next message on `ws` matching `pred` (default: any message), buffering and
 * re-checking messages that arrive first but don't match, so waiters can be composed in order. */
function nextMessage(ws: WebSocket, pred: (m: ServerMsg) => boolean = () => true, timeoutMs = 5000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for message'));
    }, timeoutMs);
    function onMessage(raw: Buffer): void {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (!pred(m)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(m);
    }
    ws.on('message', onMessage);
  });
}

function closeSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe.skipIf(!RUN)('server integration (WS=1)', () => {
  let server: StartedServer;
  let port: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    server = await startServer({ port: 0, distDir: null });
    port = server.port;
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((ws) => closeSocket(ws)));
    await server.close();
  });

  async function client(): Promise<WebSocket> {
    const ws = await connect(port);
    sockets.push(ws);
    return ws;
  }

  test('create + join assigns RED/BLUE roles', async () => {
    const redWs = await client();
    send(redWs, { t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' });
    const created = (await nextMessage(redWs, (m) => m.t === 'ROOM_CREATED')) as Extract<ServerMsg, { t: 'ROOM_CREATED' }>;
    expect(created.role).toBe('RED');
    expect(created.code).toMatch(/^[A-Z0-9]{5}$/);

    const blueWs = await client();
    send(blueWs, { t: 'JOIN_ROOM', code: created.code });
    const joined = (await nextMessage(blueWs, (m) => m.t === 'JOINED')) as Extract<ServerMsg, { t: 'JOINED' }>;
    expect(joined.role).toBe('BLUE');
    expect(joined.code).toBe(created.code);
  }, 15000);

  test('happy path: both COMMIT_SETUP, a few MOVEs, RED RESIGN -> both GAME_OVER', async () => {
    const redWs = await client();
    send(redWs, { t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' });
    const created = (await nextMessage(redWs, (m) => m.t === 'ROOM_CREATED')) as Extract<ServerMsg, { t: 'ROOM_CREATED' }>;

    const blueWs = await client();
    send(blueWs, { t: 'JOIN_ROOM', code: created.code });
    await nextMessage(blueWs, (m) => m.t === 'JOINED');

    send(redWs, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    send(blueWs, { t: 'COMMIT_SETUP', placement: fullPlacement('BLUE') });

    // Both setups complete -> phase flips to PLAY -> a VIEW is broadcast to both seats.
    await nextMessage(redWs, (m) => m.t === 'VIEW');
    await nextMessage(blueWs, (m) => m.t === 'VIEW');

    send(redWs, { t: 'ACTION', action: { type: 'MOVE', color: 'RED', from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }, seq: 1 });
    await nextMessage(redWs, (m) => m.t === 'VIEW');
    await nextMessage(blueWs, (m) => m.t === 'VIEW');

    send(blueWs, { t: 'ACTION', action: { type: 'MOVE', color: 'BLUE', from: { r: 3, c: 0 }, to: { r: 4, c: 0 } }, seq: 1 });
    await nextMessage(redWs, (m) => m.t === 'VIEW');
    await nextMessage(blueWs, (m) => m.t === 'VIEW');

    send(redWs, { t: 'ACTION', action: { type: 'RESIGN', color: 'RED' }, seq: 2 });
    const redOver = (await nextMessage(redWs, (m) => m.t === 'GAME_OVER')) as Extract<ServerMsg, { t: 'GAME_OVER' }>;
    const blueOver = (await nextMessage(blueWs, (m) => m.t === 'GAME_OVER')) as Extract<ServerMsg, { t: 'GAME_OVER' }>;
    expect(redOver.result).toEqual({ winner: 'BLUE', reason: 'RESIGN' });
    expect(blueOver.result).toEqual({ winner: 'BLUE', reason: 'RESIGN' });
  }, 15000);

  test('reconnect: RED socket dies, REJOIN with token gets a fresh VIEW; BLUE sees disconnect then reconnect', async () => {
    const redWs = await client();
    send(redWs, { t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' });
    const created = (await nextMessage(redWs, (m) => m.t === 'ROOM_CREATED')) as Extract<ServerMsg, { t: 'ROOM_CREATED' }>;

    const blueWs = await client();
    send(blueWs, { t: 'JOIN_ROOM', code: created.code });
    await nextMessage(blueWs, (m) => m.t === 'JOINED');

    send(redWs, { t: 'COMMIT_SETUP', placement: fullPlacement('RED') });
    send(blueWs, { t: 'COMMIT_SETUP', placement: fullPlacement('BLUE') });
    await nextMessage(redWs, (m) => m.t === 'VIEW');
    await nextMessage(blueWs, (m) => m.t === 'VIEW');

    // Kill RED's socket without a clean CLOSE handshake from the app's perspective, then wait for
    // BLUE to observe the disconnect before reconnecting, so the two OPPONENT_STATUS events are
    // unambiguous (disconnected, then reconnected) rather than racing.
    const disconnected = nextMessage(blueWs, (m) => m.t === 'OPPONENT_STATUS' && m.seat === 'RED' && m.connected === false);
    redWs.terminate();
    const disconnectedMsg = (await disconnected) as Extract<ServerMsg, { t: 'OPPONENT_STATUS' }>;
    expect(disconnectedMsg).toMatchObject({ seat: 'RED', connected: false });

    const reconnected = nextMessage(blueWs, (m) => m.t === 'OPPONENT_STATUS' && m.seat === 'RED' && m.connected === true);
    const redWs2 = await client();
    send(redWs2, { t: 'REJOIN', code: created.code, token: created.token });
    const freshView = (await nextMessage(redWs2, (m) => m.t === 'VIEW')) as Extract<ServerMsg, { t: 'VIEW' }>;
    expect(freshView.t).toBe('VIEW');

    const reconnectedMsg = (await reconnected) as Extract<ServerMsg, { t: 'OPPONENT_STATUS' }>;
    expect(reconnectedMsg).toMatchObject({ seat: 'RED', connected: true });
  }, 15000);

  test('bad JSON -> ERROR BAD_MSG, socket stays open', async () => {
    const ws = await client();
    ws.send('{not json');
    const err = (await nextMessage(ws, (m) => m.t === 'ERROR')) as Extract<ServerMsg, { t: 'ERROR' }>;
    expect(err.code).toBe('BAD_MSG');
    expect(ws.readyState).toBe(ws.OPEN);

    // Socket is still usable after the error.
    send(ws, { t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' });
    const created = (await nextMessage(ws, (m) => m.t === 'ROOM_CREATED')) as Extract<ServerMsg, { t: 'ROOM_CREATED' }>;
    expect(created.role).toBe('RED');
  }, 15000);
});
