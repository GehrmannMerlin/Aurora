import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

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

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('B1 workspace home lists projects and honors allowedActions', async ({ page }) => {
  // Prime the app so the MSW worker is active, then sign in.
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/workspace?organizationId=org_test_1`);
  await expect(page.getByTestId('workspace-home')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Web', exact: true })).toBeVisible();
  await expect(page.getByTestId('create-project-button')).toBeVisible();
  await expect(page.getByTestId('organization-scope')).toBeVisible();
  await expect(page.getByTestId('project-row')).toBeVisible();
  await expect(page.getByTestId('open-project-prj_test_1')).toHaveText('打开项目');
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B5 usage page shows the authoritative usage projection', async ({ page }) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/usage`);
  await expect(page.getByTestId('usage-view')).toBeVisible();
  await expect(page.getByTestId('usage-accepted')).toHaveText('12');
  await expect(page.getByTestId('usage-processed')).toHaveText('10');
  await expect(page.getByText('正常', { exact: true })).toBeVisible();
  // The page uses authoritative numeric evidence and does not fabricate charts.
  await expect(page.getByTestId('usage-chart')).toHaveCount(0);
  await expect(page.getByTestId('usage-number')).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B2 create-project form keeps client-key plaintext out of the browser response', async ({
  page,
}) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/projects/new`);
  await expect(page.getByTestId('project-create-view')).toBeVisible();
  await page.getByTestId('project-name-input').fill('Web App');
  await page.getByTestId('project-framework-select').selectOption('react');
  await page.getByTestId('project-website-input').fill('https://example.com');
  await page.getByTestId('create-project-submit').click();

  await expect(page.getByTestId('create-success')).toBeVisible();
  await expect(page.getByTestId('client-key-public-identifier')).toHaveText('ck_pub_test_12345');
  await expect(page.locator('body')).not.toContainText('aurora_ingest_');
  await page.getByTestId('enter-project-button').click();
  await expect(page).toHaveURL(/\/projects\/prj_created_1\/overview$/);
  await expect(page.getByTestId('project-overview-view')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B3 members lists masked emails and invites a member', async ({ page }) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/members`);
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
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/settings`);
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await page.getByTestId('timezone-input').fill('Asia/Shanghai');
  await page.getByTestId('timezone-submit').click();
  await expect(page.getByTestId('timezone-success')).toBeVisible();
  await expect(page.getByTestId('current-timezone')).toContainText('Asia/Shanghai');
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B6 tokens: list is metadata-only and the one-time plaintext is never re-displayed', async ({
  page,
}) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/tokens`);
  await expect(page.getByTestId('token-list')).toBeVisible();
  await expect(page.getByTestId('token-name')).toHaveText('ci-token');
  // Metadata only: no digest/plaintext in the DOM before any create.
  await expect(page.getByText(/aurora_pt_/)).toHaveCount(0);

  await page.getByTestId('token-name-input').fill('ci-deploy');
  await page.getByTestId('token-scope-releases.write').check();
  await page.getByTestId('token-create-submit').click();

  await expect(page.getByTestId('token-plaintext')).toHaveText(
    'aurora_pt_pt_test_2_abcdef1234567890',
  );
  // The plaintext appears in exactly one element.
  await expect(page.getByText('aurora_pt_pt_test_2_abcdef1234567890')).toHaveCount(1);

  // Reload: the component mounts fresh; the one-time secret must be gone.
  await page.reload();
  await expect(page.getByTestId('token-list')).toBeVisible();
  await expect(page.getByTestId('token-plaintext')).toHaveCount(0);
  await expect(page.getByText(/aurora_pt_/)).toHaveCount(0);

  // Create once more, then navigate away and back: the plaintext must not
  // return with the remounted component.
  await page.getByTestId('token-name-input').fill('ci-deploy-2');
  await page.getByTestId('token-scope-releases.write').check();
  await page.getByTestId('token-create-submit').click();
  await expect(page.getByTestId('token-plaintext')).toHaveText(
    'aurora_pt_pt_test_2_abcdef1234567890',
  );

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/members`);
  await expect(page.getByTestId('member-list')).toBeVisible();
  await page.goto(`${requiredServer().origin}/organizations/org_test_1/tokens`);
  await expect(page.getByTestId('token-list')).toBeVisible();
  await expect(page.getByTestId('token-plaintext')).toHaveCount(0);
  await expect(page.getByText(/aurora_pt_/)).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B7 audit shows a redacted security timeline', async ({ page }) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/audit`);
  await expect(page.getByTestId('audit-list')).toBeVisible();
  await expect(page.getByTestId('audit-primary-action')).toHaveText('已邀请成员');
  await expect(page.getByTestId('audit-primary-result')).toHaveText('已完成');
  await expect(page.getByTestId('audit-timestamp')).toContainText('UTC');
  // Redacted actor only; never the full email.
  await expect(page.getByTestId('audit-actor')).toHaveText('ow**@example.invalid');
  await expect(page.getByText('user@example.invalid')).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});

test('B8 trash lists recoverable projects and restores one', async ({ page }) => {
  await page.goto(`${requiredServer().origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
  await setSessionAuthenticated(page, true);

  await page.goto(`${requiredServer().origin}/organizations/org_test_1/trash`);
  await expect(page.getByTestId('trash-list')).toBeVisible();
  await expect(page.getByTestId('trash-name')).toHaveText('Legacy');
  await expect(page.getByTestId('trash-safety-note')).toContainText('不会被恢复');

  await page.getByTestId('restore-project-prj_test_2').click();
  await expect(page.getByTestId('trash-restore-success')).toBeVisible();
  await expect(page.getByTestId('trash-row')).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);
});
