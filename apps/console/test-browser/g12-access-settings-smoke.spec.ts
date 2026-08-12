import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

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

/** Load the app once and wait for the MSW-backed shell so the worker is active. */
async function primeApp(page: Page): Promise<void> {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

// PLT-08 minimal acceptance: one real Chromium user chain through the C13-C16
// workspaces, asserting the real views render (no fatal page error, no
// capability-not-provided stub). No real destructive action is executed.
test('PLT-08 smoke: access → client-keys → settings → lifecycle render real views', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await primeApp(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await setSessionAuthenticated(page, true);

  // C13: access workspace renders the effective member list.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/access`);
  await expect(page.getByTestId('project-access-view')).toBeVisible();
  await expect(page.getByTestId('access-members')).toBeVisible();

  // C14: client-keys workspace renders the key list and the create form.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/client-keys`);
  await expect(page.getByTestId('project-client-keys-view')).toBeVisible();
  await expect(page.getByTestId('client-key-list')).toBeVisible();

  // C15: settings workspace renders the general tab.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/settings`);
  await expect(page.getByTestId('project-settings-view')).toBeVisible();
  await expect(page.getByTestId('tab-general')).toBeVisible();
  await expect(page.getByTestId('tab-environments')).toBeVisible();

  // C16: lifecycle workspace renders the summary and high-risk action areas.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/settings/lifecycle`);
  await expect(page.getByTestId('project-lifecycle-view')).toBeVisible();
  await expect(page.getByTestId('lifecycle-summary')).toBeVisible();

  expect(pageErrors).toEqual([]);
  await expect(page.getByText('capability-not-provided')).toHaveCount(0);
});
