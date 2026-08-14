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

async function setProjectScope(page: Page): Promise<void> {
  await page.evaluate(() =>
    fetch('/__mock/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'project', id: 'prj_test_1' }),
    }),
  );
}

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

test('approved representative surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await primeApp(page);
  await setSessionAuthenticated(page, false);
  await page.goto(`${requiredServer().origin}/login`);
  await expect(page).toHaveScreenshot('login-desktop.png', { animations: 'disabled' });

  await setSessionAuthenticated(page, true);
  await page.goto(`${requiredServer().origin}/workspace`);
  await expect(page).toHaveScreenshot('workspace-desktop.png', { animations: 'disabled' });

  await setProjectScope(page);
  await page.goto(`${requiredServer().origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await expect(page).toHaveScreenshot('project-overview-desktop.png', { animations: 'disabled' });

  await page.goto(`${requiredServer().origin}/notifications`);
  await expect(page).toHaveScreenshot('notifications-desktop.png', { animations: 'disabled' });

  await page.goto(`${requiredServer().origin}/account/security`);
  await expect(page).toHaveScreenshot('account-security-desktop.png', { animations: 'disabled' });
});

test('approved representative surfaces at compact widths', async ({ page }) => {
  await primeApp(page);
  await setSessionAuthenticated(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${requiredServer().origin}/login`);
  await expect(page).toHaveScreenshot('login-mobile.png', { animations: 'disabled' });

  await setSessionAuthenticated(page, true);
  await setProjectScope(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${requiredServer().origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await expect(page).toHaveScreenshot('project-overview-tablet.png', { animations: 'disabled' });
});
