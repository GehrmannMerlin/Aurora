import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const adapterDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const sdkDist = fileURLToPath(new URL('../../sdk/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));

// React 18 UMD（dev 构建，启用 StrictMode 双生命周期）来自本包 devDependencies。
const reactUmdPath = fileURLToPath(
  new URL('../node_modules/react/umd/react.development.js', import.meta.url),
);
const reactDomUmdPath = fileURLToPath(
  new URL('../node_modules/react-dom/umd/react-dom.development.js', import.meta.url),
);
// scheduler 是 react-dom 的传递依赖，位于 pnpm store；这里从 plugin-vue 侧不再可用，
// 从 react-dom 所在 store 路径解析不可靠，改用 workspace 顶层 store 常量定位。
const schedulerUmdPath = fileURLToPath(
  new URL(
    '../../../node_modules/.pnpm/scheduler@0.23.2/node_modules/scheduler/umd/scheduler.development.js',
    import.meta.url,
  ),
);

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora React Adapter Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-react": "/adapter/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/sdk": "/sdk/index.js",
      "@aurora/event-schema": "/protocol/index.js",
      "react": "/react-esm.js"
    }
  }
  </script>
</head>
<body>
<div id="app"></div>
<script src="/react.js"></script>
<script src="/scheduler.js"></script>
<script src="/react-dom.js"></script>
<script type="module">
import { createReactAuroraPlugin } from '@aurora/plugin-react';

const waitFor = async (predicate) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5000) throw new Error('fixture timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const stubTransport = () => {
  const sends = [];
  return {
    sends,
    transport: {
      send: async (request) => {
        sends.push(request);
        return { kind: 'success', status: 202, receipt: { batchState: 'accepted', retryable: false, perEventResults: [] } };
      },
    },
  };
};

globalThis.reactAdapterHarness = Object.freeze({
  // 真实 React 应用：子树 render 抛框架错误 → AuroraErrorBoundary 捕获 →
  // 标准错误事件经统一管道到达 transport；宿主继续运行。
  frameworkError: async () => {
    const { sends, transport } = stubTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'browser-key' }, transport });
    const Boom = () => { throw new Error('react-render-boom'); };
    const container = document.getElementById('app');
    const root = ReactDOM.createRoot(container);
    root.render(React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)));
    await waitFor(() => sends.length === 1);
    const event = sends[0].events[0];
    const result = {
      category: event?.body?.category ?? null,
      message: event?.body?.error?.message ?? null,
      pageStillRuns: 20 + 22,
    };
    root.unmount();
    await plugin.destroy();
    return result;
  },
  // StrictMode 双挂载：SDK 只启动一次（activity trail 只有一条 page_enter），
  // 宿主元素仍可交互。
  strictModeDouble: async () => {
    const { transport } = stubTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'browser-key' }, transport });
    const container = document.getElementById('app');
    const root = ReactDOM.createRoot(container);
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          plugin.AuroraErrorBoundary,
          null,
          React.createElement('button', { id: 'ok' }, 'ok'),
        ),
      ),
    );
    await waitFor(() => plugin.sdk.getActivityTrail().some((e) => e.kind === 'page_enter'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pageEnters = plugin.sdk.getActivityTrail().filter((e) => e.kind === 'page_enter').length;
    const okButton = document.getElementById('ok');
    const result = {
      pageEnters,
      okStillClickable: okButton !== null && typeof okButton.click === 'function',
      pageStillRuns: 42,
    };
    root.unmount();
    await plugin.destroy();
    return result;
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  adapter: adapterDist,
  browser: browserDist,
  core: coreDist,
  sdk: sdkDist,
  protocol: protocolDist,
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  if (pathname === '/react-esm.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    // 把全局 React（由 UMD script 标签加载）转出为 ESM，供 adapter dist 的裸导入使用。
    response.end('export const Component = globalThis.React.Component;\n');
    return;
  }
  const singleRoutes: Readonly<Record<string, string>> = Object.freeze({
    '/react.js': reactUmdPath,
    '/scheduler.js': schedulerUmdPath,
    '/react-dom.js': reactDomUmdPath,
  });
  const singleFile = singleRoutes[pathname];
  if (singleFile !== undefined) {
    try {
      const source = await readFile(singleFile, 'utf8');
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(source);
      return;
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
  }
  const match = /^\/(adapter|browser|core|sdk|protocol)\/([a-z0-9-]+\.js)$/u.exec(pathname);
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

export interface ReactAdapterFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<ReactAdapterFixtureServer> {
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
