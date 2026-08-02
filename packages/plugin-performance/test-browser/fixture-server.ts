import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));
const errorPluginDist = fileURLToPath(new URL('../../plugin-error/dist/', import.meta.url));
const requestPluginDist = fileURLToPath(new URL('../../plugin-request/dist/', import.meta.url));

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Performance Plugin Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-performance": "/plugin-performance/index.js",
      "@aurora/plugin-error": "/plugin-error/index.js",
      "@aurora/plugin-request": "/plugin-request/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/event-schema": "/protocol/index.js"
    }
  }
  </script>
</head>
<body>
<script type="module">
import { createPerformanceCapturePlugin } from '@aurora/plugin-performance';
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { parsePerformanceEventEnvelope } from '@aurora/event-schema';

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
      createEventId: () => 'perf-event-' + String(nextId++),
    },
    eventTimeProvider: {
      now: () => 1800000000000 + nextId,
    },
  });
  await core.initialize();
  await core.start();
  const browser = createBrowserEnvironment();
  const plugin = createPerformanceCapturePlugin(browser);
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

globalThis.performancePluginHarness = Object.freeze({
  performancePageLoad: async () => {
    const local = await createStartedHarness();
    await waitFor(() => local.drafts.length === 1);
    const first = local.drafts[0];
    const parsed = first === undefined ? null : parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: 'x',
      eventType: 'performance',
      occurredAt: 1,
      body: first.body,
    });
    const result = {
      drafts: local.drafts.length,
      coreCodes: [...local.coreCodes],
      bodyValid: parsed?.success === true,
      metricName: first?.body?.metricName ?? null,
      value: first?.body?.value ?? null,
      hasEventId: first !== undefined && 'eventId' in local.core,
      pageStillRuns: 20 + 22,
    };
    local.browser.destroy();
    await local.core.destroy();
    return result;
  },
  performanceLcp: async () => {
    const local = await createStartedHarness();
    const block = document.createElement('p');
    block.textContent = 'Aurora LCP synthetic content element for largest contentful paint';
    block.style.fontSize = '32px';
    block.style.width = '200px';
    document.body.append(block);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise((resolve) => setTimeout(resolve, 100));
    local.browser.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lcpDraft = local.drafts.find((d) => d.body?.metricName === 'lcp');
    block.remove();
    await local.core.destroy();
    return {
      drafts: local.drafts.length,
      hasLcp: lcpDraft !== undefined,
      metricName: lcpDraft?.body?.metricName ?? null,
      value: lcpDraft?.body?.value ?? null,
    };
  },
  performanceCls: async () => {
    const local = await createStartedHarness();
    const hostEl = document.createElement('div');
    hostEl.style.width = '400px';
    hostEl.innerHTML = '<div style="height:50px;background:rgb(1,2,3)">a</div>' +
      '<div style="height:50px;background:rgb(2,3,4)">b</div>' +
      '<div style="height:50px;background:rgb(3,4,5)">c</div>';
    document.body.append(hostEl);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const injected = document.createElement('div');
    injected.style.height = '120px';
    injected.style.background = 'rgb(9,8,7)';
    hostEl.prepend(injected);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise((resolve) => setTimeout(resolve, 100));
    local.browser.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const clsDraft = local.drafts.find((d) => d.body?.metricName === 'cls');
    hostEl.remove();
    await local.core.destroy();
    return {
      drafts: local.drafts.length,
      hasCls: clsDraft !== undefined,
      metricName: clsDraft?.body?.metricName ?? null,
      value: clsDraft?.body?.value ?? null,
    };
  },
  performanceInp: async () => {
    const local = await createStartedHarness();
    const button = document.createElement('button');
    button.textContent = 'perf-click';
    document.body.append(button);
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    local.browser.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const inpDraft = local.drafts.find((d) => d.body?.metricName === 'inp');
    button.remove();
    await local.core.destroy();
    return {
      drafts: local.drafts.length,
      hasInp: inpDraft !== undefined,
      metricName: inpDraft?.body?.metricName ?? null,
    };
  },
  performanceStopNoSubmit: async () => {
    const local = await createStartedHarness();
    local.plugin.stop();
    const before = local.drafts.length;
    const block = document.createElement('p');
    block.textContent = 'Aurora post-stop content';
    document.body.append(block);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = local.drafts.length;
    block.remove();
    local.browser.destroy();
    await local.core.destroy();
    return { before, after };
  },
  performanceThreePlugins: async () => {
    const browser = createBrowserEnvironment();
    const core = createCore({
      eventIdProvider: {
        createEventId: () => 'three-' + String(Math.floor(Math.random() * 1e9)),
      },
      eventTimeProvider: { now: () => 1800000000000 },
    });
    await core.initialize();
    await core.start();
    const { createErrorCapturePlugin } = await import('@aurora/plugin-error');
    const { createRequestCapturePlugin } = await import('@aurora/plugin-request');
    const errorPlugin = createErrorCapturePlugin(browser);
    const requestPlugin = createRequestCapturePlugin(browser);
    const performancePlugin = createPerformanceCapturePlugin(browser);
    const drafts = { error: [], request: [], performance: [] };
    errorPlugin.initialize(Object.freeze({
      submitEvent: (draft) => { drafts.error.push(draft); return core.submitEventDraft(draft); },
    }));
    requestPlugin.initialize(Object.freeze({
      submitEvent: (draft) => { drafts.request.push(draft); return core.submitEventDraft(draft); },
    }));
    performancePlugin.initialize(Object.freeze({
      submitEvent: (draft) => { drafts.performance.push(draft); return core.submitEventDraft(draft); },
    }));
    errorPlugin.start();
    requestPlugin.start();
    performancePlugin.start();
    await fetch(window.location.origin + '/api/data');
    await waitFor(() => drafts.request.length === 1);
    const block = document.createElement('p');
    block.textContent = 'Aurora three-plugin content';
    document.body.append(block);
    await new Promise((resolve) => setTimeout(resolve, 100));
    browser.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const perfCount = drafts.performance.length;
    block.remove();
    await core.destroy();
    return {
      error: drafts.error.length,
      request: drafts.request.length,
      performance: perfCount,
      pageStillRuns: 20 + 22,
    };
  },
  performancePrivacy: async () => {
    const local = await createStartedHarness();
    const block = document.createElement('p');
    block.id = 'secret';
    block.textContent = 'secret-content';
    document.body.append(block);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise((resolve) => setTimeout(resolve, 100));
    local.browser.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const serialized = JSON.stringify(local.drafts);
    block.remove();
    await local.core.destroy();
    return { serialized, pageStillRuns: 42 };
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  'plugin-performance': pluginDist,
  'plugin-error': errorPluginDist,
  'plugin-request': requestPluginDist,
  browser: browserDist,
  core: coreDist,
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
  if (pathname === '/api/data') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  const match =
    /^\/(plugin-performance|plugin-error|plugin-request|browser|core|protocol)\/([a-z0-9-]+\.js)$/u.exec(
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

export interface PerformancePluginFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<PerformancePluginFixtureServer> {
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
