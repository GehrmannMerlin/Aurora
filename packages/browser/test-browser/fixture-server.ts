import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Aurora Browser Fixture</title></head>
<body><script type="module">
import { createBrowserEnvironment } from '/dist/index.js';
const baseline = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
  fetch: window.fetch,
  XMLHttpRequest: window.XMLHttpRequest,
  history: window.history,
  pushState: window.history.pushState,
  replaceState: window.history.replaceState,
  windowPrototype: Object.getPrototypeOf(window),
  xhrPrototype: window.XMLHttpRequest.prototype,
});
const environment = createBrowserEnvironment();
const events = [];
let subscriptionResult = null;
function startHarness() {
  subscriptionResult = environment.subscribePageLifecycle((event) => events.push(event));
  globalThis.browserHarness = Object.freeze({
    snapshot: () => environment.readPageSnapshot(),
    capabilities: () => environment.getCapabilities(),
    events: () => [...events],
    dispatchVisibility: () => document.dispatchEvent(new Event('visibilitychange')),
    dispatchPageHide: () => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    dispatchPageShow: () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
    unsubscribeTwice: () => {
      if (!subscriptionResult || !subscriptionResult.ok) return [subscriptionResult, subscriptionResult];
      return [subscriptionResult.subscription.unsubscribe(), subscriptionResult.subscription.unsubscribe()];
    },
    recreateAndDestroy: () => {
      const first = createBrowserEnvironment();
      const second = createBrowserEnvironment();
      return [first.destroy(), first.destroy(), second.destroy(), second.destroy()];
    },
    hostUnchanged: () => ({
      onerror: window.onerror === baseline.onerror,
      onunhandledrejection: window.onunhandledrejection === baseline.onunhandledrejection,
      fetch: window.fetch === baseline.fetch,
      XMLHttpRequest: window.XMLHttpRequest === baseline.XMLHttpRequest,
      history: window.history === baseline.history,
      pushState: window.history.pushState === baseline.pushState,
      replaceState: window.history.replaceState === baseline.replaceState,
      windowPrototype: Object.getPrototypeOf(window) === baseline.windowPrototype,
      xhrPrototype: window.XMLHttpRequest.prototype === baseline.xhrPrototype,
    }),
    throwingCallback: () => {
      let healthyCalls = 0;
      const failed = environment.subscribePageLifecycle(() => { throw new Error('browser-private'); });
      const healthy = environment.subscribePageLifecycle(() => { healthyCalls += 1; });
      document.dispatchEvent(new Event('visibilitychange'));
      if (failed.ok) failed.subscription.unsubscribe();
      if (healthy.ok) healthy.subscription.unsubscribe();
      return { healthyCalls, diagnostics: environment.getDiagnostics() };
    },
    isolatedInstances: () => {
      const first = createBrowserEnvironment();
      const second = createBrowserEnvironment();
      let firstCalls = 0;
      let secondCalls = 0;
      first.subscribePageLifecycle(() => { firstCalls += 1; });
      second.subscribePageLifecycle(() => { secondCalls += 1; });
      first.destroy();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      second.destroy();
      return { firstCalls, secondCalls };
    },
    destroyPrimary: () => environment.destroy(),
  });
}
// Real Chromium fires an initial pageshow (persisted: false) on first load right
// after load. Begin capturing only after it so tests observe exactly the events
// they dispatch; listeners added during dispatch do not fire for the current event.
window.addEventListener('pageshow', startHarness, { once: true });
</script></body></html>`;

export interface BrowserFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  const match = /^\/dist\/([a-z0-9-]+\.js)$/.exec(pathname);
  if (match?.[1] === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const source = await readFile(join(distDirectory, match[1]), 'utf8');
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(source);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

export async function startFixtureServer(): Promise<BrowserFixtureServer> {
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    throw new Error('fixture server did not expose a TCP port');
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
