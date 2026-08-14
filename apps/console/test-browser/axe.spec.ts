import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';
import { openResponsiveSidebar, waitForShell } from './shell-helpers';

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
  await waitForShell(page);
  await setProjectScope(page);
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await page.getByRole('button', { name: '组织：Acme' }).click();
  await expect(page.getByRole('menu', { name: '选择组织' })).toBeVisible();
  const openMenuResults = await new AxeBuilder({ page }).analyze();
  expect(openMenuResults.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await openResponsiveSidebar(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('project monitoring entry evidence surfaces pass axe auto-checks', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setProjectScope(page);

  for (const path of ['onboarding', 'overview', 'data-status']) {
    await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/${path}`);
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
});
