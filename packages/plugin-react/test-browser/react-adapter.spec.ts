import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type ReactAdapterFixtureServer } from './fixture-server.js';

let fixture: ReactAdapterFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'reactAdapterHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('react adapter harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`react adapter harness method missing: ${methodName}`);
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'reactAdapterHarness') === 'object'),
    )
    .toBe(true);
});

test('mounts a real React app, captures a framework error, and is StrictMode-safe', async ({
  page,
}) => {
  const errorResult = (await invoke(page, 'frameworkError')) as {
    category: string | null;
    message: string | null;
    pageStillRuns: number;
  };
  expect(errorResult.category).toBe('javascript');
  expect(errorResult.message).toBe('react-render-boom');
  expect(errorResult.pageStillRuns).toBe(42);

  const strictResult = (await invoke(page, 'strictModeDouble')) as {
    pageEnters: number;
    okStillClickable: boolean;
    pageStillRuns: number;
  };
  expect(strictResult.pageEnters).toBe(1);
  expect(strictResult.okStillClickable).toBe(true);
  expect(strictResult.pageStillRuns).toBe(42);
});
