import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

/** Load the app once and wait for the MSW-backed shell so the worker is active. */
async function primeApp(page: Page): Promise<void> {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

// PLT-10c minimal acceptance: one real Chromium chain through the D2 platform
// resource-policy page — normal navigation → capability probe → target picker →
// effective platform-default policy display. No fatal page error, no
// capability-not-provided stub. The MSW fixture is the test double; real
// production data is never fabricated.
test('PLT-10c smoke: resource-policy page renders target picker and effective default policy without fatal errors', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await primeApp(page);
  await setSessionAuthenticated(page, true);

  // Normal navigation to the D2 platform resource-policy page.
  await page.goto(`${server!.origin}/platform/resource-policies`);
  await expect(page.getByTestId('resource-policy-view')).toBeVisible();

  // Capability probe resolved (platform admin in test fixture): the target
  // picker and the default-policy effective display render.
  await expect(page.getByTestId('rp-target-picker')).toBeVisible();
  await expect(page.getByTestId('rp-target-select')).toBeVisible();
  await expect(page.getByTestId('rp-effective-policy')).toBeVisible();
  await expect(page.getByTestId('rp-policy-evidence-table')).toBeVisible();
  await expect(page.getByRole('cell', { name: '周期配额' })).toBeVisible();

  // Target search resolves into selectable options (no fatal error); selecting
  // an organization switches the effective projection to the org override.
  const searchInput = page.getByTestId('rp-target-search');
  await searchInput.fill('Acme');
  await expect(page.getByRole('option', { name: '组织 · Acme' })).toHaveCount(1);
  await page.getByTestId('rp-target-select').selectOption('org:org_test_1');
  await expect(
    page.getByTestId('rp-effective-policy').getByText('组织 · Acme'),
  ).toBeVisible();
  await expect(page.getByTestId('rp-org-reset')).toBeVisible();
  await searchInput.fill('Web');
  await expect(page.getByRole('option', { name: '项目 · Web' })).toHaveCount(1);
  await page.getByTestId('rp-target-select').selectOption('prj:prj_test_1');
  const projectEvidence = page.getByTestId('rp-policy-evidence-table');
  await expect(projectEvidence).toBeVisible();
  await expect(projectEvidence.getByRole('columnheader')).toHaveCount(4);
  await expect(projectEvidence.getByRole('row').nth(1).getByRole('cell')).toHaveCount(4);
  await expect(page.getByTestId('rp-project-limit-editor')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(projectEvidence).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  expect(pageErrors).toEqual([]);
  await expect(page.getByText('capability-not-provided')).toHaveCount(0);
});
