import { expect, test, type Page } from '@playwright/test';
import { startReferenceFixtureServer, type ReferenceFixtureServer } from '../src/fixture-server.js';

let fixture: ReferenceFixtureServer | undefined;

interface HarnessInvokeInput {
  readonly name: string;
  readonly parameters: unknown[];
}

async function invoke(page: Page, method: string, args: unknown[] = []): Promise<unknown> {
  const result: unknown = await page.evaluate(
    (input: HarnessInvokeInput) => {
      const harness: unknown = Reflect.get(globalThis, 'auroraReferenceHarness');
      if (typeof harness !== 'object' || harness === null) {
        throw new Error('reference harness missing');
      }
      const callable: unknown = Reflect.get(harness, input.name);
      if (typeof callable !== 'function') {
        throw new Error(`reference harness method missing: ${input.name}`);
      }
      const result: unknown = Reflect.apply(callable, harness, input.parameters);
      return result;
    },
    { name: method, parameters: args },
  );
  return result;
}

test.beforeAll(async () => {
  fixture = await startReferenceFixtureServer();
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'auroraReferenceHarness') === 'object'),
    )
    .toBe(true);
});

test('composes the full SDK (Core+Browser+plugins+delivery) and keeps the host safe', async ({
  page,
}) => {
  const init = (await invoke(page, 'init')) as {
    ok: boolean;
    started: boolean;
    hostKey: number;
  };
  expect(init.ok).toBe(true);
  expect(init.started).toBe(true);
  expect(init.hostKey).toBe(7);

  const error = (await invoke(page, 'triggerError')) as {
    sent: number;
    category: string | null;
  };
  expect(error.sent).toBeGreaterThanOrEqual(1);
  expect(error.category).toBe('javascript');

  const request = (await invoke(page, 'triggerRequest')) as { sent: number };
  expect(request.sent).toBeGreaterThanOrEqual(1);

  const destroy = (await invoke(page, 'destroy')) as { destroyed: boolean; hostKey: number };
  expect(destroy.destroyed).toBe(true);
  expect(destroy.hostKey).toBe(7);
});
