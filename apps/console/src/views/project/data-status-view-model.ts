/**
 * C7 数据接收诊断（`project.data-status`）view-model（PLT-05）。
 *
 * 完整呈现 `diagnosticsGetDataStatus`（DAT-20）的六个安全投影区
 * （summary/stages/recent/rejection/credential/queryable）与获授权 actionTargets。
 * 每个区独立渲染 `SectionResult`；被拒绝批次区恒 `unavailable`（契约语义），
 * 环境维度恒 `unavailable`，缺失一律不显示为零或“正常”。
 */
import type {
  ActionTarget,
  CredentialSafeStatus,
  DiagnosisData,
  DiagnosisSummary,
  QueryableEvidence,
  RecentEvidence,
  StageFacts,
} from '../../monitoring/diagnosis.js';
import { toSectionView, type SectionView } from '../../monitoring/section.js';

export interface DataStatusState {
  readonly summary: SectionView<DiagnosisSummary>;
  readonly stages: SectionView<StageFacts>;
  readonly recent: SectionView<RecentEvidence>;
  readonly rejection: SectionView<Record<string, never>>;
  readonly credential: SectionView<CredentialSafeStatus>;
  readonly queryable: SectionView<QueryableEvidence>;
  readonly actions: readonly ActionTarget[];
}

export interface DataStatusSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly diagnosis: DiagnosisData | null;
}

export function buildDataStatusState(source: DataStatusSource): DataStatusState {
  const diagnosis = source.diagnosis;
  return {
    summary: toSectionView<DiagnosisSummary>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.summary ?? null,
    }),
    stages: toSectionView<StageFacts>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.stages ?? null,
    }),
    recent: toSectionView<RecentEvidence>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.recent ?? null,
    }),
    rejection: toSectionView<Record<string, never>>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.rejection ?? null,
    }),
    credential: toSectionView<CredentialSafeStatus>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.credential ?? null,
    }),
    queryable: toSectionView<QueryableEvidence>({
      loading: source.loading,
      error: source.error,
      section: diagnosis?.queryable ?? null,
    }),
    actions: diagnosis?.actionTargets ?? [],
  };
}
