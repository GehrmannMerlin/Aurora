/**
 * D1 通知中心 view-model（PLT-09）。
 *
 * 只消费 `notificationsListAndUnread`（账号级查询）与服务端 `notificationsMarkRead`
 * 命令；把加载/错误/服务端 section 映射成视图可渲染的封闭状态。未读数量未知时如实
 * 呈现 `unavailable`，绝不伪造为 0。纯函数：无 fetch、无 store、无 DOM。
 */
import type { NotificationItem } from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

/** Flat section shape from the contract (`notificationsListAndUnread.data.notifications`). */
export interface NotificationsSection {
  readonly status: string;
  readonly reason?: string;
  readonly items: readonly NotificationItem[];
  readonly pagination: {
    readonly cursor?: string;
    readonly nextCursor?: string;
    readonly totalCount?: number;
    readonly totalCountStatus: string;
  };
}

export interface UnreadCountProjection {
  readonly value?: number;
  readonly status: 'available' | 'unavailable';
}

export interface NotificationsViewState {
  readonly list: SectionView<readonly NotificationItem[]>;
  readonly nextCursor?: string;
  readonly unreadCount: UnreadCountProjection;
  readonly markingRead: ReadonlySet<string>;
  readonly actionError: string | null;
}

export interface NotificationsSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly section: NotificationsSection | null;
  readonly unreadCount: UnreadCountProjection;
}

export function notificationSectionToItems(
  section: NotificationsSection,
): SectionView<readonly NotificationItem[]> {
  switch (section.status) {
    case 'empty':
      return { kind: 'empty', reason: section.reason ?? '暂无通知' };
    case 'unavailable':
      return { kind: 'unavailable', reason: section.reason ?? '通知列表不可用' };
    case 'forbidden':
      return { kind: 'forbidden' };
    default:
      return { kind: 'available', data: section.items };
  }
}

export function buildNotificationsView(
  source: NotificationsSource & {
    readonly markingRead: ReadonlySet<string>;
    readonly actionError: string | null;
  },
): NotificationsViewState {
  let list: SectionView<readonly NotificationItem[]>;
  if (source.loading) {
    list = { kind: 'loading' };
  } else if (source.error !== null) {
    list = { kind: 'error', message: source.error };
  } else if (source.section === null) {
    list = { kind: 'unavailable', reason: '通知列表不可用' };
  } else {
    list = notificationSectionToItems(source.section);
  }

  const nextCursor = source.section?.pagination.nextCursor;

  return {
    list,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    unreadCount: source.unreadCount,
    markingRead: source.markingRead,
    actionError: source.actionError,
  };
}

/** PRD §11.4 通知类型中文标签。 */
export function notificationTypeLabel(type: string): string {
  switch (type) {
    case 'alert_triggered':
      return '告警触发';
    case 'alert_recovered':
      return '告警恢复';
    case 'new_issue':
      return '新问题';
    case 'issue_reappeared':
      return '问题再次出现';
    case 'issue_assigned_to_me':
      return '分配给我';
    default:
      return type;
  }
}
