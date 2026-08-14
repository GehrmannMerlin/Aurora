import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';
import { openResponsiveSidebar, waitForShell } from './shell-helpers';

let server: { origin: string; close(): Promise<void> } | undefined;

async function setMockScope(
  page: Page,
  type: 'workspace' | 'organization' | 'project',
  id?: string,
): Promise<void> {
  await page.evaluate(
    ([scopeType, scopeId]) =>
      fetch('/__mock/scope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: scopeType, id: scopeId }),
      }),
    [type, id],
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('post-navigation focus lands on the newly rendered page title', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  const sidebar = await openResponsiveSidebar(page);
  await sidebar.getByRole('link', { name: '概览', exact: true }).click();
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
  await expect(page.locator('#page-title')).toBeFocused();
});

test('keyboard resend moves focus to the action status summary', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await page.evaluate(() =>
    fetch('/__mock/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authenticated: true, verified: false }),
    }),
  );
  await page.goto(`${server!.origin}/verify-email`);
  const resend = page.getByTestId('resend-button');
  await expect(resend).toBeEnabled();
  await resend.focus();
  await page.keyboard.press('Enter');
  const status = page.getByText(/新的验证邮件已加入发送队列/).locator('..');
  await expect(status).toBeFocused();
});
