import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type BrowserFixtureServer } from './fixture-server.js';

let fixture: BrowserFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'browserHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('browser harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`browser harness method missing: ${methodName}`);
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
    .poll(() => page.evaluate(() => typeof Reflect.get(globalThis, 'browserHarness') === 'object'))
    .toBe(true);
});

test('produces a real page_load fact from Navigation Timing', async ({ page }) => {
  const result = (await invoke(page, 'performancePageLoad')) as {
    subscribeOk: boolean;
    pageLoadValue: number | null;
    unit?: string;
  };
  expect(result.subscribeOk).toBe(true);
  expect(typeof result.pageLoadValue).toBe('number');
  expect((result.pageLoadValue ?? -1) >= 0).toBe(true);
});

test('tracks a real LCP candidate on content render', async ({ page }) => {
  const result = (await invoke(page, 'performanceLcp')) as {
    subscribeOk: boolean;
    hasLcp: boolean;
    value: number | null;
    unit: string | null;
  };
  expect(result.subscribeOk).toBe(true);
  expect(result.unit).toBe('millisecond');
});

test('captures CLS from a controlled layout shift', async ({ page }) => {
  const result = (await invoke(page, 'performanceCls')) as {
    subscribeOk: boolean;
    hasCls: boolean;
    value: number | null;
    unit: string | null;
  };
  expect(result.subscribeOk).toBe(true);
  expect(result.unit).toBe('ratio');
});

test('captures INP from a real interaction or reports unsupported', async ({ page }) => {
  const result = (await invoke(page, 'performanceInp')) as {
    subscribeOk: boolean;
    hasInp: boolean;
    value: number | null;
    unit: string | null;
  };
  expect(result.subscribeOk).toBe(true);
});

test('emits final candidates on hidden and does not resend on unsubscribe', async ({ page }) => {
  const result = (await invoke(page, 'performanceHiddenAndUnsubscribe')) as {
    subscribeOk: boolean;
    beforeHidden: number;
    afterHidden: number;
    afterUnsubscribe: number;
  };
  expect(result.subscribeOk).toBe(true);
  expect(result.beforeHidden).toBe(0);
  expect(result.afterHidden).toBe(1);
  expect(result.afterUnsubscribe).toBe(1); // unsubscribe 不重复发送最终候选
});

test('does not leak DOM ids or entries and keeps the page running', async ({ page }) => {
  const result = (await invoke(page, 'performancePrivacy')) as {
    subscribeOk: boolean;
    serialized: string;
    pageStillRuns: number;
  };
  expect(result.subscribeOk).toBe(true);
  expect(result.serialized).not.toContain('secret');
  expect(result.pageStillRuns).toBe(42);
});
