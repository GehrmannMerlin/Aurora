/**
 * PLT-09 in-app notification types (PRD §11.4). First increment implements the
 * four triggered sources (alert, new issue/reappearance, assignment). The
 * ingestion-anomaly / quota-exhausted triggers are deferred (no event source).
 */

export const NOTIFICATION_TYPES = [
  'alert_triggered',
  'alert_recovered',
  'new_issue',
  'issue_reappeared',
  'issue_assigned_to_me',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A constrained navigation target (Route Target), never an arbitrary URL. */
export interface NotificationTarget {
  readonly routeId: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface NotificationRow {
  readonly notificationId: string;
  readonly accountId: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly type: NotificationType;
  readonly title: string;
  readonly summary: string | null;
  readonly target: NotificationTarget;
  readonly readAt: string | null;
  readonly occurredAt: string;
}
