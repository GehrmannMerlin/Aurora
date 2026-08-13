import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '$&');
}

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

// PLT-05/06 flip C1—C7 to real monitoring views (consuming real public Queries).
// The remaining project entries stay honest unavailable stubs until PLT-07/08.
const REAL_PROJECT_ENTRIES: ReadonlyArray<{ name: string; path: string; view: string }> = [
  {
    name: '接入',
    path: '/organizations/org_test_1/projects/prj_test_1/onboarding',
    view: 'project-onboarding-view',
  },
  {
    name: '概览',
    path: '/organizations/org_test_1/projects/prj_test_1/overview',
    view: 'project-overview-view',
  },
  {
    name: '数据状态',
    path: '/organizations/org_test_1/projects/prj_test_1/data-status',
    view: 'project-data-status-view',
  },
  {
    name: '问题',
    path: '/organizations/org_test_1/projects/prj_test_1/issues',
    view: 'project-issues-view',
  },
  {
    name: '请求',
    path: '/organizations/org_test_1/projects/prj_test_1/requests',
    view: 'project-requests-view',
  },
  {
    name: '性能',
    path: '/organizations/org_test_1/projects/prj_test_1/performance',
    view: 'project-performance-view',
  },
  // PLT-07/08 flip the release/alert/access/settings entries to real views.
  {
    name: '发布',
    path: '/organizations/org_test_1/projects/prj_test_1/releases',
    view: 'project-releases-view',
  },
  {
    name: '告警',
    path: '/organizations/org_test_1/projects/prj_test_1/alerts',
    view: 'project-alerts-view',
  },
  {
    name: '访问',
    path: '/organizations/org_test_1/projects/prj_test_1/access',
    view: 'project-access-view',
  },
  {
    name: '客户端密钥',
    path: '/organizations/org_test_1/projects/prj_test_1/client-keys',
    view: 'project-client-keys-view',
  },
  {
    name: '设置',
    path: '/organizations/org_test_1/projects/prj_test_1/settings',
    view: 'project-settings-view',
  },
];

const ORG_ENTRIES: ReadonlyArray<{ name: string; path: string; view: string }> = [
  { name: '成员', path: '/organizations/org_test_1/members', view: 'members-view' },
  { name: '设置', path: '/organizations/org_test_1/settings', view: 'settings-view' },
  { name: '用量', path: '/organizations/org_test_1/usage', view: 'usage-view' },
  { name: '令牌', path: '/organizations/org_test_1/tokens', view: 'tokens-view' },
  { name: '审计', path: '/organizations/org_test_1/audit', view: 'audit-view' },
  { name: '回收站', path: '/organizations/org_test_1/trash', view: 'trash-view' },
];

test('every project sidebar entry is reachable by real click — PLT-05/06/07/08 real views render', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  for (const entry of REAL_PROJECT_ENTRIES) {
    await page.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId(entry.view)).toBeVisible();
  }
  // C4 issue detail (menu:false) is directly reachable and renders the real view.
  await page.goto(
    `${server!.origin}/organizations/org_test_1/projects/prj_test_1/issues/issue_test_1`,
  );
  await expect(page.getByTestId('project-issue-detail-view')).toBeVisible();
});

test('top bar workspace, notifications and account entries are reachable by real click', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  await expect(page.getByRole('link', { name: '工作空间' })).toBeVisible();
  await page.getByRole('link', { name: '工作空间', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  // PLT-09: 通知 now renders the real D1 notification center (not an unavailable stub).
  await page.getByRole('link', { name: '通知', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await page.getByRole('link', { name: '账号安全', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByTestId('account-security-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '账号安全', level: 1 })).toBeVisible();
});
test('every organization sidebar entry is reachable by real click after switching scope', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setMockScope(page, 'organization', 'org_test_1');
  await page.reload();
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  for (const entry of ORG_ENTRIES) {
    await page.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId(entry.view)).toBeVisible();
  }
});

test('scope switch (real select) clears the old scope state', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await page.selectOption('#scope-org', 'org_test_1');
  // 壳层骨架语义：切换作用域清除旧缓存/选择；新作用域未获服务端确认前不显示伪造入口
  await expect(page.locator('.au-sidebar-list li')).toHaveCount(0);
});

test('a nav entry is reachable by keyboard (focus + Enter)', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  const overview = page.getByRole('link', { name: '概览', exact: true });
  await overview.focus();
  await expect(overview).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
  await expect(page.getByTestId('project-overview-view')).toBeVisible();
});
test('platform G13 resource-policy target renders the real D2 view (not an unavailable stub)', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, true);
  await page.goto(`${server!.origin}/platform/resource-policies`);
  // PLT-10c makes platform.resource-policies a real D2 view; the test-mode
  // capability probe resolves to a platform admin, so the real effective-policy
  // table renders (never an unavailable stub and never fabricated data).
  await expect(page.getByTestId('resource-policy-view')).toBeVisible();
  await expect(page.getByTestId('rp-effective-policy')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
});

test('auth routes render the real PLT-03 views (not unavailable stubs) when signed out', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, false);
  await page.goto(`${server!.origin}/login`);
  await expect(page.getByTestId('login-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录', level: 1 })).toBeVisible();
  await page.goto(`${server!.origin}/register`);
  await expect(page.getByTestId('register-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '注册', level: 1 })).toBeVisible();
});

test('an authenticated user visiting an auth-only route is redirected to the workspace', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, true);
  await page.goto(`${server!.origin}/login`);
  await expect(page).toHaveURL(/\/workspace$/);
});
