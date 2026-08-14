import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCache } from '../../../src/api/cache.js';
import { router } from '../../../src/router/index.js';
import { pinia } from '../../../src/stores/index.js';
import { useSessionStore } from '../../../src/stores/session.js';
import { handlerControls } from '../../../src/mocks/handlers.js';
import ProjectAlertInstanceDetailView from '../../../src/views/project/ProjectAlertInstanceDetailView.vue';
import ProjectAlertRuleFormView from '../../../src/views/project/ProjectAlertRuleFormView.vue';
import ProjectSourceMapsView from '../../../src/views/project/ProjectSourceMapsView.vue';
import { mockServer } from '../../msw/server.js';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));

beforeEach(async () => {
  requestCache.clear();
  handlerControls.sessionAuthenticated = true;
  useSessionStore(pinia).reset();
  await useSessionStore(pinia).restore();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
});

afterAll(() => mockServer.close());

describe('delivery and alerting rendered regressions', () => {
  it('selects a Source Map file by keyboard and renders only returned-file evidence', async () => {
    await router.push('/organizations/org_test_1/projects/prj_test_1/releases/release_test_1');
    await router.isReady();
    render(ProjectSourceMapsView, { global: { plugins: [pinia, router] } });

    const sourceMap = await screen.findByRole('button', { name: /assets\/app\.js/ });
    expect(sourceMap.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.keyDown(sourceMap, { key: 'Enter' });
    expect(sourceMap.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('source-map-selected-file').textContent).toContain('/assets/app.js');
    expect(
      screen.getByTestId('source-map-selected-file').querySelector('.mon-build-path')?.textContent,
    ).not.toContain('sm_test_1');
    expect(screen.getByTestId('source-map-selected-file-technical').textContent).toContain('sm_test_1');
  });

  it('renders C11 grouped fields after metric selection and keeps its command available', async () => {
    await router.push('/organizations/org_test_1/projects/prj_test_1/alerts/rules/new');
    await router.isReady();
    render(ProjectAlertRuleFormView, { global: { plugins: [pinia, router] } });

    const metric = await screen.findByTestId('alert-rule-metric');
    await fireEvent.update(metric, 'error_count');
    expect(screen.getByTestId('alert-rule-threshold-group')).toBeTruthy();
    expect(screen.getByTestId('alert-rule-delivery-group')).toBeTruthy();
    expect((screen.getByTestId('alert-rule-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders C12 evidence as read-only and does not expose raw instance identifiers', async () => {
    await router.push('/organizations/org_test_1/projects/prj_test_1/alerts/instances/instance_test_1');
    await router.isReady();
    render(ProjectAlertInstanceDetailView, { global: { plugins: [pinia, router] } });

    await screen.findByTestId('alert-instance-evidence');
    expect(screen.getByTestId('alert-instance-status').querySelector('.mon-rule-name')?.textContent).not.toContain(
      'rule_test_1',
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
