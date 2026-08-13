import { arr, enum_, num, obj, optional, str } from '../common/schema.js';
import { NotificationId, OrganizationId, ProjectId } from '../common/identifiers.js';
import { routeTarget } from '../common/navigation.js';
import { paginationMeta } from '../common/pagination.js';
import { utcTimestamp } from '../common/time.js';
import { queryResponse } from '../common/query.js';

export const OPERATION_ID_NOTIFICATIONS_LIST = 'notificationsListAndUnread' as const;
export const OPERATION_ID_NOTIFICATIONS_MARK_READ = 'notificationsMarkRead' as const;

/** PRD §11.4 notification types implemented in the first increment. */
const notificationType = enum_([
  'alert_triggered',
  'alert_recovered',
  'new_issue',
  'issue_reappeared',
  'issue_assigned_to_me',
]);

const notificationItem = obj({
  notificationId: NotificationId,
  type: notificationType,
  title: str(1, 256),
  summary: optional(str(1, 1024)),
  organizationId: optional(OrganizationId),
  projectId: optional(ProjectId),
  occurredAt: utcTimestamp,
  readAt: optional(utcTimestamp),
  target: routeTarget,
});

const notificationsSection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  items: arr(notificationItem, 0, 50),
  pagination: paginationMeta,
});

/** Account-level unread count; `unavailable` when the count cannot be trusted. */
const unreadCountSection = obj({
  value: optional(num(0)),
  status: enum_(['available', 'unavailable']),
});

export const notificationsListAndUnreadQuery = obj({
  /** 'all' | 'unread'; absent means all. */
  readState: optional(str(1, 16)),
  cursor: optional(str(1, 512)),
  limit: optional(num(1, 50)),
});

export const notificationsListAndUnreadResponse = queryResponse(
  obj({
    notifications: notificationsSection,
    unreadCount: unreadCountSection,
  }),
);

export const notificationsMarkReadPathParams = obj({
  notificationId: NotificationId,
});

export const notificationsMarkReadBody = obj({
  idempotencyKey: str(8, 128),
});

export const notificationsMarkReadResponse = obj({
  data: obj({
    status: enum_(['read']),
    notificationId: NotificationId,
  }),
});
