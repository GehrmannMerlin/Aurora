import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCache } from '../../../src/api/cache.js';
import { handlerControls } from '../../../src/mocks/handlers.js';
import { pinia } from '../../../src/stores/index.js';
import { useSessionStore } from '../../../src/stores/session.js';
import ResourcePolicyView from '../../../src/views/platform/ResourcePolicyView.vue';
import { mockServer } from '../../msw/server.js';

const source = readFileSync('src/views/platform/ResourcePolicyView.vue', 'utf8');

describe('platform resource-policy workspace presentation', () => {
  it('leads with the platform-admin target selector and a policy evidence summary', () => {
    const targetIndex = source.indexOf('data-testid="rp-target-picker"');
    const summaryIndex = source.indexOf('data-testid="rp-effective-policy"');

    expect(targetIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeGreaterThan(targetIndex);
    expect(source).toContain('class="resource-policy-workspace"');
    expect(source).toContain('data-testid="rp-policy-source"');
    expect(source).toContain('data-testid="rp-policy-propagation"');
  });

  it('keeps default, organization override, and project limit editors separate without unsupported analytics', () => {
    expect(source).toContain("'rp-platform-default-editor'");
    expect(source).toContain("'rp-organization-override-editor'");
    expect(source).toContain('data-testid="rp-project-limit-editor"');
    expect(source).not.toMatch(/趋势|成本|预测|排名/);
  });
});

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});

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

afterAll(() => {
  mockServer.close();
});

function tableText(row: HTMLElement, role: 'columnheader' | 'cell'): string[] {
  return within(row)
    .getAllByRole(role)
    .map((cell) => cell.textContent.trim());
}

function expectEvidenceSchema(table: HTMLElement): void {
  const rows = within(table).getAllByRole('row');
  const [headerRow, ...dataRows] = rows;
  if (headerRow === undefined) throw new Error('Policy evidence table must contain a header row');
  expect(tableText(headerRow, 'columnheader')).toEqual([
    '策略字段',
    '已配置值',
    '来源',
    '生效值',
  ]);
  for (const row of dataRows) {
    expect(tableText(row, 'cell')).toHaveLength(4);
  }
}

async function renderPolicy(): Promise<void> {
  render(ResourcePolicyView, { global: { plugins: [pinia] } });
  await screen.findByTestId('rp-policy-evidence-table');
}

async function selectPolicyTarget(query: string, target: string): Promise<void> {
  await fireEvent.update(screen.getByTestId('rp-target-search'), query);
  await waitFor(() => {
    expect((screen.getByTestId('rp-target-select')).querySelector(`option[value="${target}"]`)).not.toBeNull();
  });
  await fireEvent.update(screen.getByTestId('rp-target-select'), target);
  await waitFor(() => {
    expect(screen.getByTestId('rp-policy-evidence-table')).toBeTruthy();
  });
}

describe('platform resource-policy evidence table', () => {
  it('renders default policy rows against the complete evidence header schema', async () => {
    await renderPolicy();
    expectEvidenceSchema(screen.getByTestId('rp-policy-evidence-table'));
  });

  it('renders organization override rows against the complete evidence header schema', async () => {
    await renderPolicy();
    await selectPolicyTarget('Acme', 'org:org_test_1');
    expectEvidenceSchema(screen.getByTestId('rp-policy-evidence-table'));
  });

  it('renders project limit rows against the complete evidence header schema', async () => {
    await renderPolicy();
    await selectPolicyTarget('Web', 'prj:prj_test_1');
    expectEvidenceSchema(screen.getByTestId('rp-policy-evidence-table'));
  });
});
