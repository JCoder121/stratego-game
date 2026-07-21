import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function extname(path: string): string {
  // Handle multi-dot extensions like ".js.map" by checking known suffixes first.
  for (const ext of Object.keys(CONTENT_TYPES)) {
    if (path.endsWith(ext)) return ext;
  }
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i);
}

const DEFAULT_TYPE = 'application/octet-stream';

/**
 * Static file handler for a pre-built dist dir. Decodes + normalizes the request path and
 * enforces it resolves to a real descendant of `distDir` (not a string-prefix match — the
 * resolved path must equal distDir or start with `distDir + sep`), so both literal (`..`) and
 * percent-encoded (`%2e%2e`) traversal attempts are rejected with 404.
 */
export function staticHandler(distDir: string) {
  const root = normalize(distDir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const relPath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const resolved = normalize(join(root, relPath));

    const withinRoot = resolved === root || resolved.startsWith(root + sep);
    if (!withinRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    try {
      const data = await readFile(resolved);
      const type = CONTENT_TYPES[extname(resolved)] ?? DEFAULT_TYPE;
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  };
}
