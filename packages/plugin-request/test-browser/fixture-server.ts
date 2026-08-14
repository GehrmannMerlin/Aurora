import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requestPluginDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));
const sdkDist = fileURLToPath(new URL('../../sdk/dist/', import.meta.url));
const errorPluginDist = fileURLToPath(new URL('../../plugin-error/dist/', import.meta.url));

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Request Plugin Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-request": "/request-plugin/index.js",
      "@aurora/plugin-error": "/plugin-error/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/event-schema": "/protocol/index.js",
      "@aurora/sdk": "/sdk/index.js"
    }
  }
  </script>
</head>
<body>
<script type="module">
import { createRequestCapturePlugin } from '@aurora/plugin-request';
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { parseRequestEventEnvelope } from '@aurora/event-schema';

const waitFor = async (predicate) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5000) throw new Error('fixture timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createStartedHarness = async () => {
  let nextId = 1;
  const core = createCore({
    eventIdProvider: {
      createEventId: () => 'request-event-' + String(nextId++),
    },
    eventTimeProvider: {
      now: () => 1800000000000 + nextId,
    },
  });
  await core.initialize();
  await core.start();
  const browser = createBrowserEnvironment();
  const plugin = createRequestCapturePlugin(browser);
  const drafts = [];
  const coreCodes = [];
  plugin.initialize(Object.freeze({
    submitEvent: (draft) => {
      drafts.push(draft);
      const result = core.submitEventDraft(draft);
      coreCodes.push(result.code);
      return result;
    },
  }));
  plugin.start();
  return { browser, core, coreCodes, drafts, plugin };
};

const primary = await createStartedHarness();

async function performFetchSuccess() {
  const response = await fetch(\`\${window.location.origin}/api/data?token=private#fragment\`);
  return { status: response.status, body: await response.text() };
}

async function performFetchHttpError() {
  const response = await fetch(\`\${window.location.origin}/api/missing\`);
  return { status: response.status };
}

async function performFetchNetworkError() {
  try {
    await fetch('http://127.0.0.1:1/unreachable');
    return { network: 'unexpected-success' };
  } catch {
    return { network: 'failure' };
  }
}

async function performXhrSuccess() {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', \`\${window.location.origin}/api/data\`);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.send();
  });
}

async function performXhrAbort() {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', \`\${window.location.origin}/api/slow\`);
    xhr.onabort = () => resolve({ aborted: true });
    xhr.send();
    setTimeout(() => xhr.abort(), 10);
  });
}

globalThis.requestPluginHarness = Object.freeze({
  fetchSuccess: async () => {
    primary.drafts.length = 0;
    primary.coreCodes.length = 0;
    const result = await performFetchSuccess();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    const parsed = first === undefined ? null : parseRequestEventEnvelope({
      protocolVersion: 1,
      eventId: 'x',
      eventType: 'request',
      occurredAt: 1,
      body: first.body,
    });
    return {
      status: result.status,
      body: result.body,
      drafts: primary.drafts.length,
      coreCodes: [...primary.coreCodes],
      bodyValid: parsed?.success === true,
      url: first?.body?.url ?? null,
      method: first?.body?.method ?? null,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  fetchHttpError: async () => {
    primary.drafts.length = 0;
    const result = await performFetchHttpError();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      status: result.status,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  fetchNetworkError: async () => {
    primary.drafts.length = 0;
    const result = await performFetchNetworkError();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      network: result.network,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  xhrSuccess: async () => {
    primary.drafts.length = 0;
    const result = await performXhrSuccess();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      status: result.status,
      body: result.body,
      drafts: primary.drafts.length,
      method: first?.body?.method ?? null,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  xhrAbort: async () => {
    primary.drafts.length = 0;
    const result = await performXhrAbort();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      aborted: result.aborted,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
    };
  },
  hostIdentity: async () => {
    const before = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    const local = await createStartedHarness();
    const during = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    local.plugin.stop();
    const afterStop = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    local.plugin.destroy();
    local.browser.destroy();
    await local.core.destroy();
    const afterDestroy = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    return {
      installed: during.fetch !== before.fetch || during.Xhr !== before.Xhr,
      fetchRestored: afterStop.fetch === before.fetch,
      xhrRestored: afterStop.Xhr === before.Xhr,
      fetchIdentityAfterDestroy: afterDestroy.fetch === before.fetch,
      xhrIdentityAfterDestroy: afterDestroy.Xhr === before.Xhr,
    };
  },
  stopNoSubmit: async () => {
    const local = await createStartedHarness();
    local.plugin.stop();
    const before = local.drafts.length;
    await fetch(\`\${window.location.origin}/api/data\`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { draftsAfterStop: local.drafts.length - before };
  },
  coexistsWithErrorPlugin: async () => {
    const browser = createBrowserEnvironment();
    const core = createCore({
      eventIdProvider: {
        createEventId: () => 'coexist-event-' + String(Math.floor(Math.random() * 1e9)),
      },
      eventTimeProvider: { now: () => 1800000000000 },
    });
    await core.initialize();
    await core.start();
    const { createErrorCapturePlugin } = await import('@aurora/plugin-error');
    const errorPlugin = createErrorCapturePlugin(browser);
    const requestPlugin = createRequestCapturePlugin(browser);
    const errorDrafts = [];
    const requestDrafts = [];
    errorPlugin.initialize(Object.freeze({
      submitEvent: (draft) => {
        errorDrafts.push(draft);
        return core.submitEventDraft(draft);
      },
    }));
    requestPlugin.initialize(Object.freeze({
      submitEvent: (draft) => {
        requestDrafts.push(draft);
        return core.submitEventDraft(draft);
      },
    }));
    errorPlugin.start();
    requestPlugin.start();
    await fetch(\`\${window.location.origin}/api/data\`);
    await waitFor(() => requestDrafts.length === 1);
    return {
      requestDrafts: requestDrafts.length,
      errorDrafts: errorDrafts.length,
      pageStillRuns: 20 + 22,
    };
  },
  bodyNotConsumed: async () => {
    primary.drafts.length = 0;
    const response = await fetch(\`\${window.location.origin}/api/data\`);
    const text = await response.text();
    await waitFor(() => primary.drafts.length === 1);
    return { bodyRead: text, drafts: primary.drafts.length };
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  'request-plugin': requestPluginDist,
  'plugin-error': errorPluginDist,
  browser: browserDist,
  core: coreDist,
  protocol: protocolDist,
  sdk: sdkDist,
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/data') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname === '/api/missing') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('missing');
      return;
    }
    if (pathname === '/api/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('slow');
      }, 2000);
      return;
    }
    response.writeHead(404);
    response.end();
    return;
  }
  const match =
    /^\/(request-plugin|plugin-error|browser|core|protocol|sdk)\/([a-z0-9-]+\.js)$/u.exec(pathname);
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

export interface RequestPluginFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<RequestPluginFixtureServer> {
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
