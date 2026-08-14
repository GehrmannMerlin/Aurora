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

test('register → verify → login → logout full walk with real Vue components', async ({ page }) => {
  // Prime the app so the MSW worker is active, then start signed out.
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, false);

  // A1 register
  await page.goto(`${server!.origin}/register`);
  await expect(page.getByTestId('register-view')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
  await page.getByLabel('邮箱').fill('user@example.invalid');
  await page.getByLabel('密码').fill('s3cure-Passw0rd!');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByTestId('verify-email-view')).toBeVisible();
  await expect(page.getByText('us**@example.invalid')).toBeVisible();
  await expect(page.getByText(/正在等待邮箱验证/)).toBeVisible();
  // resend respects the server cooldown (resendAvailableAt is in the future)
  await expect(page.getByTestId('resend-button')).toBeDisabled();

  // Refresh proves the page restores a historical pending account from Session,
  // without relying on the in-memory registration handoff. Native button
  // keyboard activation sends the real resend command.
  await page.reload();
  await expect(page.getByText('us**@example.invalid')).toBeVisible();
  const resendButton = page.getByTestId('resend-button');
  await expect(resendButton).toBeEnabled();
  await resendButton.focus();
  await page.keyboard.press('Enter');
  const resendResult = page.getByText(/新的验证邮件已加入发送队列/);
  await expect(resendResult).toBeVisible();
  await expect(resendResult.locator('..')).toBeFocused();

  // A1 verify via the intent-link confirm page
  await page.goto(`${server!.origin}/verify-email/confirm?token=raw_token`);
  await expect(page.getByTestId('verify-email-confirm-view')).toBeVisible();
  await expect(page.getByTestId('confirm-email-button')).toBeVisible();
  // the raw token is cleared from the address bar (history.replaceState)
  await expect(page).not.toHaveURL(/token=/);
  await page.getByTestId('confirm-email-button').click();
  await expect(page.getByText(/邮箱已验证/)).toBeVisible();

  // A2 login (fresh signed-out visit so the login form is reachable)
  await setSessionAuthenticated(page, false);
  await page.goto(`${server!.origin}/login`);
  await expect(page.getByTestId('login-view')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
  await page.getByLabel('邮箱').fill('user@example.invalid');
  await page.getByLabel('密码').fill('s3cure-Passw0rd!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByTestId('workspace-home')).toBeVisible();

  // A2 logout from account security
  await page.goto(`${server!.origin}/account/security`);
  await expect(page.getByTestId('account-security-view')).toBeVisible();
  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-view')).toBeVisible();
});
