import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { invalidateScope } from '../../src/api/query.js';
import { setMockScope } from '../../src/mocks/handlers.js';
import { useNavigationStore } from '../../src/stores/navigation.js';
import { mockServer } from '../msw/server.js';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setActivePinia(createPinia());
  mockServer.resetHandlers();
  setMockScope({ type: 'project', id: 'prj_test_1' });
});
afterEach(() => {
  setMockScope({ type: 'project', id: 'prj_test_1' });
  invalidateScope({ type: 'workspace' });
});
afterAll(() => mockServer.close());

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

  it('clear resets to the safe empty state', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    store.clear();
    expect(store.status).toBe('idle');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });
});
