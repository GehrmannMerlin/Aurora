import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// dist 位于 examples/sdk-reference/dist，../../../ 解析到仓库根。
const browserDist = fileURLToPath(new URL('../../../packages/browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../../packages/core/dist/', import.meta.url));
const sdkDist = fileURLToPath(new URL('../../../packages/sdk/dist/', import.meta.url));
const protocolDist = fileURLToPath(
  new URL('../../../packages/event-schema/dist/', import.meta.url),
);
const errorPluginDist = fileURLToPath(
  new URL('../../../packages/plugin-error/dist/', import.meta.url),
);
const requestPluginDist = fileURLToPath(
  new URL('../../../packages/plugin-request/dist/', import.meta.url),
);
const performancePluginDist = fileURLToPath(
  new URL('../../../packages/plugin-performance/dist/', import.meta.url),
);

const pageHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurora SDK Reference Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/sdk": "/sdk/index.js",
      "@aurora/event-schema": "/protocol/index.js",
      "@aurora/plugin-error": "/plugin-error/index.js",
      "@aurora/plugin-request": "/plugin-request/index.js",
      "@aurora/plugin-performance": "/plugin-performance/index.js"
    }
  }
  </script>
</head>
<body>
<main id="reference-root">
  <h1>Aurora SDK Reference Fixture</h1>
  <p id="probe">reference page ready</p>
</main>
<script type="module">
import { createAuroraSdk, createBrowserEnvironment } from '@aurora/browser';
import { createErrorCapturePlugin } from '@aurora/plugin-error';
import { createRequestCapturePlugin } from '@aurora/plugin-request';
import { createPerformanceCapturePlugin } from '@aurora/plugin-performance';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('reference harness timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createStubTransport = () => {
  const sends = [];
  return {
    sends,
    transport: {
      send: async (request) => {
        sends.push(request);
        return {
          kind: 'success',
          status: 202,
          receipt: { batchState: 'accepted', retryable: false, perEventResults: [] },
        };
      },
    },
  };
};

const harnessState = { handle: null, stub: null };

const harness = {
  // 完整组合：Core + Browser 环境 + 三个采集插件 + 可靠发送链（stub transport）。
  init: async () => {
    const { sends, transport } = createStubTransport();
    const environment = createBrowserEnvironment();
    const plugins = [
      createErrorCapturePlugin(environment),
      createRequestCapturePlugin(environment),
      createPerformanceCapturePlugin(environment),
    ];
    const startedAt = performance.now();
    const handle = createAuroraSdk({
      config: { clientKey: 'reference-client-key' },
      environment,
      plugins,
      transport,
      // 同源请求按默认策略放行（pageOrigin 匹配 + excludeSameOriginRequests=false）。
      pageOrigin: window.location.origin,
    });
    const result = await handle.start();
    const initMs = performance.now() - startedAt;
    harnessState.handle = handle;
    harnessState.stub = { sends };
    return { ok: result.ok === true, started: result.state === 'started', initMs, hostKey: 3 + 4 };
  },
  // 未捕获 JavaScript 错误 → 错误源 → 错误插件 → 统一管道 → stub transport。
  triggerError: async () => {
    if (harnessState.handle === null || harnessState.stub === null) {
      throw new Error('harness not initialized');
    }
    const before = harnessState.stub.sends.length;
    setTimeout(() => {
      throw new Error('reference-boom');
    }, 0);
    await waitFor(() => harnessState.stub.sends.length > before);
    const batch = harnessState.stub.sends[before];
    const event = batch.events[0];
    return {
      sent: harnessState.stub.sends.length - before,
      category: event?.body?.category ?? null,
    };
  },
  // 同源请求 → 请求源 → 请求插件 → 统一管道 → stub transport。
  triggerRequest: async () => {
    if (harnessState.handle === null || harnessState.stub === null) {
      throw new Error('harness not initialized');
    }
    const before = harnessState.stub.sends.length;
    // 相对 URL 会被 sanitizePageUrl 判空，使用绝对同源 URL 以被请求源捕获。
    await fetch(\`\${window.location.origin}/probe\`, { method: 'GET' });
    await waitFor(() => harnessState.stub.sends.length > before);
    return { sent: harnessState.stub.sends.length - before };
  },
  readSent: () => {
    if (harnessState.stub === null) return { sent: 0 };
    return { sent: harnessState.stub.sends.length };
  },
  destroy: async () => {
    if (harnessState.handle === null) throw new Error('harness not initialized');
    await harnessState.handle.destroy();
    harnessState.handle = null;
    harnessState.stub = null;
    return { destroyed: true, hostKey: 3 + 4 };
  },
};

globalThis.auroraReferenceHarness = Object.freeze(harness);
</script>
</body>
</html>`;

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  if (pathname === '/probe') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"ok":true}');
    return;
  }
  const directories: Readonly<Record<string, string>> = Object.freeze({
    browser: browserDist,
    core: coreDist,
    sdk: sdkDist,
    protocol: protocolDist,
    'plugin-error': errorPluginDist,
    'plugin-request': requestPluginDist,
    'plugin-performance': performancePluginDist,
  });
  const match =
    /^\/(browser|core|sdk|protocol|plugin-error|plugin-request|plugin-performance)\/([a-z0-9-]+\.js)$/u.exec(
      pathname,
    );
  const directory = match?.[1] === undefined ? undefined : directories[match[1]];
  const fileName = match?.[2];
  if (directory === undefined || fileName === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const source = await readFile(join(directory, fileName), 'utf8');
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(source);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

export interface ReferenceFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startReferenceFixtureServer(): Promise<ReferenceFixtureServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server did not expose a TCP port');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  });
}
