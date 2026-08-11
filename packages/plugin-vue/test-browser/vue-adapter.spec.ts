import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type VueAdapterFixtureServer } from './fixture-server.js';

let fixture: VueAdapterFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'vueAdapterHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('vue adapter harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`vue adapter harness method missing: ${methodName}`);
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'vueAdapterHarness') === 'object'),
    )
    .toBe(true);
});

test('mounts a real Vue app, captures a framework error, and restores host state', async ({
  page,
}) => {
  const errorResult = (await invoke(page, 'frameworkError')) as {
    category: string | null;
    message: string | null;
    hostHandlerCalls: number;
    hostInfo: string | null;
    pageStillRuns: number;
  };
  expect(errorResult.category).toBe('javascript');
  expect(errorResult.message).toBe('vue-render-boom');
  expect(errorResult.hostHandlerCalls).toBeGreaterThanOrEqual(1);
  expect(errorResult.pageStillRuns).toBe(42);

  const restoreResult = (await invoke(page, 'lifecycleRestore')) as {
    wrappedIsFunction: boolean;
    restored: boolean;
    originalMessage: string | null;
    pageStillRuns: number;
  };
  expect(restoreResult.wrappedIsFunction).toBe(true);
  expect(restoreResult.originalMessage).toBe('x');
  expect(restoreResult.restored).toBe(true);
  expect(restoreResult.pageStillRuns).toBe(42);
});
