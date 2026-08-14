/**
 * C10 告警规则/实例双标签页 view-model（PLT-07）。
 *
 * 只消费 `alertsListRulesAndInstances`（DAT-19）真实投影。规则当前评估投影
 * 与实例生命周期状态分开渲染；`recovered` 只结束一个实例；`evaluation_paused`
 * 显示暂停原因而非恢复。缺失一律 empty/unavailable，不推断"正常"。
 */
import type { AlertInstanceSummary, AlertRuleSummary } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export interface AlertsViewState {
  readonly rules: SectionView<readonly AlertRuleSummary[]>;
  readonly instances: SectionView<readonly AlertInstanceSummary[]>;
}

export interface AlertsSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly rules: SectionResult<{ readonly items: readonly AlertRuleSummary[] }> | null;
  readonly instances: SectionResult<{
    readonly items: readonly AlertInstanceSummary[];
    readonly count: number;
    readonly totalCountStatus: string;
  }> | null;
}

/** 把服务端 rules section 展开为渲染状态。 */
export function ruleSectionToItems(
  section: SectionResult<{ readonly items: readonly AlertRuleSummary[] }>,
): SectionView<readonly AlertRuleSummary[]> {
  switch (section.status) {
    case 'available':
      return { kind: 'available', data: section.data.items };
    case 'empty':
      return { kind: 'empty', reason: section.reason };
    case 'partial':
      return { kind: 'partial', data: section.data.items, missing: section.missing };
    case 'stale':
      return {
        kind: 'stale',
        data: section.data.items,
        freshAt: section.freshAt,
        staleReason: section.staleReason,
      };
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'unavailable':
      return { kind: 'unavailable', reason: section.reason };
  }
}

/** 把服务端 instances section 展开为渲染状态。 */
export function instanceSectionToItems(
  section: SectionResult<{
    readonly items: readonly AlertInstanceSummary[];
    readonly count: number;
    readonly totalCountStatus: string;
  }>,
): SectionView<readonly AlertInstanceSummary[]> {
  switch (section.status) {
    case 'available':
      return { kind: 'available', data: section.data.items };
    case 'empty':
      return { kind: 'empty', reason: section.reason };
    case 'partial':
      return { kind: 'partial', data: section.data.items, missing: section.missing };
    case 'stale':
      return {
        kind: 'stale',
        data: section.data.items,
        freshAt: section.freshAt,
        staleReason: section.staleReason,
      };
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'unavailable':
      return { kind: 'unavailable', reason: section.reason };
  }
}

export function buildAlertsView(source: AlertsSource): AlertsViewState {
  let rules: SectionView<readonly AlertRuleSummary[]>;
  let instances: SectionView<readonly AlertInstanceSummary[]>;
  if (source.loading) {
    rules = { kind: 'loading' };
    instances = { kind: 'loading' };
  } else if (source.error !== null) {
    rules = { kind: 'error', message: source.error };
    instances = { kind: 'error', message: source.error };
  } else if (source.rules === null) {
    rules = { kind: 'unavailable', reason: '告警规则列表不可用' };
    instances =
      source.instances === null
        ? { kind: 'unavailable', reason: '告警实例列表不可用' }
        : instanceSectionToItems(source.instances);
  } else {
    rules = ruleSectionToItems(source.rules);
    instances =
      source.instances === null
        ? { kind: 'unavailable', reason: '告警实例列表不可用' }
        : instanceSectionToItems(source.instances);
  }
  return { rules, instances };
}

/** 规则当前评估状态标签（PRD §11.2.9 用户显示名称）。 */
export function ruleStateLabel(state: string): string {
  switch (state) {
    case 'normal':
      return '正常';
    case 'pending_trigger':
      return '等待触发';
    case 'triggered':
      return '已触发';
    case 'pending_recovery':
      return '等待恢复';
    case 'recovered':
      return '已恢复';
    case 'evaluation_paused':
      return '计算暂停';
    default:
      return '评估状态未知';
  }
}

/** 实例生命周期状态标签（`recovered` 是实例终态；再触发产生新实例）。 */
export function instanceStateLabel(state: string): string {
  switch (state) {
    case 'triggered':
      return '已触发';
    case 'pending_recovery':
      return '等待恢复';
    case 'recovered':
      return '已恢复';
    case 'evaluation_paused':
      return '计算暂停';
    default:
      return '实例状态未知';
  }
}
