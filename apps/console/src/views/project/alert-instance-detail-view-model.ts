/**
 * C12 告警实例详情 view-model（PLT-07）。
 *
 * 只消费 `alertsGetInstanceDetail`（DAT-19）真实投影：当前状态/直接原因、
 * 规则快照、评估证据、有序业务状态轨迹。`evaluation_paused` 显示暂停而非
 * 恢复；`completeness: insufficient|missing` 明确展示数据不足。完全只读。
 */
import type {
  AlertInstanceDetailData,
  AlertInstanceEvidence,
  AlertInstanceTransition,
} from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

export type AlertDetailInstance = AlertInstanceDetailData['instance'];
export type AlertRuleSnapshot = AlertInstanceDetailData['ruleSnapshot'];

export interface AlertInstanceDetailViewState {
  readonly instance: SectionView<AlertDetailInstance>;
  readonly ruleSnapshot: SectionView<AlertRuleSnapshot>;
  readonly evidence: SectionView<AlertInstanceEvidence>;
  readonly transitions: SectionView<readonly AlertInstanceTransition[]>;
}

export interface AlertInstanceDetailSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly detail: AlertInstanceDetailData | null;
}

export function buildAlertInstanceDetailView(
  source: AlertInstanceDetailSource,
): AlertInstanceDetailViewState {
  if (source.loading) {
    return {
      instance: { kind: 'loading' },
      ruleSnapshot: { kind: 'loading' },
      evidence: { kind: 'loading' },
      transitions: { kind: 'loading' },
    };
  }
  if (source.error !== null) {
    const errorView: SectionView<never> = { kind: 'error', message: source.error };
    return {
      instance: errorView,
      ruleSnapshot: errorView,
      evidence: errorView,
      transitions: errorView,
    };
  }
  if (source.detail === null) {
    return {
      instance: { kind: 'unavailable', reason: '告警实例详情不可用' },
      ruleSnapshot: { kind: 'unavailable', reason: '规则快照不可用' },
      evidence: { kind: 'unavailable', reason: '评估证据不可用' },
      transitions: { kind: 'unavailable', reason: '状态轨迹不可用' },
    };
  }
  return {
    instance: { kind: 'available', data: source.detail.instance },
    ruleSnapshot: { kind: 'available', data: source.detail.ruleSnapshot },
    evidence: { kind: 'available', data: source.detail.evidence },
    transitions: { kind: 'available', data: source.detail.transitions },
  };
}

/** 实例状态用户标签（`recovered` 为终态；`evaluation_paused` 不显示为恢复）。 */
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
      return state;
  }
}

/** 评估证据完整性标签（PRD §11.2.10 数据缺失语义）。 */
export function completenessLabel(completeness: string): string {
  switch (completeness) {
    case 'complete':
      return '数据完整';
    case 'insufficient':
      return '样本不足';
    case 'missing':
      return '数据缺失';
    default:
      return completeness;
  }
}
