import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Error Plugin Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-error": "/plugin/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/event-schema": "/protocol/index.js"
    }
  }
  </script>
</head>
<body>
<script type="module">
import { createErrorCapturePlugin } from '@aurora/plugin-error';
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { parseErrorEventBody } from '@aurora/event-schema';

const waitFor = async (predicate) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 3000) throw new Error('fixture timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createStartedHarness = async () => {
  let nextId = 1;
  const core = createCore({
    eventIdProvider: {
      createEventId: () => 'chromium-event-' + String(nextId++),
    },
    eventTimeProvider: {
      now: () => 1800000000000 + nextId,
    },
  });
  await core.initialize();
  await core.start();
  const browser = createBrowserEnvironment();
  const plugin = createErrorCapturePlugin(browser);
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
const baseline = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
});
let onerrorCalls = 0;
let onunhandledrejectionCalls = 0;
window.onerror = (...args) => {
  onerrorCalls += 1;
  return baseline.onerror ? baseline.onerror.apply(window, args) : false;
};
window.onunhandledrejection = (event) => {
  onunhandledrejectionCalls += 1;
  return baseline.onunhandledrejection
    ? baseline.onunhandledrejection.call(window, event)
    : false;
};
const installedHandlers = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
});
let propagationObserved = false;
window.addEventListener('error', () => {
  propagationObserved = true;
});

async function triggerJavaScript(message) {
  setTimeout(() => {
    throw new Error(message);
  }, 0);
}

async function triggerPromise(message) {
  void Promise.reject(new Error(message));
}

async function triggerResource() {
  const script = document.createElement('script');
  script.src = '/missing-plugin-resource.js?token=private#fragment';
  document.head.append(script);
  await waitFor(() =>
    primary.drafts.some((draft) => draft.body.category === 'resource'),
  );
  script.remove();
}

globalThis.errorPluginHarness = Object.freeze({
  triggerThreeSources: async () => {
    primary.drafts.length = 0;
    primary.coreCodes.length = 0;
    await triggerJavaScript('Synthetic Chromium JavaScript failure');
    await waitFor(() =>
      primary.drafts.some((draft) => draft.body.category === 'javascript'),
    );
    await triggerPromise('Synthetic Chromium Promise rejection');
    await waitFor(() =>
      primary.drafts.some((draft) => draft.body.category === 'unhandled_rejection'),
    );
    await triggerResource();
    const categories = primary.drafts.map((draft) => draft.body.category);
    const counts = {};
    for (const category of categories) counts[category] = (counts[category] || 0) + 1;
    const resource = primary.drafts.find((draft) => draft.body.category === 'resource');
    return {
      categories,
      counts,
      coreCodes: [...primary.coreCodes],
      allBodiesValid: primary.drafts.every((draft) => parseErrorEventBody(draft.body).success),
      resourceUrl: resource?.body.resource.url ?? null,
    };
  },
  hostSafety: async () => {
    onerrorCalls = 0;
    onunhandledrejectionCalls = 0;
    propagationObserved = false;
    const event = new ErrorEvent('error', {
      message: 'Synthetic host safety',
      error: new Error('Synthetic host safety'),
    });
    window.dispatchEvent(event);
    void Promise.reject(new Error('Synthetic host promise safety'));
    await waitFor(() => onunhandledrejectionCalls === 1);
    return {
      onerrorIdentity: window.onerror === installedHandlers.onerror,
      onunhandledrejectionIdentity:
        window.onunhandledrejection === installedHandlers.onunhandledrejection,
      onerrorCalls,
      onunhandledrejectionCalls,
      defaultPrevented: event.defaultPrevented,
      propagationObserved,
      pageStillRuns: 20 + 22,
    };
  },
  release: async () => {
    const local = await createStartedHarness();
    const event = () =>
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'Synthetic release',
          error: new Error('Synthetic release'),
        }),
      );
    event();
    const beforeStop = local.drafts.length;
    local.plugin.stop();
    event();
    const afterStop = local.drafts.length;
    local.plugin.start();
    event();
    const afterRestart = local.drafts.length;
    local.plugin.destroy();
    event();
    const afterDestroy = local.drafts.length;
    local.plugin.start();
    const destroyedStartDiagnostic =
      local.plugin.getDiagnostics().at(-1)?.code ?? null;
    local.browser.destroy();
    await local.core.destroy();
    return {
      beforeStop,
      afterStop,
      afterRestart,
      afterDestroy,
      destroyedStartDiagnostic,
    };
  },
  multiInstance: async () => {
    const browser = createBrowserEnvironment();
    const first = createErrorCapturePlugin(browser);
    const second = createErrorCapturePlugin(browser);
    let firstCalls = 0;
    let secondCalls = 0;
    const accepted = Object.freeze({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
    first.initialize(Object.freeze({
      submitEvent: () => {
        firstCalls += 1;
        return accepted;
      },
    }));
    second.initialize(Object.freeze({
      submitEvent: () => {
        secondCalls += 1;
        return accepted;
      },
    }));
    first.start();
    second.start();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'first', error: new Error('first') }),
    );
    first.destroy();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'second', error: new Error('second') }),
    );
    second.destroy();
    browser.destroy();
    return { first: firstCalls, second: secondCalls };
  },
  failureIsolation: async () => {
    const browser = createBrowserEnvironment();
    const plugin = createErrorCapturePlugin(browser);
    let calls = 0;
    plugin.initialize(Object.freeze({
      submitEvent: () => {
        calls += 1;
        if (calls === 1) {
          return Object.freeze({
            ok: false,
            code: 'not_started',
            state: 'stopped',
            diagnosticsAdded: 1,
          });
        }
        return Object.freeze({
          ok: true,
          code: 'accepted',
          state: 'started',
          diagnosticsAdded: 0,
        });
      },
    }));
    plugin.start();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'failed', error: new Error('failed') }),
    );
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'healthy', error: new Error('healthy') }),
    );
    const diagnosticCodes = plugin.getDiagnostics().map((entry) => entry.code);
    plugin.destroy();
    browser.destroy();
    return { calls, diagnosticCodes, pageStillRuns: 20 + 22 };
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  plugin: pluginDist,
  browser: browserDist,
  core: coreDist,
  protocol: protocolDist,
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  const match = /^\/(plugin|browser|core|protocol)\/([a-z0-9-]+\.js)$/u.exec(pathname);
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

export interface PluginFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<PluginFixtureServer> {
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
