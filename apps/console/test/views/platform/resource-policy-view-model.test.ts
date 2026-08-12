import { describe, expect, it } from 'vitest';
import {
  buildResourcePolicyView,
  formatConfigValue,
  formatCount,
  policySourceLabel,
  propagationLabel,
  versionConflictView,
} from '../../../src/views/platform/resource-policy-view-model.js';
import type {
  PlatformPolicyFields,
  PlatformPolicyProjection,
  ProjectPolicyProjection,
} from '../../../src/monitoring/queries.js';

const FIVE_FIELDS: PlatformPolicyFields = {
  defaultPeriodQuota: 1_000_000,
  warningRatio: 80,
  hardLimit: 90,
  degradationEnabled: true,
  highValueRetentionDays: 90,
};

const defaultProjection: PlatformPolicyProjection = {
  configured: { ...FIVE_FIELDS },
  source: 'system_default',
  effective: { ...FIVE_FIELDS },
  version: 1,
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

const projectProjection: ProjectPolicyProjection = {
  configured: { resourceLimit: 50_000 },
  source: 'inherited_from_organization',
  effective: { ...FIVE_FIELDS, resourceLimit: 50_000 },
  version: 3,
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

const idle = { kind: 'idle' as const };

describe('buildResourcePolicyView', () => {
  it('checking capability gates nothing and renders a loading projection', () => {
    const view = buildResourcePolicyView({
      capability: 'checking',
      target: 'default',
      projectionSection: null,
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(view.capability).toBe('checking');
    expect(view.projection).toEqual({ kind: 'loading' });
  });

  it('forbidden capability renders no policy projection', () => {
    const view = buildResourcePolicyView({
      capability: 'forbidden',
      target: 'default',
      projectionSection: { status: 'available', data: defaultProjection },
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(view.capability).toBe('forbidden');
    expect(view.projection).toEqual({ kind: 'forbidden' });
  });

  it('ready capability maps an available projection through sectionToView', () => {
    const view = buildResourcePolicyView({
      capability: 'ready',
      target: 'default',
      projectionSection: { status: 'available', data: defaultProjection },
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(view.capability).toBe('ready');
    expect(view.projection).toEqual({ kind: 'available', data: defaultProjection });
  });

  it('ready capability maps empty and unavailable sections honestly', () => {
    const empty = buildResourcePolicyView({
      capability: 'ready',
      target: 'default',
      projectionSection: { status: 'empty', reason: '尚未配置' },
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(empty.projection).toEqual({ kind: 'empty', reason: '尚未配置' });

    const unavailable = buildResourcePolicyView({
      capability: 'ready',
      target: 'default',
      projectionSection: { status: 'unavailable', reason: '策略服务不可用' },
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(unavailable.projection).toEqual({ kind: 'unavailable', reason: '策略服务不可用' });
  });

  it('ready capability surfaces a missing projection as unavailable (never fabricated)', () => {
    const view = buildResourcePolicyView({
      capability: 'ready',
      target: 'default',
      projectionSection: null,
      commandPhase: idle,
      version: 1,
      conflict: null,
    });
    expect(view.projection).toEqual({ kind: 'unavailable', reason: '生效策略不可用' });
  });

  it('carries target, command phase, version and conflict through', () => {
    const view = buildResourcePolicyView({
      capability: 'ready',
      target: { type: 'project', id: 'prj_1', name: '示例项目' },
      projectionSection: { status: 'available', data: projectProjection },
      commandPhase: { kind: 'error', message: '保存失败' },
      version: 3,
      conflict: '版本冲突',
    });
    expect(view.target).toEqual({ type: 'project', id: 'prj_1', name: '示例项目' });
    expect(view.commandPhase).toEqual({ kind: 'error', message: '保存失败' });
    expect(view.version).toBe(3);
    expect(view.conflict).toBe('版本冲突');
    expect(view.projection).toEqual({ kind: 'available', data: projectProjection });
  });
});

describe('policySourceLabel', () => {
  it('maps all four policy sources to Chinese labels', () => {
    expect(policySourceLabel('system_default')).toBe('系统默认');
    expect(policySourceLabel('platform_admin')).toBe('平台管理员配置');
    expect(policySourceLabel('inherited_from_organization')).toBe('继承自组织');
    expect(policySourceLabel('inherited_from_platform')).toBe('继承自平台默认');
  });

  it('passes through unknown sources unchanged', () => {
    expect(policySourceLabel('mystery_source')).toBe('mystery_source');
  });
});

describe('formatConfigValue', () => {
  it('formats the five shared fields with their units', () => {
    expect(formatConfigValue('defaultPeriodQuota', 1_000_000)).toBe('1,000,000 事件/月');
    expect(formatConfigValue('warningRatio', 80)).toBe('80%');
    expect(formatConfigValue('hardLimit', 90)).toBe('90%');
    expect(formatConfigValue('highValueRetentionDays', 90)).toBe('90 天');
    expect(formatConfigValue('degradationEnabled', true)).toBe('开启');
    expect(formatConfigValue('degradationEnabled', false)).toBe('关闭');
  });

  it('formats the project resource limit without a unit suffix', () => {
    expect(formatConfigValue('resourceLimit', 50_000)).toBe('50,000');
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1_000_000)).toBe('1,000,000');
    expect(formatCount(50_000)).toBe('50,000');
    expect(formatCount(1)).toBe('1');
  });
});

describe('propagationLabel', () => {
  it('labels the always-unknown propagation state honestly', () => {
    expect(propagationLabel('unknown')).toBe('传播状态未知/未确认');
  });

  it('passes through unexpected statuses unchanged', () => {
    expect(propagationLabel('active')).toBe('active');
  });
});

describe('versionConflictView', () => {
  it('is inactive without a conflict and reports the current version', () => {
    expect(versionConflictView({ conflict: null, version: 2 })).toEqual({
      active: false,
      message: '',
      currentVersion: 2,
    });
  });

  it('surfaces the conflict marker and current version for re-confirmation', () => {
    expect(versionConflictView({ conflict: '版本冲突', version: 4 })).toEqual({
      active: true,
      message: '版本冲突',
      currentVersion: 4,
    });
  });
});
