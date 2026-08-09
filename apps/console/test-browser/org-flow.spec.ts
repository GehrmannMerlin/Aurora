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

test('B2 create-project form succeeds and shows the public client key identifier', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${server!.origin}/organizations/org_test_1/projects/new`);
  await expect(page.getByTestId('project-create-view')).toBeVisible();
  await page.getByTestId('project-name-input').fill('Web App');
  await page.getByTestId('project-framework-select').selectOption('react');
  await page.getByTestId('project-website-input').fill('https://example.com');
  await page.getByTestId('create-project-submit').click();

  await expect(page.getByTestId('create-success')).toBeVisible();
  await expect(page.getByTestId('client-key-public-identifier')).toHaveText('ck_pub_test_12345');
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B3 members lists masked emails and invites a member', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${server!.origin}/organizations/org_test_1/members`);
  await expect(page.getByTestId('member-list')).toBeVisible();
  await expect(page.getByTestId('member-list').getByText('ow**@example.invalid')).toBeVisible();
  await expect(page.getByTestId('member-list').getByText('me**@example.invalid')).toBeVisible();

  await page.getByTestId('invite-email-input').fill('new@example.invalid');
  await page.getByTestId('invite-role-select').selectOption('admin');
  await page.getByTestId('invite-submit').click();
  await expect(page.getByTestId('invitation-row')).toBeVisible();
  await expect(page.getByText('ne**@example.invalid')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B4 timezone settings updates the organization timezone', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${server!.origin}/organizations/org_test_1/settings`);
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await page.getByTestId('timezone-input').fill('Asia/Shanghai');
  await page.getByTestId('timezone-submit').click();
  await expect(page.getByTestId('timezone-success')).toBeVisible();
  await expect(page.getByTestId('current-timezone')).toContainText('Asia/Shanghai');
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});
