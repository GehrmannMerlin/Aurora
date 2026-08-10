/**
 * C4 Issue 详情（`project.issue-detail`）view-model（PLT-06）。
 *
 * 把 `issuesGetIssueDetail` 的 issue/samples/activity 三区（各自带 status/reason，
 * 且载荷键不同：`data`/`items`/`activities`+`notes`）规范化为统一渲染状态；
 * Command 成功/冲突/403 由视图处理，本模块只做纯转换与只读事实抽取，不做业务
 * 状态重算。
 */
import type {
  IssueActivityEntry,
  IssueDetail,
  IssueNoteProjection,
  IssueSampleProjection,
} from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

export interface DetailActivity {
  readonly activities: readonly IssueActivityEntry[];
  readonly notes: readonly IssueNoteProjection[];
}

export interface IssueDetailViewState {
  readonly issue: SectionView<IssueDetail>;
  readonly samples: SectionView<readonly IssueSampleProjection[]>;
  readonly activity: SectionView<DetailActivity>;
}

function unavailable(reason: string): { readonly kind: 'unavailable'; readonly reason: string } {
  return { kind: 'unavailable', reason };
}

/** `issue` section payload lives under `data`. */
function issueToView(
  section: {
    readonly status: string;
    readonly reason?: string;
    readonly data?: IssueDetail;
  } | null,
): SectionView<IssueDetail> {
  if (section === null) return unavailable('详情数据源未返回结果');
  if (section.status === 'available') {
    return section.data === undefined
      ? unavailable('详情数据缺失')
      : { kind: 'available', data: section.data };
  }
  if (section.status === 'empty') return { kind: 'empty', reason: section.reason ?? '无数据' };
  return unavailable(section.reason ?? '详情数据不可用');
}

/** `samples` section payload lives under `items`. */
function samplesToView(
  section: {
    readonly status: string;
    readonly reason?: string;
    readonly items?: readonly IssueSampleProjection[];
  } | null,
): SectionView<readonly IssueSampleProjection[]> {
  if (section === null) return unavailable('样本数据源未返回结果');
  if (section.status === 'available') {
    return section.items === undefined
      ? unavailable('样本数据缺失')
      : { kind: 'available', data: section.items };
  }
  if (section.status === 'empty') return { kind: 'empty', reason: section.reason ?? '无样本' };
  return unavailable(section.reason ?? '样本数据不可用');
}

/** `activity` section payload lives under `activities` + `notes`. */
function activityToView(
  section: {
    readonly status: string;
    readonly reason?: string;
    readonly activities?: readonly IssueActivityEntry[];
    readonly notes?: readonly IssueNoteProjection[];
  } | null,
): SectionView<DetailActivity> {
  if (section === null) return unavailable('活动数据源未返回结果');
  if (section.status === 'available') {
    return section.activities === undefined && section.notes === undefined
      ? unavailable('活动数据缺失')
      : {
          kind: 'available',
          data: { activities: section.activities ?? [], notes: section.notes ?? [] },
        };
  }
  if (section.status === 'empty') return { kind: 'empty', reason: section.reason ?? '无活动' };
  return unavailable(section.reason ?? '活动数据不可用');
}

export function buildIssueDetailView(detail: {
  readonly issue: Parameters<typeof issueToView>[0];
  readonly samples: Parameters<typeof samplesToView>[0];
  readonly activity: Parameters<typeof activityToView>[0];
}): IssueDetailViewState {
  return {
    issue: issueToView(detail.issue),
    samples: samplesToView(detail.samples),
    activity: activityToView(detail.activity),
  };
}
