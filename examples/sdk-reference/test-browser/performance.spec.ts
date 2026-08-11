import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_MATRIX } from '../src/matrix.js';
import { startReferenceFixtureServer, type ReferenceFixtureServer } from '../src/fixture-server.js';

const SAMPLES = 30;
const OUTPUT_DIR = join(process.cwd(), '.artifacts', 'reference');

let fixture: ReferenceFixtureServer | undefined;

test.beforeAll(async () => {
  fixture = await startReferenceFixtureServer();
});

test.afterAll(async () => {
  await fixture?.close();
});

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

interface InitRunResult {
  readonly samples: readonly number[];
  readonly longTasks: readonly number[];
  readonly heapBefore: number | null;
  readonly heapAfter: number | null;
}

async function collectInitRuns(page: Page): Promise<InitRunResult> {
  const result = await page.evaluate(async (sampleCount: number) => {
    const harness: unknown = Reflect.get(globalThis, 'auroraReferenceHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('reference harness missing');
    }
    const samples: number[] = [];
    const longTasks: number[] = [];
    let observer: { disconnect(): void } | undefined;
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      observer = longTaskObserver;
    } catch {
      // longtask entries unsupported in this engine — report empty.
    }
    const memoryProbe = performance as unknown as {
      memory?: { usedJSHeapSize: number };
    };
    const heapBefore = memoryProbe.memory?.usedJSHeapSize ?? null;
    const call = async (
      name: string,
    ): Promise<{ ok?: boolean; started?: boolean; destroyed?: boolean }> => {
      const callable: unknown = Reflect.get(harness, name);
      if (typeof callable !== 'function') throw new Error(`harness method missing: ${name}`);
      const value = (await Reflect.apply(callable, harness, [])) as {
        ok?: boolean;
        started?: boolean;
        destroyed?: boolean;
      };
      return value;
    };
    for (let index = 0; index < sampleCount; index += 1) {
      const init = await call('init');
      if (init.ok !== true || init.started !== true) throw new Error('init cycle failed');
      samples.push((init as { initMs?: number }).initMs ?? 0);
      const destroy = await call('destroy');
      if (destroy.destroyed !== true) throw new Error('destroy cycle failed');
    }
    const heapAfter = memoryProbe.memory?.usedJSHeapSize ?? null;
    try {
      observer?.disconnect();
    } catch {
      // noop
    }
    return { samples, longTasks, heapBefore, heapAfter };
  }, SAMPLES);
  return result;
}

test('measures SDK init against the approved p95 budget in a fixed environment', async ({
  page,
}) => {
  if (fixture === undefined) throw new Error('fixture server missing');
  await page.goto(fixture.origin);
  await expect
    .poll(() =>
      page.evaluate(() => typeof Reflect.get(globalThis, 'auroraReferenceHarness') === 'object'),
    )
    .toBe(true);

  const run = await collectInitRuns(page);
  const sorted = [...run.samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const isMobile = test.info().project.name === 'performance-mobile';
  const budget = isMobile
    ? REFERENCE_MATRIX.performanceBudget.initMobileP95Ms
    : REFERENCE_MATRIX.performanceBudget.initDesktopP95Ms;

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    project: test.info().project.name,
    sampleCount: sorted.length,
    samples: sorted,
    p95Ms: p95,
    budgetMs: budget,
    budgetMet: p95 <= budget,
    observedLongTasks: run.longTasks,
    heapDeltaBytes:
      run.heapBefore !== null && run.heapAfter !== null ? run.heapAfter - run.heapBefore : null,
  };
  writeFileSync(
    join(OUTPUT_DIR, `performance-${test.info().project.name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  expect(
    p95,
    `SDK init p95 (${p95.toFixed(2)}ms) must be ≤ ${String(budget)}ms (${report.project})`,
  ).toBeLessThanOrEqual(budget);
});
