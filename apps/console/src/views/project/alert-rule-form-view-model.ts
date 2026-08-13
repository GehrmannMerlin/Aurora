/**
 * C11 告警规则表单 view-model（PLT-07）。
 *
 * 指标优先自适应：字段/选项/单位/依赖只来自 `alertsGetCapability`（DAT-19），
 * 前端不维护可漂移业务矩阵。纯函数提供：空草稿初始化、选择指标后的默认值、
 * 切换指标的失效字段检测、契约可表达的本地校验（必填 + 固定选项 + 比例样本
 * + 至少一个接收成员）。阈值方向/组合由服务端权威校验。
 */
import type { AlertCapabilityData, AlertMetricCapability } from '../../monitoring/queries.js';

export interface AlertRuleFormDraft {
  readonly name?: string;
  readonly metric: string;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes?: number;
  readonly minSampleCount?: number;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
}

export interface AlertRuleFormSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly capability: AlertCapabilityData | null;
}

/** 指标未选择前的空草稿（依赖字段默认值在选择指标后应用）。 */
export function initialDraft(): AlertRuleFormDraft {
  return {
    metric: '',
    windowMinutes: 5,
    triggerThreshold: 0,
    triggerDurationMinutes: 2,
    recoveryThreshold: 0,
    cooldownMinutes: 10,
    recipientAccountIds: [],
  };
}

/** 查找指标能力；未知指标返回 undefined（阻止提交，不回退通用表达式）。 */
export function metricCapability(
  capability: AlertCapabilityData,
  metric: string,
): AlertMetricCapability | undefined {
  return capability.metrics.find((candidate) => candidate.metric === metric);
}

/**
 * 应用指标能力默认值到草稿：窗口/触发持续时间/冷却使用能力固定选项的首选值，
 * 比例指标设置最小样本数默认 1。返回新草稿（不可变）。
 */
export function applyMetricDefaults(
  draft: AlertRuleFormDraft,
  metric: string,
  capability: AlertCapabilityData,
): AlertRuleFormDraft {
  const cap = metricCapability(capability, metric);
  if (cap === undefined) return { ...draft, metric };
  const windowMinutes = capability.windowsMinutes.includes(draft.windowMinutes)
    ? draft.windowMinutes
    : (capability.windowsMinutes[0] ?? 1);
  const triggerDurationMinutes = capability.triggerDurationsMinutes.includes(
    draft.triggerDurationMinutes,
  )
    ? draft.triggerDurationMinutes
    : (capability.triggerDurationsMinutes[1] ?? capability.triggerDurationsMinutes[0] ?? 2);
  const cooldownMinutes = capability.cooldownsMinutes.includes(draft.cooldownMinutes)
    ? draft.cooldownMinutes
    : 10;
  return {
    ...draft,
    metric,
    windowMinutes,
    triggerDurationMinutes,
    cooldownMinutes,
    ...(cap.isRatio
      ? {
          minSampleCount: draft.minSampleCount ?? 1,
          recoveryDurationMinutes: triggerDurationMinutes,
        }
      : {}),
  };
}

/**
 * 切换指标将失效的字段列表。v1 窗口/持续时间/冷却选项所有指标共用，唯一可能
 * 失效的是比例指标的最小样本数（比例→数量时失效）。前端据此要求确认清除。
 */
export function metricSwitchConflicts(
  draft: AlertRuleFormDraft,
  nextMetric: string,
  capability: AlertCapabilityData,
): readonly string[] {
  const next = metricCapability(capability, nextMetric);
  const current = metricCapability(capability, draft.metric);
  if (next === undefined) return [];
  if (
    current !== undefined &&
    current.isRatio &&
    !next.isRatio &&
    draft.minSampleCount !== undefined
  ) {
    return ['minSampleCount'];
  }
  return [];
}

export interface LocalFieldErrors {
  metric?: string;
  minSampleCount?: string;
  recipientAccountIds?: string;
  windowMinutes?: string;
  triggerDurationMinutes?: string;
  cooldownMinutes?: string;
}

/**
 * 契约可表达的本地校验：必填指标、固定选项在能力集合内、比例指标必须设置
 * 最小样本数、至少一个接收成员。阈值方向/组合等留给服务端权威校验。
 */
export function validateLocalDraft(
  draft: AlertRuleFormDraft,
  capability: AlertCapabilityData,
): LocalFieldErrors {
  const errors: LocalFieldErrors = {};
  if (draft.metric === '') {
    errors.metric = '请选择告警指标。';
    return errors;
  }
  const cap = metricCapability(capability, draft.metric);
  if (cap === undefined) {
    errors.metric = '该指标不在第一版支持集合内。';
    return errors;
  }
  if (!capability.windowsMinutes.includes(draft.windowMinutes)) {
    errors.windowMinutes = '统计窗口必须是固定选项之一。';
  }
  if (!capability.triggerDurationsMinutes.includes(draft.triggerDurationMinutes)) {
    errors.triggerDurationMinutes = '触发持续时间必须是固定选项之一。';
  }
  if (!capability.cooldownsMinutes.includes(draft.cooldownMinutes)) {
    errors.cooldownMinutes = '冷却时间必须是固定选项之一。';
  }
  if (cap.isRatio && (draft.minSampleCount === undefined || draft.minSampleCount < 1)) {
    errors.minSampleCount = '比例型指标必须设置最小样本数（≥1）。';
  }
  if (draft.recipientAccountIds.length < 1) {
    errors.recipientAccountIds = '至少选择一个接收成员。';
  }
  return errors;
}
