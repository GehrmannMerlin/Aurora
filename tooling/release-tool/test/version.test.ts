import { describe, expect, it } from 'vitest';
import type { WorkspacePackage } from '../src/contract.js';
import {
  parseChangesetFile,
  planVersions,
  renderChangelog,
  rewriteWorkspaceDeps,
} from '../src/version.js';

function pkg(name: string, version: string, deps: Record<string, string> = {}): WorkspacePackage {
  return { name, dir: name, manifest: { name, version, dependencies: deps } };
}

describe('parseChangesetFile', () => {
  it('parses JSON frontmatter + markdown summary', () => {
    const result = parseChangesetFile('---\n{"@aurora/event-schema": "minor"}\n---\nadd the v1 negotiation\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bumps).toEqual({ '@aurora/event-schema': 'minor' });
    expect(result.summary).toBe('add the v1 negotiation');
  });

  it('rejects a missing or invalid bump', () => {
    expect(parseChangesetFile('---\n{}\n---\nempty\n').ok).toBe(false);
    expect(parseChangesetFile('---\n{"@aurora/x": "banana"}\n---\nbad\n').ok).toBe(false);
    expect(parseChangesetFile('no frontmatter\n').ok).toBe(false);
  });
});

describe('planVersions', () => {
  it('plans independent bumps in dependency order', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@aurora/event-schema', pkg('@aurora/event-schema', '0.0.0')],
      ['@aurora/core', pkg('@aurora/core', '0.0.0', { '@aurora/event-schema': 'workspace:*' })],
      ['@aurora/plugin-vue', pkg('@aurora/plugin-vue', '0.0.0', { '@aurora/core': 'workspace:*' })],
    ]);
    const plan = planVersions(packages, [
      { packageName: '@aurora/core', bump: 'minor', summary: 'new control plane' },
      { packageName: '@aurora/plugin-vue', bump: 'patch', summary: 'fix install idempotency' },
    ]);
    expect(plan.map((entry) => entry.packageName)).toEqual(['@aurora/core', '@aurora/plugin-vue']);
    expect(plan[0]).toMatchObject({ from: '0.0.0', to: '0.1.0', bump: 'minor' });
    expect(plan[1]).toMatchObject({ from: '0.0.0', to: '0.0.1', bump: 'patch' });
  });

  it('ignores changesets for unknown packages', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@aurora/core', pkg('@aurora/core', '1.0.0')],
    ]);
    const plan = planVersions(packages, [
      { packageName: '@aurora/not-real', bump: 'major', summary: 'x' },
    ]);
    expect(plan).toEqual([]);
  });
});

describe('rewriteWorkspaceDeps', () => {
  it('rewrites workspace:* to ^ranges using final versions', () => {
    const finalVersions = new Map([['@aurora/event-schema', '0.1.0']]);
    const packages = new Map([
      ['@aurora/event-schema', pkg('@aurora/event-schema', '0.1.0')],
      ['@aurora/core', pkg('@aurora/core', '0.2.0')],
    ]);
    const out = rewriteWorkspaceDeps(
      { '@aurora/event-schema': 'workspace:*', '@aurora/core': 'workspace:*', external: '^1.0.0' },
      finalVersions,
      packages,
    );
    expect(out).toEqual({
      '@aurora/event-schema': '^0.1.0',
      '@aurora/core': '^0.2.0',
      external: '^1.0.0',
    });
  });
});

describe('renderChangelog', () => {
  it('renders a per-package changelog entry', () => {
    const text = renderChangelog([
      { packageName: '@aurora/core', bump: 'minor', from: '0.0.0', to: '0.1.0', summary: 'new control plane' },
    ]);
    expect(text).toContain('## 0.1.0');
    expect(text).toContain('- new control plane (minor)');
  });
});
