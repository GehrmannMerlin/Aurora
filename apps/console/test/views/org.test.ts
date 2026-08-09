import { http, HttpResponse, type JsonBodyType } from 'msw';
import { cleanup, render, screen } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCache } from '../../src/api/cache';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { useNavigationStore } from '../../src/stores/navigation';
import { useSessionStore } from '../../src/stores/session';
import { handlerControls } from '../../src/mocks/handlers';
import { mockServer } from '../msw/server';
import UsageView from '../../src/views/organization/UsageView.vue';
import WorkspaceHomeView from '../../src/views/workspace/WorkspaceHomeView.vue';

// A plain-member projection: no manager verbs, so the UI must hide the
// create-project action even though the project list renders.
const MEMBER_PROJECTS = {
  projects: [
    {
      projectId: 'prj_test_1',
      name: 'Web',
      frameworkType: 'vue',
      status: 'active',
      lifecycle: 'active',
    },
  ],
  allowedActions: ['read'],
  navigationTargets: [],
};

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});

beforeEach(async () => {
  requestCache.clear();
  handlerControls.sessionAuthenticated = true;
  handlerControls.listProjectsRequests = 0;
  useSessionStore(pinia).reset();
  useNavigationStore(pinia).clear();
  await useSessionStore(pinia).restore();
  await useNavigationStore(pinia).load();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
});

afterAll(() => {
  mockServer.close();
});

describe('B1 workspace home (7A)', () => {
  it('lists the selected org projects via organizationListProjects', async () => {
    await router.push({ path: '/workspace', query: { organizationId: 'org_test_1' } });
    await router.isReady();
    render(WorkspaceHomeView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByText('Web')).toBeTruthy();
    expect(screen.getByText('Acme 的项目')).toBeTruthy();
    expect(handlerControls.listProjectsRequests).toBeGreaterThanOrEqual(1);
  });

  it('shows the create-project button when allowedActions includes create', async () => {
    await router.push({ path: '/workspace', query: { organizationId: 'org_test_1' } });
    await router.isReady();
    render(WorkspaceHomeView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('create-project-button')).toBeTruthy();
  });

  it('hides the create-project button when allowedActions lacks create', async () => {
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/projects', () =>
        HttpResponse.json(MEMBER_PROJECTS as JsonBodyType, { status: 200 }),
      ),
    );
    await router.push({ path: '/workspace', query: { organizationId: 'org_test_1' } });
    await router.isReady();
    render(WorkspaceHomeView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByText('Web')).toBeTruthy();
    expect(screen.queryByTestId('create-project-button')).toBeNull();
  });
});

describe('B5 usage unavailable (7A)', () => {
  it('renders an honest capability gap with no fabricated usage data', async () => {
    await router.push('/organizations/org_test_1/usage');
    await router.isReady();
    render(UsageView, { global: { plugins: [pinia, router] } });
    expect(screen.getByTestId('usage-view')).toBeTruthy();
    expect(screen.getByText('功能未提供')).toBeTruthy();
    expect(screen.getByText(/不会显示任何模拟数据/)).toBeTruthy();
    expect(screen.queryByTestId('usage-chart')).toBeNull();
    expect(screen.queryByTestId('usage-number')).toBeNull();
  });

  it('redirects an authenticated non-member to the forbidden page', async () => {
    await router.push('/organizations/org_not_mine/usage');
    await router.isReady();
    expect(router.currentRoute.value.name).toBe('forbidden');
  });
});
