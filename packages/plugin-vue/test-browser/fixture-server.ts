import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const adapterDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const sdkDist = fileURLToPath(new URL('../../sdk/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));

// vue ESM（含模板编译器）来自本包 devDependency 的 vue 包，供真实 Vue 应用使用。
const vueEsmPath = fileURLToPath(
  new URL('../node_modules/vue/dist/vue.esm-browser.prod.js', import.meta.url),
);

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Vue Adapter Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-vue": "/adapter/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/sdk": "/sdk/index.js",
      "@aurora/event-schema": "/protocol/index.js",
      "vue": "/vue.js"
    }
  }
  </script>
</head>
<body>
<div id="app"></div>
<script type="module">
import { createApp } from 'vue';
import { createVueAuroraPlugin } from '@aurora/plugin-vue';

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

globalThis.vueAdapterHarness = Object.freeze({
  // 真实 Vue 应用：render 抛出框架错误 → 标准错误事件经统一管道到达 transport；
  // 宿主原 errorHandler 先被调用；页面继续运行。
  frameworkError: async () => {
    const { sends, transport } = stubTransport();
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'browser-key' }, transport });
    const hostCalls = [];
    const app = createApp({
      render() {
        throw new Error('vue-render-boom');
      },
    });
    app.config.errorHandler = (err, instance, info) => {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      hostCalls.push({ message, info });
    };
    app.use(plugin);
    app.mount('#app');
    await waitFor(() => sends.length === 1);
    const batch = sends[0];
    const event = batch.events[0];
    const result = {
      category: event?.body?.category ?? null,
      message: event?.body?.error?.message ?? null,
      hostHandlerCalls: hostCalls.length,
      hostInfo: hostCalls[0]?.info ?? null,
      pageStillRuns: 20 + 22,
    };
    app.unmount();
    plugin.uninstall(app);
    return result;
  },
  // destroy 后原 errorHandler 恢复，且宿主 handler 在卸载前被调用。
  lifecycleRestore: async () => {
    const { transport } = stubTransport();
    let originalSeen = null;
    const original = (err) => {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      originalSeen = message;
    };
    const app = createApp({ template: '<button id="ok">ok</button>' });
    app.config.errorHandler = original;
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'browser-key' }, transport });
    app.use(plugin);
    const wrapped = app.config.errorHandler;
    const wrappedIsFunction = typeof wrapped === 'function';
    wrapped(new Error('x'), null, 'setup function');
    await plugin.destroy();
    const restored = app.config.errorHandler === original;
    return {
      wrappedIsFunction,
      restored,
      originalMessage: originalSeen,
      pageStillRuns: 42,
    };
  },
});
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
  if (pathname === '/vue.js') {
    try {
      const source = await readFile(vueEsmPath, 'utf8');
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(source);
    } catch {
      response.writeHead(404);
      response.end();
    }
    return;
  }
  const directories: Readonly<Record<string, string>> = Object.freeze({
    adapter: adapterDist,
    browser: browserDist,
    core: coreDist,
    sdk: sdkDist,
    protocol: protocolDist,
  });
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

export interface VueAdapterFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<VueAdapterFixtureServer> {
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
