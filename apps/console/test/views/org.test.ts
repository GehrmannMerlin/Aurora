import { http, HttpResponse, type JsonBodyType } from 'msw';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCache } from '../../src/api/cache';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { useNavigationStore } from '../../src/stores/navigation';
import { useSessionStore } from '../../src/stores/session';
import { handlerControls } from '../../src/mocks/handlers';
import { mockServer } from '../msw/server';
import MembersView from '../../src/views/organization/MembersView.vue';
import ProjectCreateView from '../../src/views/organization/ProjectCreateView.vue';
import SettingsView from '../../src/views/organization/SettingsView.vue';
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
  handlerControls.createProjectRequests = 0;
  handlerControls.listMembersRequests = 0;
  handlerControls.inviteMemberRequests = 0;
  handlerControls.revokeInvitationRequests = 0;
  handlerControls.resendInvitationRequests = 0;
  handlerControls.changeRoleRequests = 0;
  handlerControls.removeMemberRequests = 0;
  handlerControls.transferOwnershipRequests = 0;
  handlerControls.updateTimezoneRequests = 0;
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

describe('B2 create project (7B)', () => {
  it('submits the form and shows the public client key identifier', async () => {
    await router.push('/organizations/org_test_1/projects/new');
    await router.isReady();
    render(ProjectCreateView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('project-create-view')).toBeTruthy();

    await screen.findByTestId('project-name-input');
    await fireEvent.update(screen.getByTestId('project-name-input'), 'Web App');
    await fireEvent.update(screen.getByTestId('project-framework-select'), 'react');
    await fireEvent.update(screen.getByTestId('project-website-input'), 'https://example.com');
    await fireEvent.click(screen.getByTestId('create-project-submit'));

    expect(await screen.findByTestId('create-success')).toBeTruthy();
    // The PUBLIC client key identifier is shown; the key secret never is.
    expect(screen.getByTestId('client-key-public-identifier').textContent).toBe(
      'ck_pub_test_12345',
    );
    expect(handlerControls.createProjectRequests).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid project name without sending a request', async () => {
    await router.push('/organizations/org_test_1/projects/new');
    await router.isReady();
    render(ProjectCreateView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('project-create-view')).toBeTruthy();

    await screen.findByTestId('project-name-input');
    await fireEvent.update(screen.getByTestId('project-name-input'), 'A');
    expect(screen.getByTestId('name-error').textContent).toMatch(/2–50/);
    expect(
      (screen.getByTestId('create-project-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(handlerControls.createProjectRequests).toBe(0);
  });

  it('shows a forbidden state for a member without the create verb', async () => {
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/projects', () =>
        HttpResponse.json(MEMBER_PROJECTS as JsonBodyType, { status: 200 }),
      ),
    );
    await router.push('/organizations/org_test_1/projects/new');
    await router.isReady();
    render(ProjectCreateView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('create-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('project-name-input')).toBeNull();
  });
});

describe('B3 members and invitations (7B)', () => {
  it('lists members with masked emails only', async () => {
    await router.push('/organizations/org_test_1/members');
    await router.isReady();
    render(MembersView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('member-list')).toBeTruthy();
    expect(screen.getAllByText('ow**@example.invalid').length).toBeGreaterThanOrEqual(1);
    // The masked email may also appear in the ownership-transfer select options.
    expect(screen.getAllByText('me**@example.invalid').length).toBeGreaterThanOrEqual(1);
    // The full email must never render on the members page.
    expect(screen.queryByText('user@example.invalid')).toBeNull();
    expect(handlerControls.listMembersRequests).toBeGreaterThanOrEqual(1);
  });

  it('invites a member and renders the pending invitation row', async () => {
    await router.push('/organizations/org_test_1/members');
    await router.isReady();
    render(MembersView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('member-list')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('invite-email-input'), 'new@example.invalid');
    await fireEvent.update(screen.getByTestId('invite-role-select'), 'admin');
    await fireEvent.click(screen.getByTestId('invite-submit'));

    expect(await screen.findByTestId('invitation-row')).toBeTruthy();
    expect(screen.getByText('ne**@example.invalid')).toBeTruthy();
    expect(handlerControls.inviteMemberRequests).toBeGreaterThanOrEqual(1);
  });

  it('changes a member role via the change-role command', async () => {
    await router.push('/organizations/org_test_1/members');
    await router.isReady();
    render(MembersView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('member-list')).toBeTruthy();

    // member -> admin, then admin -> member: the button must toggle, not no-op.
    const toggle = screen.getByTestId('change-role-acct_test_2');
    expect(toggle.textContent).toContain('设为管理员');
    await fireEvent.click(toggle);
    await waitFor(() => expect(handlerControls.changeRoleRequests).toBeGreaterThanOrEqual(1));

    await waitFor(() =>
      expect(screen.getByTestId('change-role-acct_test_2').textContent).toContain('设为成员'),
    );
    await fireEvent.click(screen.getByTestId('change-role-acct_test_2'));
    await waitFor(() => expect(handlerControls.changeRoleRequests).toBeGreaterThanOrEqual(2));
  });

  it('hides management controls for a plain member', async () => {
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/members', () =>
        HttpResponse.json(
          {
            members: [
              { accountId: 'acct_test_1', emailMasked: 'us**@example.invalid', orgRole: 'member' },
            ],
            navigationTargets: [],
          } as JsonBodyType,
          { status: 200 },
        ),
      ),
    );
    await router.push('/organizations/org_test_1/members');
    await router.isReady();
    render(MembersView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('member-list')).toBeTruthy();
    expect(screen.queryByTestId('members-manage')).toBeNull();
    expect(screen.queryByTestId('transfer-ownership')).toBeNull();
  });
});

describe('B4 organization settings / timezone (7B)', () => {
  it('updates the organization timezone', async () => {
    await router.push('/organizations/org_test_1/settings');
    await router.isReady();
    render(SettingsView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('settings-view')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('timezone-input'), 'Asia/Shanghai');
    await fireEvent.click(screen.getByTestId('timezone-submit'));

    expect(await screen.findByTestId('timezone-success')).toBeTruthy();
    expect(screen.getByTestId('current-timezone').textContent).toContain('Asia/Shanghai');
    expect(handlerControls.updateTimezoneRequests).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid IANA timezone without sending a request', async () => {
    await router.push('/organizations/org_test_1/settings');
    await router.isReady();
    render(SettingsView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('settings-view')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('timezone-input'), 'Not/AZone');
    expect(screen.getByTestId('timezone-error').textContent).toMatch(/IANA/);
    expect((screen.getByTestId('timezone-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(handlerControls.updateTimezoneRequests).toBe(0);
  });

  it('recovers the current version from a 412 version_conflict and resubmits', async () => {
    let calls = 0;
    let capturedResourceVersion = '';
    mockServer.use(
      http.patch('/api/platform/v1/organizations/:organizationId/settings/timezone', async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { resourceVersion: string };
        if (calls === 1) {
          return HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Version conflict',
              status: 412,
              detail: 'The organization settings version is stale.',
              code: 'version_conflict',
              requestId: 'req_test_412',
              fieldErrors: [{ field: 'resourceVersion', reason: 'Current version is 3.' }],
            } as JsonBodyType,
            { status: 412 },
          );
        }
        capturedResourceVersion = body.resourceVersion;
        return HttpResponse.json(
          {
            organizationId: 'org_test_1',
            timezone: 'Asia/Tokyo',
            resourceVersion: '3',
          } as JsonBodyType,
          { status: 200 },
        );
      }),
    );
    await router.push('/organizations/org_test_1/settings');
    await router.isReady();
    render(SettingsView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('settings-view')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('timezone-input'), 'Asia/Tokyo');
    await fireEvent.click(screen.getByTestId('timezone-submit'));
    expect(await screen.findByTestId('timezone-error-banner')).toBeTruthy();
    expect(screen.getByTestId('timezone-error-banner').textContent).toMatch(/版本已刷新/);

    await fireEvent.click(screen.getByTestId('timezone-submit'));
    expect(await screen.findByTestId('timezone-success')).toBeTruthy();
    expect(capturedResourceVersion).toBe('3');
  });
});
