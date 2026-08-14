import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { validProblemSamples } from '@aurora/platform-contract/contract-testkit';
import { invalidateScope } from '../../src/api/query.js';
import { handlerControls, setMockScope } from '../../src/mocks/handlers.js';
import { useNavigationStore } from '../../src/stores/navigation.js';
import { mockServer } from '../msw/server.js';

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  setActivePinia(createPinia());
  mockServer.resetHandlers();
  setMockScope({ type: 'project', id: 'prj_test_1' });
  handlerControls.delayMs = 0;
});
afterEach(() => {
  setMockScope({ type: 'project', id: 'prj_test_1' });
  invalidateScope({ type: 'workspace' });
});
afterAll(() => {
  mockServer.close();
});

describe('Navigation Context consumer', () => {
  it('loads the authorized navigation projection', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.organizations[0]?.name).toBe('Acme');
    expect(store.currentScope?.type).toBe('project');
  });

  it('derives the current organization from the project scope', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.currentOrganizationId).toBe('org_test_1');
    expect(store.currentProject?.projectId).toBe('prj_test_1');
    expect(store.currentProject?.name).toBe('Web');
  });

  it('activates workspace, organization, and project scopes from the authorized projection', async () => {
    const store = useNavigationStore();
    await store.load();

    store.activateWorkspace();
    expect(store.currentScope).toEqual({ type: 'workspace', lifecycle: 'active' });

    const organizationTarget = store.activateOrganization('org_test_1');
    expect(organizationTarget?.routeId).toBe('workspace.home');
    expect(store.currentScope).toEqual({
      type: 'organization',
      id: 'org_test_1',
      lifecycle: 'active',
    });

    const projectTarget = store.activateProject('prj_test_1');
    expect(projectTarget?.routeId).toBe('project.overview');
    expect(store.currentScope).toEqual({
      type: 'project',
      id: 'prj_test_1',
      lifecycle: 'active',
    });
  });

  it('does not change scope for an unauthorized organization or project id', async () => {
    const store = useNavigationStore();
    await store.load();
    const originalScope = store.currentScope;

    expect(store.activateOrganization('org_unknown')).toBeNull();
    expect(store.activateProject('prj_unknown')).toBeNull();
    expect(store.currentScope).toEqual(originalScope);
  });

  it('supports an organization scope through the test control', async () => {
    setMockScope({ type: 'organization', id: 'org_test_1' });
    const store = useNavigationStore();
    await store.load();
    expect(store.currentScope?.type).toBe('organization');
    expect(store.currentOrganizationId).toBe('org_test_1');
  });

  it('enters a safe empty state when the context is unavailable', async () => {
    mockServer.use(http.get('/api/platform/v1/navigation/context', () => HttpResponse.error()));
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('unavailable');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });

  it('enters a safe empty state on an RFC 9457 problem response', async () => {
    mockServer.use(
      http.get('/api/platform/v1/navigation/context', () =>
        HttpResponse.json(validProblemSamples[0] as JsonBodyType, { status: 404 }),
      ),
    );
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('unavailable');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });

  it('returns null when the current project belongs to no organization', async () => {
    setMockScope({ type: 'project', id: 'prj_unknown' });
    const store = useNavigationStore();
    await store.load();
    expect(store.currentScope?.type).toBe('project');
    expect(store.currentOrganizationId).toBeNull();
  });

  it('does not reload the projection once it is ready', async () => {
    const store = useNavigationStore();
    await store.load();
    setMockScope({ type: 'workspace' });
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.currentScope?.type).toBe('project');
  });

  it('clear resets to the safe empty state', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    store.clear();
    expect(store.status).toBe('idle');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });

  it('does not resurrect cleared state when clear() runs during an in-flight load', async () => {
    handlerControls.delayMs = 50;
    try {
      const store = useNavigationStore();
      const pending = store.load();
      expect(store.status).toBe('loading');
      store.clear();
      expect(store.status).toBe('idle');
      await pending;
      expect(store.status).toBe('idle');
      expect(store.organizations).toHaveLength(0);
      expect(store.currentScope).toBeNull();
    } finally {
      handlerControls.delayMs = 0;
    }
    // a fresh load after the stale in-flight load is discarded still commits
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.organizations[0]?.name).toBe('Acme');
  });
});
