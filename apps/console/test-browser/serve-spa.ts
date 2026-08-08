import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist-test/', import.meta.url));

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface SpaServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const candidate = normalize(join(distDirectory, decodeURIComponent(pathname)));
  if (!candidate.startsWith(distDirectory)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const content = await readFile(candidate);
    response.writeHead(200, {
      'content-type': MIME[extname(candidate)] ?? 'application/octet-stream',
    });
    response.end(content);
    return;
  } catch {
    // SPA history fallback: non-asset client routes serve index.html
  }
  const index = await readFile(join(distDirectory, 'index.html'));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(index);
}

export async function startSpaServer(): Promise<SpaServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('SPA server did not expose a TCP port');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  });
}
