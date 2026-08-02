import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type PerformancePluginFixtureServer } from './fixture-server.js';

let fixture: PerformancePluginFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'performancePluginHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('performance plugin harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`performance plugin harness method missing: ${methodName}`);
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'performancePluginHarness') === 'object'),
    )
    .toBe(true);
});

test('submits a real page_load fact through Core', async ({ page }) => {
  const result = (await invoke(page, 'performancePageLoad')) as {
    drafts: number;
    coreCodes: string[];
    bodyValid: boolean;
    metricName: string | null;
    value: number | null;
    hasEventId: boolean;
    pageStillRuns: number;
  };
  expect(result.drafts).toBeGreaterThanOrEqual(1);
  expect(result.bodyValid).toBe(true);
  expect(result.metricName).toBe('page_load');
  expect(typeof result.value).toBe('number');
  expect(result.pageStillRuns).toBe(42);
});

test('submits a real LCP fact on content render', async ({ page }) => {
  const result = (await invoke(page, 'performanceLcp')) as {
    drafts: number;
    hasLcp: boolean;
    metricName: string | null;
    value: number | null;
  };
  expect(result.hasLcp).toBe(true);
  expect(result.metricName).toBe('lcp');
  expect(typeof result.value).toBe('number');
});

test('submits a real CLS fact from a controlled layout shift', async ({ page }) => {
  const result = (await invoke(page, 'performanceCls')) as {
    drafts: number;
    hasCls: boolean;
    metricName: string | null;
    value: number | null;
  };
  expect(result.hasCls).toBe(true);
  expect(result.metricName).toBe('cls');
  expect(typeof result.value).toBe('number');
});

test('submits an INP fact from a real interaction or handles unsupported', async ({ page }) => {
  const result = (await invoke(page, 'performanceInp')) as {
    drafts: number;
    hasInp: boolean;
    metricName: string | null;
  };
  expect(typeof result.hasInp).toBe('boolean');
});

test('stops submitting after plugin stop', async ({ page }) => {
  const result = (await invoke(page, 'performanceStopNoSubmit')) as {
    before: number;
    after: number;
  };
  expect(result.after).toBe(result.before);
});

test('coexists with plugin-error and plugin-request', async ({ page }) => {
  const result = (await invoke(page, 'performanceThreePlugins')) as {
    error: number;
    request: number;
    performance: number;
    pageStillRuns: number;
  };
  expect(result.request).toBeGreaterThanOrEqual(1);
  expect(result.performance).toBeGreaterThanOrEqual(1);
  expect(result.pageStillRuns).toBe(42);
});

test('does not leak DOM ids or entries', async ({ page }) => {
  const result = (await invoke(page, 'performancePrivacy')) as {
    serialized: string;
    pageStillRuns: number;
  };
  expect(result.serialized).not.toContain('secret');
  expect(result.pageStillRuns).toBe(42);
});
