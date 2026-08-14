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
import TokensView from '../../src/views/organization/TokensView.vue';
import AuditView from '../../src/views/organization/AuditView.vue';
import TrashView from '../../src/views/organization/TrashView.vue';

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
  handlerControls.listPrivateTokensRequests = 0;
  handlerControls.createPrivateTokenRequests = 0;
  handlerControls.revokePrivateTokenRequests = 0;
  handlerControls.listSecurityAuditRequests = 0;
  handlerControls.listTrashRequests = 0;
  handlerControls.restoreProjectRequests = 0;
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

  it('uses the workspace header, explicit organization scope, and project rows without fabricated metrics', async () => {
    await router.push({ path: '/workspace', query: { organizationId: 'org_test_1' } });
    await router.isReady();
    render(WorkspaceHomeView, { global: { plugins: [pinia, router] } });

    expect(await screen.findByTestId('workspace-home')).toBeTruthy();
    expect(screen.getByText('在组织范围内选择和管理可访问项目。')).toBeTruthy();
    expect(screen.getByTestId('organization-scope')).toBeTruthy();
    expect(await screen.findByTestId('project-row')).toBeTruthy();
    expect(screen.getByTestId('project-framework').textContent).toBe('Vue');
    expect(screen.getByTestId('project-lifecycle').textContent).toBe('运行中');
    expect(screen.getByTestId('open-project-prj_test_1').textContent).toContain('打开项目');
    expect(screen.queryByText('健康分')).toBeNull();
    expect(screen.queryByText('趋势')).toBeNull();
    expect(screen.queryByTestId('workspace-metric')).toBeNull();
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
  it('separates basic and configuration fields beneath one page heading', async () => {
    await router.push('/organizations/org_test_1/projects/new');
    await router.isReady();
    render(ProjectCreateView, { global: { plugins: [pinia, router] } });

    expect(await screen.findByTestId('project-create-view')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(await screen.findByTestId('project-basic-section')).toBeTruthy();
    expect(screen.getByTestId('project-settings-section')).toBeTruthy();
  });

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
    expect(screen.getByTestId<HTMLButtonElement>('create-project-submit').disabled).toBe(true);
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
    await waitFor(() => {
      expect(handlerControls.changeRoleRequests).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId('change-role-acct_test_2').textContent).toContain('设为成员');
    });
    await fireEvent.click(screen.getByTestId('change-role-acct_test_2'));
    await waitFor(() => {
      expect(handlerControls.changeRoleRequests).toBeGreaterThanOrEqual(2);
    });
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
    expect(await screen.findByTestId('timezone-input')).toBeTruthy();

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
    expect(await screen.findByTestId('timezone-input')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('timezone-input'), 'Not/AZone');
    expect(screen.getByTestId('timezone-error').textContent).toMatch(/IANA/);
    expect(screen.getByTestId<HTMLButtonElement>('timezone-submit').disabled).toBe(true);
    expect(handlerControls.updateTimezoneRequests).toBe(0);
  });

  it('recovers the current version from a 412 version_conflict and resubmits', async () => {
    let calls = 0;
    let capturedResourceVersion = '';
    mockServer.use(
      http.patch(
        '/api/platform/v1/organizations/:organizationId/settings/timezone',
        async ({ request }) => {
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
        },
      ),
    );
    await router.push('/organizations/org_test_1/settings');
    await router.isReady();
    render(SettingsView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('settings-view')).toBeTruthy();
    expect(await screen.findByTestId('timezone-input')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('timezone-input'), 'Asia/Tokyo');
    await fireEvent.click(screen.getByTestId('timezone-submit'));
    expect(await screen.findByTestId('timezone-error-banner')).toBeTruthy();
    expect(screen.getByTestId('timezone-error-banner').textContent).toMatch(/版本已刷新/);

    await fireEvent.click(screen.getByTestId('timezone-submit'));
    expect(await screen.findByTestId('timezone-success')).toBeTruthy();
    expect(capturedResourceVersion).toBe('3');
  });

  it('shows a forbidden state for a plain member (server re-checks)', async () => {
    usePlainMemberProjection();
    await router.push('/organizations/org_test_1/settings');
    await router.isReady();
    render(SettingsView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('settings-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('timezone-input')).toBeNull();
    expect(screen.queryByTestId('timezone-submit')).toBeNull();
  });
});

/** Override the members projection so the session account is a plain member. */
function usePlainMemberProjection(): void {
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
}

describe('B6 private tokens (7C)', () => {
  it('lists tokens with metadata only (no digest or plaintext in the DOM)', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();
    expect(screen.getByTestId('token-name').textContent).toBe('ci-token');
    // The scope appears in the token row and the create-form checkbox; both are
    // metadata-only renderings.
    expect(screen.getAllByText('source_maps.upload').length).toBeGreaterThanOrEqual(1);
    // Metadata only: no digest, no plaintext is ever rendered.
    expect(screen.queryByText(/aurora_pt_/)).toBeNull();
    expect(screen.queryByTestId('token-plaintext')).toBeNull();
    expect(handlerControls.listPrivateTokensRequests).toBeGreaterThanOrEqual(1);
  });

  it('creates a token and shows the one-time plaintext exactly once', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('token-name-input'), 'ci-deploy');
    await fireEvent.click(screen.getByTestId('token-scope-releases.write'));
    await fireEvent.click(screen.getByTestId('token-create-submit'));

    const panel = await screen.findByTestId('token-plaintext-panel');
    expect(panel).toBeTruthy();
    const value = screen.getByTestId('token-plaintext').textContent;
    expect(value).toBe('aurora_pt_pt_test_2_abcdef1234567890');
    // The plaintext appears in exactly ONE element in the DOM.
    expect(screen.getAllByText('aurora_pt_pt_test_2_abcdef1234567890')).toHaveLength(1);
    expect(handlerControls.createPrivateTokenRequests).toBeGreaterThanOrEqual(1);
  });

  it('clears the one-time plaintext when the user acknowledges the panel', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('token-name-input'), 'ci-deploy');
    await fireEvent.click(screen.getByTestId('token-scope-releases.write'));
    await fireEvent.click(screen.getByTestId('token-create-submit'));
    expect(await screen.findByTestId('token-plaintext')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('token-close-panel'));
    expect(screen.queryByTestId('token-plaintext')).toBeNull();
    expect(screen.queryByText(/aurora_pt_/)).toBeNull();
  });

  it('does NOT re-display the one-time plaintext after leave/refresh (unmount + remount)', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();

    await fireEvent.update(screen.getByTestId('token-name-input'), 'ci-deploy');
    await fireEvent.click(screen.getByTestId('token-scope-releases.write'));
    await fireEvent.click(screen.getByTestId('token-create-submit'));
    expect(await screen.findByTestId('token-plaintext')).toBeTruthy();

    // Simulate a route leave / refresh: the component unmounts and a fresh
    // instance mounts. The one-time secret lives only in the old instance's
    // memory and is never persisted, so it must not come back.
    cleanup();
    render(TokensView, { global: { plugins: [pinia, router] } });
    await screen.findByTestId('token-list');
    expect(screen.queryByTestId('token-plaintext')).toBeNull();
    expect(screen.queryByText(/aurora_pt_/)).toBeNull();
  });

  it('revokes a token via credentialsRevokePrivateToken', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('revoke-token-pt_test_1'));
    await waitFor(() => {
      expect(handlerControls.revokePrivateTokenRequests).toBeGreaterThanOrEqual(1);
    });
    // The revoke button is replaced by the revoked marker.
    await waitFor(() => {
      expect(screen.queryByTestId('revoke-token-pt_test_1')).toBeNull();
    });
    expect(screen.getByText('已撤销')).toBeTruthy();
  });

  it('does NOT render a revoked token as active after unmount + remount (cache invalidated)', async () => {
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('token-list')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('revoke-token-pt_test_1'));
    await waitFor(() => {
      expect(handlerControls.revokePrivateTokenRequests).toBeGreaterThanOrEqual(1);
    });

    // The real server persists `revoked_at` on revoke; mirror that so the
    // remount reads a server projection where the token is revoked.
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/private-tokens', () =>
        HttpResponse.json(
          {
            tokens: [
              {
                tokenId: 'pt_test_1',
                name: 'ci-token',
                scopes: ['source_maps.upload'],
                revokedAt: '2026-08-09T03:00:00.000Z',
              },
            ],
            navigationTargets: [],
          } as JsonBodyType,
          { status: 200 },
        ),
      ),
    );

    // Leave (unmount) and remount: the org-scope request cache must be
    // invalidated by the revoke so the fresh mount re-reads the server state
    // where the token is revoked — not the stale pre-revoke list.
    cleanup();
    render(TokensView, { global: { plugins: [pinia, router] } });
    await screen.findByTestId('token-list');
    expect(screen.queryByTestId('revoke-token-pt_test_1')).toBeNull();
    expect(screen.getByText('已撤销')).toBeTruthy();
    expect(screen.queryByTestId('token-plaintext')).toBeNull();
  });

  it('shows a forbidden state for a plain member (server re-checks)', async () => {
    usePlainMemberProjection();
    await router.push('/organizations/org_test_1/tokens');
    await router.isReady();
    render(TokensView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('tokens-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('token-create')).toBeNull();
  });
});

describe('B7 security audit (7C)', () => {
  it('renders the redacted security timeline with no full email', async () => {
    await router.push('/organizations/org_test_1/audit');
    await router.isReady();
    render(AuditView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('audit-list')).toBeTruthy();
    expect(screen.getByTestId('audit-action').textContent).toBe('member.invited');
    // Redacted actor: only the masked projection is rendered, never the full email.
    expect(screen.getByTestId('audit-actor').textContent).toBe('ow**@example.invalid');
    expect(screen.queryByText('user@example.invalid')).toBeNull();
    expect(screen.queryByText(/aurora_pt_/)).toBeNull();
    expect(handlerControls.listSecurityAuditRequests).toBeGreaterThanOrEqual(1);
  });

  it('loads the next audit page when a cursor is available', async () => {
    let calls = 0;
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/audit', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            {
              events: [
                {
                  eventId: 'aud_test_1',
                  action: 'member.invited',
                  occurredAt: '2026-08-09T01:00:00.000Z',
                  result: 'succeeded',
                  actorMasked: 'ow**@example.invalid',
                },
              ],
              pagination: { nextCursor: 'cursor_2', totalCountStatus: 'available' },
            } as JsonBodyType,
            { status: 200 },
          );
        }
        return HttpResponse.json(
          {
            events: [
              {
                eventId: 'aud_test_2',
                action: 'project.restored',
                occurredAt: '2026-08-09T02:00:00.000Z',
                result: 'succeeded',
                actorMasked: 'ad**@example.invalid',
              },
            ],
            pagination: { totalCountStatus: 'available' },
          } as JsonBodyType,
          { status: 200 },
        );
      }),
    );
    await router.push('/organizations/org_test_1/audit');
    await router.isReady();
    render(AuditView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('audit-load-more')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('audit-load-more'));
    await waitFor(() => {
      expect(screen.queryByTestId('audit-load-more')).toBeNull();
    });
    expect(screen.getAllByTestId('audit-row')).toHaveLength(2);
    expect(screen.getByText('project.restored')).toBeTruthy();
  });

  it('shows a forbidden state for a plain member', async () => {
    usePlainMemberProjection();
    await router.push('/organizations/org_test_1/audit');
    await router.isReady();
    render(AuditView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('audit-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('audit-list')).toBeNull();
  });
});

describe('B8 trash restore (7C)', () => {
  it('lists recoverable projects and shows the G10 safety note', async () => {
    await router.push('/organizations/org_test_1/trash');
    await router.isReady();
    render(TrashView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('trash-list')).toBeTruthy();
    expect(screen.getByTestId('trash-name').textContent).toBe('Legacy');
    expect(screen.getByTestId('trash-safety-note').textContent).toMatch(/不会被恢复/);
    expect(handlerControls.listTrashRequests).toBeGreaterThanOrEqual(1);
  });

  it('restores a project, recovering the current version from a 412 and resubmitting', async () => {
    let calls = 0;
    let capturedResourceVersion = '';
    mockServer.use(
      http.post(
        '/api/platform/v1/organizations/:organizationId/trash/:projectId/restore',
        async ({ request }) => {
          calls += 1;
          const body = (await request.json()) as { resourceVersion: string };
          if (calls === 1) {
            return HttpResponse.json(
              {
                type: 'about:blank',
                title: 'Version conflict',
                status: 412,
                detail: 'The project version is stale.',
                code: 'version_conflict',
                requestId: 'req_test_412',
                fieldErrors: [
                  {
                    field: 'resourceVersion',
                    reason: 'Current version is 2026-08-09T02:00:00.000Z.',
                  },
                ],
              } as JsonBodyType,
              { status: 412 },
            );
          }
          capturedResourceVersion = body.resourceVersion;
          return HttpResponse.json(
            {
              projectId: 'prj_test_2',
              status: 'active',
              lifecycle: 'active',
              navigationTargets: [],
            } as JsonBodyType,
            { status: 200 },
          );
        },
      ),
    );
    await router.push('/organizations/org_test_1/trash');
    await router.isReady();
    render(TrashView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('trash-list')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('restore-project-prj_test_2'));
    expect(await screen.findByTestId('trash-restore-success')).toBeTruthy();
    // The override handler counts restore attempts (first 412, second success).
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(capturedResourceVersion).toBe('2026-08-09T02:00:00.000Z');
    // The restored row leaves the trash list.
    expect(screen.queryByTestId('trash-row')).toBeNull();
  });

  it('shows a forbidden state for a plain member', async () => {
    usePlainMemberProjection();
    await router.push('/organizations/org_test_1/trash');
    await router.isReady();
    render(TrashView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByTestId('trash-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('trash-list')).toBeNull();
  });
});
