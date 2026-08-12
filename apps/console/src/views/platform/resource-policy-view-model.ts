/**
 * D2 平台资源策略 view-model（PLT-10c）。
 *
 * 纯函数：把能力门禁（checking/forbidden/ready）、目标选择（default/org/project）、
 * 服务端生效策略投影与命令阶段组合成页面渲染所需的封闭状态。投影一律经
 * `sectionToView` 映射（available/empty/unavailable/forbidden），缺失时如实
 * `unavailable`，绝不伪造数据。能力 forbidden 时不渲染任何策略投影。
 */
import type {
  PlatformPolicyFields,
  PlatformPolicyProjection,
  ProjectPolicyProjection,
} from '../../monitoring/queries.js';
import type { SectionResult } from '../../monitoring/section.js';
import { sectionToView, type SectionView } from '../../monitoring/section.js';

/** 目标选择：default 无 id；组织/项目携带 {type, id, name}。 */
export type PolicyTargetSelection =
  | 'default'
  | { readonly type: 'organization' | 'project'; readonly id: string; readonly name: string };

/** 命令阶段：提交中 / 就地错误；成功后由调用方刷新投影。 */
export type ResourcePolicyCommandPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string };

export interface ResourcePolicyViewState {
  readonly capability: 'checking' | 'forbidden' | 'ready';
  readonly target: PolicyTargetSelection;
  readonly projection: SectionView<PlatformPolicyProjection | ProjectPolicyProjection>;
  readonly commandPhase: ResourcePolicyCommandPhase;
  readonly version: number;
  readonly conflict: string | null;
}

export interface ResourcePolicySource {
  readonly capability: 'checking' | 'forbidden' | 'ready';
  readonly target: PolicyTargetSelection;
  readonly projectionSection: SectionResult<
    PlatformPolicyProjection | ProjectPolicyProjection
  > | null;
  readonly commandPhase: ResourcePolicyCommandPhase;
  readonly version: number;
  readonly conflict: string | null;
}

/**
 * 组合能力门禁 + 目标 + 投影 + 命令阶段为渲染状态。
 * 优先级：checking（加载）→ forbidden（不渲染投影）→ ready（投影经 sectionToView）。
 */
export function buildResourcePolicyView(source: ResourcePolicySource): ResourcePolicyViewState {
  if (source.capability === 'checking') {
    return {
      capability: 'checking',
      target: source.target,
      projection: { kind: 'loading' },
      commandPhase: source.commandPhase,
      version: source.version,
      conflict: source.conflict,
    };
  }
  if (source.capability === 'forbidden') {
    return {
      capability: 'forbidden',
      target: source.target,
      projection: { kind: 'forbidden' },
      commandPhase: source.commandPhase,
      version: source.version,
      conflict: source.conflict,
    };
  }
  const projection =
    source.projectionSection === null
      ? ({ kind: 'unavailable', reason: '生效策略不可用' } as const)
      : sectionToView(source.projectionSection);
  return {
    capability: 'ready',
    target: source.target,
    projection,
    commandPhase: source.commandPhase,
    version: source.version,
    conflict: source.conflict,
  };
}

export interface VersionConflictInfo {
  readonly active: boolean;
  readonly message: string;
  readonly currentVersion: number;
}

/**
 * 乐观并发冲突视图：conflict 标记 + 服务端当前 version。
 * 视图据此展示"服务端当前值并要求重新确认"，不合并旧草稿。
 */
export function versionConflictView(state: {
  readonly conflict: string | null;
  readonly version: number;
}): VersionConflictInfo {
  return state.conflict === null
    ? { active: false, message: '', currentVersion: state.version }
    : { active: true, message: state.conflict, currentVersion: state.version };
}

/** 编辑中的五个平台/组织保护字段草稿（与 PolicyFieldsCommandInput 相同形状）。 */
export interface ResourcePolicyFieldDraft {
  readonly defaultPeriodQuota: number;
  readonly warningRatio: number;
  readonly hardLimit: number;
  readonly degradationEnabled: boolean;
  readonly highValueRetentionDays: number;
}

/**
 * 判断五个平台/组织字段的编辑是否需要二次确认：降低任一上限、启用降级保护、
 * 或改变高价值数据保留期限（PRD §15.8 保护语义）。纯函数，供 D2 表单在保存前
 * 决定是否弹确认框。
 */
export function fieldsRequireConfirm(
  draft: ResourcePolicyFieldDraft,
  current: PlatformPolicyFields,
): boolean {
  if (draft.defaultPeriodQuota < current.defaultPeriodQuota) return true;
  if (draft.warningRatio < current.warningRatio) return true;
  if (draft.hardLimit < current.hardLimit) return true;
  if (draft.degradationEnabled && !current.degradationEnabled) return true;
  if (draft.highValueRetentionDays !== current.highValueRetentionDays) return true;
  return false;
}

/**
 * 校验项目资源上限输入：返回正数（≥1）或 null。空白、0、负数、非数字一律拒绝。
 * 纯函数，供 D2 项目表单保存前校验。
 */
export function validateProjectLimitInput(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export {
  formatConfigValue,
  formatCount,
  policySourceLabel,
  propagationLabel,
} from './resource-policy-format.js';
export type { PolicyConfigKey } from './resource-policy-format.js';
