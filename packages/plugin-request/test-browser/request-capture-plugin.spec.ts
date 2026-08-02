import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type RequestPluginFixtureServer } from './fixture-server.js';

let fixture: RequestPluginFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'requestPluginHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('request plugin harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`request plugin harness method missing: ${methodName}`);
    }
    return Reflect.apply(callable, harness, []) as unknown;
  }, method);
  return result;
}

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});

test.afterAll(async () => {
  await fixture?.close();
});

test.beforeEach(async ({ page }) => {
  if (fixture === undefined) throw new Error('fixture server missing');
  page.on('pageerror', () => undefined);
  await page.goto(fixture.origin);
  await expect
    .poll(() =>
      page.evaluate(() => typeof Reflect.get(globalThis, 'requestPluginHarness') === 'object'),
    )
    .toBe(true);
});

test('submits a real successful fetch exactly once through Core', async ({ page }) => {
  expect(await invoke(page, 'fetchSuccess')).toMatchObject({
    status: 200,
    body: '{"ok":true}',
    drafts: 1,
    coreCodes: ['accepted'],
    bodyValid: true,
    url: `${String(fixture?.origin)}/api/data`,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
  });
});

test('submits a real HTTP-error fetch exactly once', async ({ page }) => {
  expect(await invoke(page, 'fetchHttpError')).toMatchObject({
    status: 404,
    drafts: 1,
    outcome: 'http_error',
    statusCode: 404,
  });
});

test('submits a real network-error fetch exactly once', async ({ page }) => {
  expect(await invoke(page, 'fetchNetworkError')).toMatchObject({
    network: 'failure',
    drafts: 1,
    outcome: 'network_error',
    statusCode: null,
  });
});

test('submits a real XHR load exactly once without consuming the body', async ({ page }) => {
  expect(await invoke(page, 'xhrSuccess')).toMatchObject({
    status: 200,
    body: '{"ok":true}',
    drafts: 1,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
  });
});

test('submits a real XHR abort exactly once', async ({ page }) => {
  expect(await invoke(page, 'xhrAbort')).toMatchObject({
    aborted: true,
    drafts: 1,
    outcome: 'canceled',
  });
});

test('restores window.fetch and window.XMLHttpRequest after stop and destroy', async ({ page }) => {
  expect(await invoke(page, 'hostIdentity')).toEqual({
    installed: true,
    fetchRestored: true,
    xhrRestored: true,
    fetchIdentityAfterDestroy: true,
    xhrIdentityAfterDestroy: true,
  });
});

test('does not submit after stop', async ({ page }) => {
  expect(await invoke(page, 'stopNoSubmit')).toEqual({ draftsAfterStop: 0 });
});

test('coexists with the error plugin on a shared BrowserEnvironment', async ({ page }) => {
  expect(await invoke(page, 'coexistsWithErrorPlugin')).toMatchObject({
    requestDrafts: 1,
    errorDrafts: 0,
    pageStillRuns: 42,
  });
});

test('does not consume the request response body', async ({ page }) => {
  expect(await invoke(page, 'bodyNotConsumed')).toMatchObject({
    bodyRead: '{"ok":true}',
    drafts: 1,
  });
});
