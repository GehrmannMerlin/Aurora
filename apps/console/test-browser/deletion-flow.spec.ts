import AxeBuilder from '@axe-core/playwright';
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

async function setDeletionPreflight(page: Page, status: 'ready' | 'blocked'): Promise<void> {
  await page.evaluate(
    ({ origin, value }) =>
      fetch(`${origin}/__mock/deletion-preflight`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: value }),
      }),
    { origin: requiredServer().origin, value: status },
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('A5 blocked preflight shows the blocking org list and no delete submit', async ({ page }) => {
  // Prime the app so the MSW worker is active, then set the blocked projection.
  await page.goto(`${requiredServer().origin}/`);
  await waitForShell(page);
  await setSessionAuthenticated(page, true);
  await setDeletionPreflight(page, 'blocked');

  await page.goto(`${requiredServer().origin}/account/security`);
  await expect(page.getByTestId('account-security-view')).toBeVisible();
  await expect(page.getByTestId('deletion-org-block-list')).toBeVisible();
  await expect(page.getByTestId('deletion-org-name')).toHaveText('Acme');
  await expect(page.getByTestId('deletion-org-kind')).toHaveText('组织');
  // The blocked state must not present the final delete submit.
  await expect(page.getByTestId('delete-account-button')).toHaveCount(0);
  await expect(page.getByTestId('deletion-recheck-button')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('A5 cancel page: valid link, submit password, land on login', async ({ page }) => {
  await page.goto(`${requiredServer().origin}/`);
  await waitForShell(page);
  await setSessionAuthenticated(page, false);
  await setDeletionPreflight(page, 'ready');

  await page.goto(`${requiredServer().origin}/account/deletion-cancel?token=raw_token`);
  await expect(page.getByTestId('deletion-cancel-view')).toBeVisible();
  await expect(page.getByText('us**@example.invalid')).toBeVisible();
  // The raw token is cleared from the address bar (history.replaceState).
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel('当前密码').fill('s3cure-Password!');
  await page.getByRole('button', { name: '撤销注销' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-view')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});
