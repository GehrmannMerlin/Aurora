/**
 * Ingestion diagnosis (DAT-20 `diagnosticsGetDataStatus`) typed consumption and
 * pure display model (PLT-05 C1/C2/C7).
 *
 * The server composes the authority status (`summary`) and safe evidence
 * (`stages`/`recent`/`credential`/`queryable`) and returns authorized navigation
 * targets (`actionTargets`). This module only maps that server output into
 * display strings/tones and hrefs — it never re-computes a business status from
 * timestamps or counts, and never maps it to PRD §4.4.6 onboarding states (that
 * requires backend capabilities that are not provided).
 */
import type { RouteTargetId } from '@aurora/platform-contract';
import type { SectionResult } from './section.js';
import { resolveRouteTarget } from '../contracts/route-registry.js';

export type DiagnosisStatus = 'receiving' | 'processing' | 'blocked' | 'not_receiving' | 'unknown';
export type DiagnosisCause =
  'credential_inactive' | 'no_credential' | 'no_received_events' | 'processing_backlog';

export interface DiagnosisSummary {
  readonly status: DiagnosisStatus;
  readonly primaryCause?: DiagnosisCause;
  readonly asOf: string;
}

export interface StageFact {
  readonly count: number;
  readonly latestAt?: string;
}

export interface StageFacts {
  readonly received: StageFact;
  readonly processing: StageFact;
  readonly processed: StageFact;
  readonly deadLetter: StageFact & { readonly lastErrorCode?: string };
}

export interface RecentEvidence {
  readonly latestReceivedAt?: string;
  readonly receivedCount: number;
  readonly latestProcessedAt?: string;
  readonly processedCount: number;
  readonly environmentBreakdown: SectionResult<Record<string, never>>;
}

export interface CredentialSafeStatus {
  readonly activeCount: number;
  readonly disabledCount: number;
  readonly revokedCount: number;
  readonly latestCreatedAt?: string;
}

export interface QueryableEvidence {
  readonly errorOccurrences: number;
  readonly requestMetricBuckets: number;
  readonly performanceMetricBuckets: number;
  readonly latestProcessedAt?: string;
}

export interface ActionTarget {
  readonly routeId: RouteTargetId;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface DiagnosisData {
  readonly summary: SectionResult<DiagnosisSummary>;
  readonly stages: SectionResult<StageFacts>;
  readonly recent: SectionResult<RecentEvidence>;
  readonly rejection: SectionResult<Record<string, never>>;
  readonly credential: SectionResult<CredentialSafeStatus>;
  readonly queryable: SectionResult<QueryableEvidence>;
  readonly actionTargets: readonly ActionTarget[];
}

export interface SummaryDisplay {
  readonly label: string;
  readonly causeLabel: string | null;
  readonly tone: 'neutral' | 'success' | 'danger' | 'warning';
}

const STATUS_DISPLAY: Readonly<Record<DiagnosisStatus, SummaryDisplay>> = {
  receiving: { label: '正在接收', causeLabel: null, tone: 'success' },
  processing: { label: '处理中', causeLabel: null, tone: 'warning' },
  blocked: { label: '接收受阻', causeLabel: null, tone: 'danger' },
  not_receiving: { label: '未接收', causeLabel: null, tone: 'warning' },
  unknown: { label: '状态未知', causeLabel: null, tone: 'neutral' },
};

const CAUSE_DISPLAY: Readonly<Record<DiagnosisCause, string>> = {
  credential_inactive: '客户端上报密钥全部非激活',
  no_credential: '尚未创建客户端上报密钥',
  no_received_events: '最近窗口内未收到事件',
  processing_backlog: '存在处理积压',
};

/** Map the server-composed summary to display text/tone (no business re-derivation). */
export function summaryDisplay(summary: DiagnosisSummary): SummaryDisplay {
  const base = STATUS_DISPLAY[summary.status];
  return {
    label: base.label,
    tone: base.tone,
    causeLabel: summary.primaryCause === undefined ? null : CAUSE_DISPLAY[summary.primaryCause],
  };
}

/** Resolve an authorized action target to a navigable path, or null when the target is not real. */
export function actionTargetHref(target: ActionTarget): string | null {
  const resolved = resolveRouteTarget({
    routeId: target.routeId,
    pathParams: target.pathParams,
    query: target.query,
  });
  return resolved.path ?? null;
}

/** Readable navigation copy for an already-authorized action target. */
export function actionTargetLabel(routeId: RouteTargetId): string {
  switch (routeId) {
    case 'project.onboarding':
      return '查看接入指引';
    case 'project.overview':
      return '查看项目概览';
    case 'project.issues':
      return '查看问题列表';
    case 'project.requests':
      return '查看请求证据';
    case 'project.performance':
      return '查看性能证据';
    case 'project.data-status':
      return '打开数据诊断';
    case 'project.client-keys':
      return '管理客户端密钥';
    default:
      return '查看获授权目标';
  }
}
