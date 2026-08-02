import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type PluginFixtureServer } from './fixture-server.js';

let fixture: PluginFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'errorPluginHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('error plugin harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`error plugin harness method missing: ${methodName}`);
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'errorPluginHarness') === 'object'),
    )
    .toBe(true);
});

test('submits JavaScript, Promise, and resource errors exactly once through Core', async ({
  page,
}) => {
  expect(await invoke(page, 'triggerThreeSources')).toEqual({
    categories: ['javascript', 'unhandled_rejection', 'resource'],
    counts: { javascript: 1, unhandled_rejection: 1, resource: 1 },
    coreCodes: ['accepted', 'accepted', 'accepted'],
    allBodiesValid: true,
    resourceUrl: `${String(fixture?.origin)}/missing-plugin-resource.js`,
  });
});

test('preserves host handlers and event defaults', async ({ page }) => {
  expect(await invoke(page, 'hostSafety')).toEqual({
    onerrorIdentity: true,
    onunhandledrejectionIdentity: true,
    onerrorCalls: 1,
    onunhandledrejectionCalls: 1,
    defaultPrevented: false,
    propagationObserved: true,
    pageStillRuns: 42,
  });
});

test('stops, destroys, and never revives', async ({ page }) => {
  expect(await invoke(page, 'release')).toEqual({
    beforeStop: 1,
    afterStop: 1,
    afterRestart: 2,
    afterDestroy: 2,
    destroyedStartDiagnostic: 'invalid_lifecycle_call',
  });
});

test('isolates instances and leaves the surviving instance active', async ({ page }) => {
  expect(await invoke(page, 'multiInstance')).toEqual({
    first: 1,
    second: 2,
  });
});

test('contains an internal submission failure and processes the next event', async ({ page }) => {
  expect(await invoke(page, 'failureIsolation')).toEqual({
    calls: 2,
    diagnosticCodes: ['event_submission_failed'],
    pageStillRuns: 42,
  });
});
