import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

async function setProjectScope(page: Page): Promise<void> {
  await page.evaluate(() =>
    fetch('/__mock/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'project', id: 'prj_test_1' }),
    }),
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('the authenticated shell passes axe auto-checks', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setProjectScope(page);
  await page.reload();
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
