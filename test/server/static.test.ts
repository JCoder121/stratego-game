import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { staticHandler } from '../../src/server/static.js';

/** Fake req/res: only the fields the handler reads, plus writeHead/end recorders. */
function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as Buffer | string | undefined,
    ended: false,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
    },
    end(body?: Buffer | string) {
      res.body = body;
      res.ended = true;
    },
  };
  return res;
}

function fakeReq(url: string) {
  return { url, method: 'GET' };
}

describe('staticHandler', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stratego-static-'));
    writeFileSync(join(dir, 'index.html'), '<html>index</html>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'style.css'), 'body{}');
    writeFileSync(join(dir, 'icon.svg'), '<svg></svg>');
    writeFileSync(join(dir, 'pic.png'), Buffer.from([1, 2, 3]));
    writeFileSync(join(dir, 'favicon.ico'), Buffer.from([4, 5, 6]));
    writeFileSync(join(dir, 'bundle.js.map'), '{}');
    writeFileSync(join(dir, 'font.woff2'), Buffer.from([7, 8, 9]));
    mkdirSync(join(dir, 'secrets'));
    writeFileSync(join(dir, 'secrets', 'top.txt'), 'sekrit');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('/ resolves to index.html', async () => {
    const handler = staticHandler(dir);
    const res = fakeRes();
    await handler(fakeReq('/') as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(String(res.body)).toContain('index');
  });

  test('serves exact files with correct content-type', async () => {
    const handler = staticHandler(dir);
    const cases: [string, string][] = [
      ['/app.js', 'javascript'],
      ['/style.css', 'text/css'],
      ['/icon.svg', 'svg'],
      ['/pic.png', 'image/png'],
      ['/favicon.ico', 'icon'],
      ['/bundle.js.map', 'json'],
      ['/font.woff2', 'font/woff2'],
    ];
    for (const [path, typeFragment] of cases) {
      const res = fakeRes();
      await handler(fakeReq(path) as never, res as never);
      expect(res.statusCode, `status for ${path}`).toBe(200);
      expect(res.headers['Content-Type'], `content-type for ${path}`).toContain(typeFragment);
    }
  });

  test('rejects path traversal with ../', async () => {
    const handler = staticHandler(dir);
    const res = fakeRes();
    await handler(fakeReq('/../secrets/top.txt') as never, res as never);
    expect(res.statusCode).toBe(404);
  });

  test('rejects encoded traversal (%2e%2e)', async () => {
    const handler = staticHandler(dir);
    const res = fakeRes();
    await handler(fakeReq('/%2e%2e/secrets/top.txt') as never, res as never);
    expect(res.statusCode).toBe(404);
  });

  test('rejects traversal via double-encoded and mixed forms', async () => {
    const handler = staticHandler(dir);
    for (const path of ['/..%2fsecrets/top.txt', '/%2e%2e%2fsecrets/top.txt', '/foo/../../secrets/top.txt']) {
      const res = fakeRes();
      await handler(fakeReq(path) as never, res as never);
      expect(res.statusCode, `status for ${path}`).toBe(404);
    }
  });

  test('unknown path returns 404', async () => {
    const handler = staticHandler(dir);
    const res = fakeRes();
    await handler(fakeReq('/nope.txt') as never, res as never);
    expect(res.statusCode).toBe(404);
  });

  test('directory path without trailing content returns 404 (not a directory listing)', async () => {
    const handler = staticHandler(dir);
    const res = fakeRes();
    await handler(fakeReq('/secrets') as never, res as never);
    expect(res.statusCode).toBe(404);
  });

  test('naive string-prefix match on a sibling dir does not leak files (real path-segment guard)', async () => {
    const sibling = dir + '-evil';
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'leak.txt'), 'leak');
    try {
      const handler = staticHandler(dir);
      const res = fakeRes();
      // If the guard were a naive `resolved.startsWith(distDir)` string check (no separator),
      // "<dir>-evil/leak.txt" would incorrectly pass since it starts with "<dir>".
      await handler(fakeReq('/../' + sibling.slice(dir.length) + '/leak.txt') as never, res as never);
      expect(res.statusCode).toBe(404);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});
