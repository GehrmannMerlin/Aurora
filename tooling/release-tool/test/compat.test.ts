import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkExportsTypes,
  checkProtocolDecoupling,
  checkWorkspaceDepRewritePlan,
  readProtocolVersion,
} from '../src/compat.js';
import type { WorkspacePackage } from '../src/contract.js';
import type { VersionPlanEntry } from '../src/version.js';

function pkg(name: string, dir: string, manifest: Record<string, unknown>): WorkspacePackage {
  return { name, dir, manifest };
}

describe('readProtocolVersion', () => {
  it('reads CURRENT_PROTOCOL_VERSION and the supported set', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-compat-'));
    try {
      mkdirSync(join(root, 'packages/event-schema/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/event-schema/src/constants.ts'),
        'export const CURRENT_PROTOCOL_VERSION = 1 as const;\nexport const SUPPORTED_PROTOCOL_VERSIONS = [CURRENT_PROTOCOL_VERSION] as const;\n',
      );
      expect(readProtocolVersion(root)).toEqual({ currentVersion: 1, supportedVersions: [1] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('checkProtocolDecoupling', () => {
  it('passes while the protocol stays at version 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-compat-'));
    try {
      mkdirSync(join(root, 'packages/event-schema/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/event-schema/src/constants.ts'),
        'export const CURRENT_PROTOCOL_VERSION = 1 as const;\nexport const SUPPORTED_PROTOCOL_VERSIONS = [CURRENT_PROTOCOL_VERSION] as const;\n',
      );
      expect(checkProtocolDecoupling(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when the protocol version is bumped by an npm release', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-compat-'));
    try {
      mkdirSync(join(root, 'packages/event-schema/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/event-schema/src/constants.ts'),
        'export const CURRENT_PROTOCOL_VERSION = 2 as const;\n',
      );
      const issues = checkProtocolDecoupling(root);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.message).toContain('requires a new ADR');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('checkExportsTypes', () => {
  it('flags a dangling exports path', () => {
    const packages = new Map<string, WorkspacePackage>([
      [
        '@aurora/core',
        pkg('@aurora/core', '/tmp/x', {
          name: '@aurora/core',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/missing.js' } },
        }),
      ],
    ]);
    const issues = checkExportsTypes(packages);
    expect(issues.some((issue) => issue.message.includes('import target missing'))).toBe(true);
  });
});

describe('checkWorkspaceDepRewritePlan', () => {
  it('flags a workspace:* dep not resolved by the plan', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@aurora/plugin-vue', pkg('@aurora/plugin-vue', '/tmp/p', {
        name: '@aurora/plugin-vue',
        dependencies: { '@aurora/core': 'workspace:*' },
      })],
    ]);
    const plan: readonly VersionPlanEntry[] = [];
    const issues = checkWorkspaceDepRewritePlan(packages, plan);
    expect(issues.some((issue) => issue.message.includes('not resolved by the release plan'))).toBe(true);
  });

  it('passes when every workspace:* dep is planned', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@aurora/plugin-vue', pkg('@aurora/plugin-vue', '/tmp/p', {
        name: '@aurora/plugin-vue',
        dependencies: { '@aurora/core': 'workspace:*' },
      })],
    ]);
    const plan: readonly VersionPlanEntry[] = [
      { packageName: '@aurora/core', bump: 'minor', from: '0.0.0', to: '0.1.0', summary: 'x' },
    ];
    expect(checkWorkspaceDepRewritePlan(packages, plan)).toEqual([]);
  });
});
