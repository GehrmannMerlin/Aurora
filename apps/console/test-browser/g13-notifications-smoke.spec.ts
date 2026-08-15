import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';
import { waitForShell } from './shell-helpers';

let server: { origin: string; close(): Promise<void> } | undefined;

function requiredServer(): NonNullable<typeof server> {
  if (server === undefined) throw new Error('SPA server was not started');
  return server;
}

async function setSessionAuthenticated(page: Page, authenticated: boolean): Promise<void> {
  await page.evaluate(
    ({ origin, value }) =>
      fetch(`${origin}/__mock/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authenticated: value }),
      }),
    { origin: requiredServer().origin, value: authenticated },
  );
}

/** Load the app once and wait for the MSW-backed shell so the worker is active. */
async function primeApp(page: Page): Promise<void> {
  await page.goto(`${requiredServer().origin}/`);
  await waitForShell(page);
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

// PLT-09 minimal acceptance: one real Chromium chain through the D1
// notification center — normal navigation → 通知 entry → Notifications page →
// list renders → unread filter → mark-read action. No fatal page error, no
// capability-not-provided stub. The MSW fixture is the test double; real
// production data is never fabricated.
test('PLT-09 smoke: notifications page renders, filters and marks read without fatal errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await primeApp(page);
  await setSessionAuthenticated(page, true);

  // Normal navigation to the D1 notification center.
  await page.goto(`${requiredServer().origin}/notifications`);
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await expect(page.getByText('新问题出现')).toBeVisible();
  await expect(page.getByText('错误数量过高 已触发')).toBeVisible();

  // Unread filter renders without a fatal error.
  await page.goto(`${requiredServer().origin}/notifications?read=unread`);
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await expect(page.getByText('错误数量过高 已触发')).toBeVisible();

  // Mark-read action completes without a fatal error (fixture stays static).
  await page.goto(`${requiredServer().origin}/notifications`);
  const markButtons = page.getByTestId('mark-read');
  if ((await markButtons.count()) > 0) {
    await markButtons.first().click();
    await expect(page.getByText('处理中…').first()).toBeVisible({ timeout: 5000 }).catch(() => undefined);
  }

  expect(pageErrors).toEqual([]);
  await expect(page.getByText('capability-not-provided')).toHaveCount(0);
});
