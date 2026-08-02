import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type BrowserFixtureServer } from './fixture-server.js';

let fixture: BrowserFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  return page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'browserHarness');
    if (typeof harness !== 'object' || harness === null) throw new Error('browser harness missing');
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function')
      throw new Error(`browser harness method missing: ${methodName}`);
    const result: unknown = Reflect.apply(callable, harness, []);
    return result;
  }, method);
}

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture?.close();
});
test.beforeEach(async ({ page }) => {
  if (fixture === undefined) throw new Error('fixture server missing');
  await page.goto(fixture.origin);
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(globalThis, 'browserHarness') === 'object'))
    .toBe(true);
});

test('observes real fetch success, http error, network rejection, and cancellation', async ({
  page,
}) => {
  const result = (await invoke(page, 'requestObservation')) as {
    facts: {
      mechanism: string;
      method: string;
      url: string;
      outcome: string;
      statusCode: number | null;
    }[];
    fetchText: string;
    notFoundStatus: number;
    networkOutcome: string;
    canceledOutcome: string;
    xhrResult: { status: number; text: string };
    identityAfter: { fetch: boolean; XMLHttpRequest: boolean };
    instanceofHolds: boolean;
    identityRestored: { fetch: boolean; XMLHttpRequest: boolean };
  };
  const origin = String(fixture?.origin);
  expect(result.fetchText).toBe('ok-body');
  expect(result.notFoundStatus).toBe(404);
  expect(result.networkOutcome).toBe('rejected');
  expect(result.canceledOutcome).toBe('aborted');
  expect(result.xhrResult).toEqual({ status: 200, text: 'ok-body' });
  expect(result.identityAfter).toEqual({ fetch: false, XMLHttpRequest: false });
  expect(result.instanceofHolds).toBe(true);
  expect(result.identityRestored).toEqual({ fetch: true, XMLHttpRequest: true });
  const fetchFacts = result.facts.filter((fact) => fact.mechanism === 'fetch');
  const successFact = fetchFacts.find((fact) => fact.outcome === 'success');
  const httpFact = fetchFacts.find((fact) => fact.outcome === 'http_error');
  const networkFact = fetchFacts.find((fact) => fact.outcome === 'network_error');
  const canceledFact = fetchFacts.find((fact) => fact.outcome === 'canceled');
  expect(successFact?.url).toBe(`${origin}/ok`);
  expect(successFact?.method).toBe('GET');
  expect(successFact?.statusCode).toBe(200);
  expect(httpFact?.url).toBe(`${origin}/not-found`);
  expect(httpFact?.statusCode).toBe(404);
  expect(networkFact?.statusCode).toBeNull();
  expect(canceledFact?.statusCode).toBeNull();
  expect(canceledFact?.url).toBe(`${origin}/ok`);
  const xhrFacts = result.facts.filter((fact) => fact.mechanism === 'xhr');
  expect(xhrFacts).toHaveLength(1);
  expect(xhrFacts[0]).toMatchObject({
    url: `${origin}/ok`,
    outcome: 'success',
    statusCode: 200,
  });
});

test('stops after unsubscribe and restores host fetch', async ({ page }) => {
  const result = (await invoke(page, 'requestUnsubscribe')) as {
    afterSubscribeInstalled: boolean;
    restoredAfterUnsubscribe: boolean;
    afterUnsubscribeFacts: number;
  };
  expect(result.afterSubscribeInstalled).toBe(true);
  expect(result.restoredAfterUnsubscribe).toBe(true);
  expect(result.afterUnsubscribeFacts).toBe(0);
});

test('keeps multiple subscribers receiving facts and isolates release', async ({ page }) => {
  const result = (await invoke(page, 'requestMultiSubscriber')) as {
    firstAfterSecondEvent: number;
    secondAfterFirstRelease: number;
    secondAfterSecondEvent: number;
  };
  expect(result.secondAfterFirstRelease).toBe(1);
  expect(result.firstAfterSecondEvent).toBe(1);
  expect(result.secondAfterSecondEvent).toBe(2);
});

test('observes a single XHR request in isolation', async ({ page }) => {
  const result = (await invoke(page, 'requestXhrOnly')) as {
    subscribeOk: boolean;
    result: { status: number };
    facts: { mechanism: string; outcome: string; statusCode: number | null; url: string }[];
    diagnostics: { code: string; operation: string; capability?: string }[];
  };
  expect(result.subscribeOk).toBe(true);
  expect(result.result).toEqual({ status: 200 });
  expect(result.facts).toHaveLength(1);
  expect(result.facts[0]).toMatchObject({
    mechanism: 'xhr',
    outcome: 'success',
    statusCode: 200,
  });
  expect(result.diagnostics).toEqual([]);
});

test('isolates a throwing request callback and keeps the page running', async ({ page }) => {
  const result = (await invoke(page, 'requestCallbackIsolation')) as {
    healthyCount: number;
    callbackDiagnostics: number;
    pageStillRuns: number;
  };
  expect(result.healthyCount).toBe(1);
  expect(result.callbackDiagnostics).toBe(1);
  expect(result.pageStillRuns).toBe(42);
});
