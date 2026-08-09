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

test('register form validates with field-level hints and no fatal errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${server!.origin}/`);
  // Prime the app so the MSW worker is active, then start signed out.
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setSessionAuthenticated(page, false);

  await page.goto(`${server!.origin}/register`);
  await expect(page.getByTestId('register-view')).toBeVisible();

  // The real password rule is visible ahead of input.
  await expect(page.getByText('密码需为 8–256 个字符。')).toBeVisible();

  // An invalid email shows the field-level message next to the email field.
  await page.getByLabel('邮箱').fill('a');
  await page.getByLabel('密码').fill('s3cure-Passw0rd!');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByText('请输入 3–320 个字符的邮箱地址。')).toBeVisible();

  // An invalid password shows the field-level message next to the password field.
  await page.getByLabel('邮箱').fill('user@example.invalid');
  await page.getByLabel('密码').fill('short');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByText('密码需为 8–256 个字符。')).toBeVisible();

  // No fatal page error (includes the Invalid PrimeUI License banner signal).
  expect(pageErrors).toEqual([]);
});
