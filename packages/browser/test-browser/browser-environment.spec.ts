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

test('loads built module and reads real Chromium visibility', async ({ page }) => {
  const actualVisibility = await page.evaluate(() => document.visibilityState);
  expect(await invoke(page, 'capabilities')).toMatchObject({
    isBrowserEnvironment: true,
    canObservePageLifecycle: true,
  });
  expect(await invoke(page, 'snapshot')).toMatchObject({
    pageUrl: fixture?.origin.concat('/'),
    visibilityState: actualVisibility === 'hidden' ? 'hidden' : 'visible',
  });
});

test('delivers three lifecycle events and releases listeners idempotently', async ({ page }) => {
  await invoke(page, 'dispatchVisibility');
  await invoke(page, 'dispatchPageHide');
  await invoke(page, 'dispatchPageShow');
  expect(await invoke(page, 'events')).toEqual([
    { type: 'visibility_change', visibilityState: 'visible' },
    { type: 'page_hide', isPersisted: true },
    { type: 'page_show', isPersisted: false },
  ]);
  expect(await invoke(page, 'unsubscribeTwice')).toEqual([
    { ok: true, code: 'unsubscribed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_unsubscribed', diagnosticsAdded: 0 },
  ]);
  await invoke(page, 'dispatchPageShow');
  expect(await invoke(page, 'events')).toHaveLength(3);
});

test('preserves handlers, native APIs, history, and prototypes across repeated destroy', async ({
  page,
}) => {
  expect(await invoke(page, 'recreateAndDestroy')).toEqual([
    { ok: true, code: 'destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_destroyed', diagnosticsAdded: 0 },
  ]);
  await invoke(page, 'destroyPrimary');
  expect(await invoke(page, 'hostUnchanged')).toEqual({
    onerror: true,
    onunhandledrejection: true,
    fetch: true,
    XMLHttpRequest: true,
    history: true,
    pushState: true,
    replaceState: true,
    windowPrototype: true,
    xhrPrototype: true,
  });
});

test('contains callback errors and leaves the host page running', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  expect(await invoke(page, 'throwingCallback')).toMatchObject({
    healthyCalls: 1,
    diagnostics: [{ code: 'callback_failed', operation: 'notify', eventType: 'visibility_change' }],
  });
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => 20 + 22)).toBe(42);
});

test('does not cross-cancel independent instances', async ({ page }) => {
  expect(await invoke(page, 'isolatedInstances')).toEqual({ firstCalls: 0, secondCalls: 1 });
});

test('captures three real error sources once without replacing host handlers', async ({ page }) => {
  expect(await invoke(page, 'capabilities')).toMatchObject({ canObserveErrorSources: true });
  expect(await invoke(page, 'triggerThreeErrorSources')).toMatchObject({
    types: ['javascript_error', 'unhandled_rejection', 'resource_error'],
    counts: { javascript_error: 1, unhandled_rejection: 1, resource_error: 1 },
    onerrorIdentity: true,
    onunhandledrejectionIdentity: true,
    onerrorCalls: 1,
    onunhandledrejectionCalls: 1,
    hasNativeReference: false,
  });
});

test('stops after unsubscribe and destroy without cross-cancelling instances', async ({ page }) => {
  expect(await invoke(page, 'verifyErrorSourceRelease')).toEqual({
    afterUnsubscribe: 0,
    afterDestroy: 0,
    survivingInstance: 1,
  });
});

test('contains callback failure without recursive collection or page damage', async ({ page }) => {
  const result = await invoke(page, 'verifyErrorCallbackIsolation');
  expect(result).toMatchObject({ healthyCalls: 2, callbackDiagnostics: 2 });
  expect(await page.evaluate(() => 20 + 22)).toBe(42);
});
