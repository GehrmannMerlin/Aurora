import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

async function setSessionAuthenticated(page: Page, authenticated: boolean): Promise<void> {
  await page.evaluate(
    ({ origin, value }) =>
      fetch(`${origin}/__mock/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authenticated: value }),
      }),
    { origin: server!.origin, value: authenticated },
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('B1 workspace home lists projects and honors allowedActions', async ({ page }) => {
  // Prime the app so the MSW worker is active, then sign in.
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${server!.origin}/workspace?organizationId=org_test_1`);
  await expect(page.getByTestId('workspace-home')).toBeVisible();
  await expect(page.getByText('Web')).toBeVisible();
  await expect(page.getByTestId('create-project-button')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B5 usage page shows an honest unavailable state', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${server!.origin}/organizations/org_test_1/usage`);
  await expect(page.getByTestId('usage-view')).toBeVisible();
  await expect(page.getByText('功能未提供')).toBeVisible();
  await expect(page.getByText(/不会显示任何模拟数据/)).toBeVisible();
  // No fabricated usage numbers or charts in the DOM.
  await expect(page.getByTestId('usage-chart')).toHaveCount(0);
  await expect(page.getByTestId('usage-number')).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});
