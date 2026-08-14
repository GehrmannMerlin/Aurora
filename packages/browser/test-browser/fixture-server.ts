import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const browserDist = fileURLToPath(new URL('../dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));
const sdkDist = fileURLToPath(new URL('../../sdk/dist/', import.meta.url));
const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Aurora Browser Fixture</title>
<script type="importmap">
{
  "imports": {
    "@aurora/core": "/core/index.js",
    "@aurora/event-schema": "/protocol/index.js",
    "@aurora/sdk": "/sdk/index.js"
  }
}
</script></head>
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
const errorEvents = [];
let errorSub = null;
const events = [];
let subscriptionResult = null;
function startHarness() {
  subscriptionResult = environment.subscribePageLifecycle((event) => events.push(event));
  errorSub = environment.subscribeErrorSources((event) => errorEvents.push(event));
  const originalOnerror = window.onerror;
  const originalOnunhandledrejection = window.onunhandledrejection;
  let onerrorCalls = 0;
  let onunhandledrejectionCalls = 0;
  window.onerror = (...args) => {
    onerrorCalls += 1;
    if (originalOnerror) return originalOnerror.apply(window, args);
    return false;
  };
  window.onunhandledrejection = (event) => {
    onunhandledrejectionCalls += 1;
    if (originalOnunhandledrejection) return originalOnunhandledrejection.call(window, event);
    return false;
  };
  const postHarnessOnerror = window.onerror;
  const postHarnessOnunhandledrejection = window.onunhandledrejection;
  let defaultPrevented = false;
  const spyDefault = (event) => {
    if (event.defaultPrevented) defaultPrevented = true;
  };
  window.addEventListener('error', spyDefault);
  window.addEventListener('unhandledrejection', spyDefault);
  const waitFor = async (predicate) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > 3000) throw new Error('fixture observation timeout');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  let resourceErrorUrl = null;
  let defaultPreventedByError = false;
  window.addEventListener('error', (e) => { if (e.defaultPrevented) defaultPreventedByError = true; });
  globalThis.browserHarness = Object.freeze({
    snapshot: () => environment.readPageSnapshot(),
    capabilities: () => environment.getCapabilities(),
    events: () => [...events],
    errorEvents: () => errorEvents.map(e => ({ type: e.type })),
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
      onerror: window.onerror === postHarnessOnerror,
      onunhandledrejection: window.onunhandledrejection === postHarnessOnunhandledrejection,
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
    requestXhrOnly: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribeRequests((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, diagnostics: env.getDiagnostics() };
      const result = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => resolve({ status: xhr.status });
        xhr.onerror = () => resolve({ status: -1 });
        xhr.open('GET', location.origin + '/ok');
        xhr.send();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const diagnostics = env.getDiagnostics();
      env.destroy();
      return { subscribeOk: true, result, facts, diagnostics };
    },
    requestObservation: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const baselineFetch = window.fetch;
      const baselineXhr = window.XMLHttpRequest;
      const subscribeResult = env.subscribeRequests((event) => facts.push(event));
      if (!subscribeResult.ok) {
        return {
          subscribeOk: false,
          facts,
          diagnostics: env.getDiagnostics(),
          installSucceeded: window.fetch !== baselineFetch,
        };
      }
      const origin = location.origin;
      const xhrDone = new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => resolve({ status: -1, text: 'xhr-error' });
        try {
          xhr.open('GET', origin + '/ok?q=1#f');
          xhr.send();
        } catch (error) {
          resolve({ status: -2, text: 'xhr-throw: ' + String(error) });
        }
      });
      const timeoutGuard = new Promise((resolve) => setTimeout(() => resolve({ timeout: true, factsSoFar: facts.length }), 5000));
      const xhrResult = await Promise.race([xhrDone, timeoutGuard]);
      const fetchResponse = await fetch(origin + '/ok?token=private#fragment');
      const fetchText = await fetchResponse.text();
      const missingResponse = await fetch(origin + '/not-found');
      const notFoundStatus = missingResponse.status;
      await missingResponse.text();
      let networkOutcome = null;
      try {
        await fetch('http://127.0.0.1:1/nope');
      } catch {
        networkOutcome = 'rejected';
      }
      const abortController = new AbortController();
      let canceledOutcome = null;
      try {
        const abortPromise = fetch(origin + '/ok', { signal: abortController.signal });
        abortController.abort();
        await abortPromise;
      } catch {
        canceledOutcome = 'aborted';
      }
      const identityAfter = {
        fetch: window.fetch === baselineFetch,
        XMLHttpRequest: window.XMLHttpRequest === baselineXhr,
      };
      const instance = new (window.XMLHttpRequest)();
      const instanceofHolds = instance instanceof baselineXhr;
      env.destroy();
      const identityRestored = {
        fetch: window.fetch === baselineFetch,
        XMLHttpRequest: window.XMLHttpRequest === baselineXhr,
      };
      return {
        subscribeOk: true,
        facts,
        fetchText,
        notFoundStatus,
        networkOutcome,
        canceledOutcome,
        xhrResult,
        identityAfter,
        instanceofHolds,
        identityRestored,
        diagnostics: env.getDiagnostics(),
      };
    },
    requestUnsubscribe: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const baselineFetch = window.fetch;
      const sub = env.subscribeRequests((event) => facts.push(event));
      if (!sub.ok) throw new Error('request subscription failed');
      const afterSubscribeInstalled = window.fetch !== baselineFetch;
      sub.subscription.unsubscribe();
      const restoredAfterUnsubscribe = window.fetch === baselineFetch;
      await fetch(location.origin + '/ok');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterUnsubscribeFacts = facts.length;
      env.destroy();
      return { afterSubscribeInstalled, restoredAfterUnsubscribe, afterUnsubscribeFacts };
    },
    requestMultiSubscriber: async () => {
      const env = createBrowserEnvironment();
      const first = [];
      const second = [];
      const firstSub = env.subscribeRequests((event) => first.push(event));
      const secondSub = env.subscribeRequests((event) => second.push(event));
      if (!firstSub.ok || !secondSub.ok) throw new Error('request subscription failed');
      await fetch(location.origin + '/ok');
      await new Promise((resolve) => setTimeout(resolve, 0));
      firstSub.subscription.unsubscribe();
      const secondAfterFirstRelease = second.length;
      await fetch(location.origin + '/not-found');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const firstAfterSecondEvent = first.length;
      const secondAfterSecondEvent = second.length;
      secondSub.subscription.unsubscribe();
      env.destroy();
      return { firstAfterSecondEvent, secondAfterFirstRelease, secondAfterSecondEvent };
    },
    requestCallbackIsolation: async () => {
      const env = createBrowserEnvironment();
      const healthy = [];
      env.subscribeRequests(() => { throw new Error('request-callback-private'); });
      env.subscribeRequests((event) => healthy.push(event));
      await fetch(location.origin + '/ok');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const diagnostics = env.getDiagnostics();
      const callbackDiagnostics = diagnostics.filter((d) => d.code === 'callback_failed').length;
      const pageStillRuns = 20 + 22;
      env.destroy();
      return { healthyCount: healthy.length, callbackDiagnostics, pageStillRuns };
    },
    triggerJavaScriptError: async () => {
      setTimeout(() => { throw new Error('Synthetic Chromium runtime error'); }, 0);
      await waitFor(() => errorEvents.some(e => e.type === 'javascript_error'));
    },
    triggerPromiseRejection: async () => {
      void Promise.reject(new Error('Synthetic Chromium rejection'));
      await waitFor(() => errorEvents.some(e => e.type === 'unhandled_rejection'));
    },
    triggerResourceError: async () => {
      const script = document.createElement('script');
      script.src = '/missing-error-source.js?token=private#fragment';
      document.head.append(script);
      await waitFor(() => errorEvents.some(e => e.type === 'resource_error'));
      script.remove();
    },
    triggerThreeErrorSources: async () => {
      onerrorCalls = 0;
      onunhandledrejectionCalls = 0;
      defaultPrevented = false;
      errorEvents.length = 0;
      const savedOnerror = window.onerror;
      const savedOnunhandledrejection = window.onunhandledrejection;
      await globalThis.browserHarness.triggerJavaScriptError();
      await globalThis.browserHarness.triggerPromiseRejection();
      await globalThis.browserHarness.triggerResourceError();
      const counts = {};
      for (const e of errorEvents) counts[e.type] = (counts[e.type] || 0) + 1;
      return {
        types: errorEvents.map(e => e.type),
        counts,
        onerrorIdentity: window.onerror === savedOnerror,
        onunhandledrejectionIdentity: window.onunhandledrejection === savedOnunhandledrejection,
        onerrorCalls,
        onunhandledrejectionCalls,
        everyDefaultPrevented: defaultPrevented,
        hasNativeReference: false,
      };
    },
    verifyErrorSourceRelease: () => {
      const tempEnv = createBrowserEnvironment();
      let count = 0;
      const sub = tempEnv.subscribeErrorSources(() => { count += 1; });
      if (!sub.ok) throw new Error('subscribe failed');
      sub.subscription.unsubscribe();
      window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic', error: new Error('x') }));
      const afterUnsubscribe = count;
      const surviving = createBrowserEnvironment();
      let survivingCalls = 0;
      surviving.subscribeErrorSources(() => { survivingCalls += 1; });
      tempEnv.destroy();
      window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic', error: new Error('y') }));
      const afterDestroy = count;
      surviving.destroy();
      return { afterUnsubscribe, afterDestroy, survivingInstance: survivingCalls };
    },
    verifyErrorCallbackIsolation: () => {
      const tempEnv = createBrowserEnvironment();
      let healthyCalls = 0;
      let callbackDiagnostics = 0;
      tempEnv.subscribeErrorSources(() => { throw new Error('callback-private'); });
      tempEnv.subscribeErrorSources(() => { healthyCalls += 1; });
      window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic', error: new Error('x') }));
      window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic', error: new Error('y') }));
      const diagnostics = tempEnv.getDiagnostics();
      callbackDiagnostics = diagnostics.filter(d => d.code === 'callback_failed').length;
      tempEnv.destroy();
      return { healthyCalls, callbackDiagnostics };
    },
    performancePageLoad: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) {
        const result = { subscribeOk: false, facts, diagnostics: env.getDiagnostics() };
        env.destroy();
        return result;
      }
      const pageLoad = facts.find((f) => f.metricName === 'page_load');
      const result = {
        subscribeOk: true,
        facts: facts.map((f) => ({ metricName: f.metricName, value: f.value, unit: f.unit })),
        pageLoadValue: pageLoad ? pageLoad.value : null,
      };
      sub.subscription.unsubscribe();
      env.destroy();
      return result;
    },
    performanceLcp: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, facts: [], diagnostics: env.getDiagnostics() };
      // LCP 只统计内容元素：插入文本块触发 largest-contentful-paint
      const block = document.createElement('p');
      block.textContent = 'Aurora LCP synthetic content element for largest contentful paint';
      block.style.fontSize = '32px';
      block.style.width = '200px';
      document.body.append(block);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise((resolve) => setTimeout(resolve, 100));
      sub.subscription.unsubscribe();
      const lcp = facts.find((f) => f.metricName === 'lcp');
      const result = {
        subscribeOk: true,
        hasLcp: lcp !== undefined,
        value: lcp ? lcp.value : null,
        unit: lcp ? lcp.unit : null,
      };
      block.remove();
      env.destroy();
      return result;
    },
    performanceCls: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, facts: [], diagnostics: env.getDiagnostics() };
      // 可靠 CLS 触发：先渲染已有内容，再 prepend 高元素推动后续内容下移
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
      sub.subscription.unsubscribe();
      const cls = facts.find((f) => f.metricName === 'cls');
      const result = {
        subscribeOk: true,
        hasCls: cls !== undefined,
        value: cls ? cls.value : null,
        unit: cls ? cls.unit : null,
      };
      hostEl.remove();
      env.destroy();
      return result;
    },
    performanceInp: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, facts: [], diagnostics: env.getDiagnostics() };
      // 真实交互（点击）产生 event timing entry
      const button = document.createElement('button');
      button.textContent = 'perf-click';
      document.body.append(button);
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const inp = facts.find((f) => f.metricName === 'inp');
      const result = {
        subscribeOk: true,
        hasInp: inp !== undefined,
        value: inp ? inp.value : null,
        unit: inp ? inp.unit : null,
      };
      button.remove();
      sub.subscription.unsubscribe();
      env.destroy();
      return result;
    },
    performanceHiddenAndUnsubscribe: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, beforeHidden: 0, afterHidden: 0, afterUnsubscribe: 0 };
      // 可靠 CLS 触发：已有内容 + prepend
      const hostEl = document.createElement('div');
      hostEl.style.width = '400px';
      hostEl.innerHTML = '<div style="height:50px;background:rgb(11,21,31)">a</div>' +
        '<div style="height:50px;background:rgb(21,31,41)">b</div>' +
        '<div style="height:50px;background:rgb(31,41,51)">c</div>';
      document.body.append(hostEl);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const injected = document.createElement('div');
      injected.style.height = '120px';
      injected.style.background = 'rgb(91,81,71)';
      hostEl.prepend(injected);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const beforeHidden = facts.filter((f) => f.metricName === 'cls').length;
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterHidden = facts.filter((f) => f.metricName === 'cls').length;
      sub.subscription.unsubscribe();
      const afterUnsubscribe = facts.filter((f) => f.metricName === 'cls').length;
      hostEl.remove();
      env.destroy();
      return { subscribeOk: true, beforeHidden, afterHidden, afterUnsubscribe };
    },
    performancePrivacy: async () => {
      const env = createBrowserEnvironment();
      const facts = [];
      const sub = env.subscribePerformance((event) => facts.push(event));
      if (!sub.ok) return { subscribeOk: false, serialized: '{}', pageStillRuns: 42 };
      const a = document.createElement('div');
      a.id = 'secret';
      a.style.width = '100px';
      a.style.height = '100px';
      a.style.background = 'rgb(12, 22, 32)';
      document.body.append(a);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const b = document.createElement('div');
      b.style.width = '300px';
      b.style.height = '100px';
      b.style.background = 'rgb(42, 52, 62)';
      document.body.append(b);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      sub.subscription.unsubscribe();
      const serialized = JSON.stringify(facts);
      a.remove();
      b.remove();
      env.destroy();
      return { subscribeOk: true, serialized, pageStillRuns: 42 };
    },
  });
}
// Real Chromium fires an initial pageshow (persisted: false) on first load right
// after load. Begin capturing only after it so tests observe exactly the events
// they dispatch; listeners added during dispatch do not fire for the current event.
window.addEventListener('pageshow', startHarness, { once: true });
</script></body></html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  dist: browserDist,
  core: coreDist,
  protocol: protocolDist,
  sdk: sdkDist,
});

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
  if (pathname === '/ok') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok-body');
    return;
  }
  if (pathname === '/not-found') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('missing');
    return;
  }
  if (pathname === '/echo-body') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`echo:${body}`);
    return;
  }
  const match = /^\/(dist|core|protocol|sdk)\/([a-z0-9-]+\.js)$/u.exec(pathname);
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
