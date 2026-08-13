import type { Pool, PoolClient } from 'pg';
import { ProcessingStoreError } from './errors.js';
import { persistNotification } from './notification-repository.js';

/**
 * PLT-09 trigger-side notification wiring (PRD §11.4 / UX/UI §8.30). The three
 * trigger sources (alert round, issue contribution, assignee command) append
 * account-scoped in-app notifications without changing their business outcome.
 *
 * Recipient resolution lives here because both triggering workers already
 * depend on `@aurora/processing-store` (the plan reuses existing packages; no
 * new package is introduced). The queries are plain SQL over the shared schema
 * (`projects` / `organization_members` / `project_members`) and never import a
 * peer data package.
 */

export interface ProjectNotificationContext {
  readonly organizationId: string;
  /** org managers (owner/admin) + explicit `project_admin` members. */
  readonly adminAccountIds: readonly string[];
}

const PROJECT_CONTEXT_SQL = `
  SELECT
    (SELECT organization_id FROM projects WHERE project_id = $1) AS organization_id,
    COALESCE(
      (SELECT json_agg(account_id) FROM (
        SELECT om.account_id FROM organization_members om
          JOIN projects p ON p.organization_id = om.organization_id
          WHERE p.project_id = $1 AND om.role IN ('owner','admin')
        UNION
        SELECT pm.account_id FROM project_members pm
          WHERE pm.project_id = $1 AND pm.role = 'project_admin'
      ) admins),
      '[]'
    ) AS admin_account_ids
`;

/**
 * Resolve the notification context (organization id + project-admin recipients)
 * for a project, or null when the project does not exist.
 */
export async function resolveProjectNotificationContext(
  pool: Pool | PoolClient,
  input: { readonly projectId: string },
): Promise<ProjectNotificationContext | null> {
  try {
    const result = await pool.query<{ organization_id: string | null; admin_account_ids: unknown }>(
      PROJECT_CONTEXT_SQL,
      [input.projectId],
    );
    const row = result.rows[0];
    if (row?.organization_id == null) return null;
    const adminAccountIds = Array.isArray(row.admin_account_ids)
      ? row.admin_account_ids.filter(
          (value: unknown): value is string => typeof value === 'string',
        )
      : [];
    return { organizationId: row.organization_id, adminAccountIds };
  } catch (error) {
    if (error instanceof ProcessingStoreError) throw error;
    throw new ProcessingStoreError('statement_failed', 'notification context query failed');
  }
}

/** Instance-level alert notification decision returned by the evaluation round. */
export interface AlertRoundNotification {
  readonly type: 'alert_triggered' | 'alert_recovered';
  readonly projectId: string;
  readonly instanceId: string;
  readonly ruleName: string;
  readonly recipientAccountIds: readonly string[];
}

/**
 * Append in-app notifications for the alert decisions emitted by an evaluation
 * round. Each recipient of a notified rule gets one account-scoped row
 * (`(account_id, business_key, type)` deduplicates); the target is the
 * constrained `project.alert-instance-detail` Route Target. Append-only: the
 * evaluation outcome is unchanged.
 */
export async function persistAlertRoundNotifications(
  pool: Pool,
  input: { readonly notifications: readonly AlertRoundNotification[] },
): Promise<void> {
  for (const decision of input.notifications) {
    const context = await resolveProjectNotificationContext(pool, {
      projectId: decision.projectId,
    });
    if (context === null) continue;
    const title = `${decision.ruleName} ${decision.type === 'alert_recovered' ? '已恢复' : '已触发'}`;
    for (const accountId of decision.recipientAccountIds) {
      await persistNotification(pool, {
        accountId,
        type: decision.type,
        businessKey: `alert:${decision.instanceId}`,
        organizationId: context.organizationId,
        projectId: decision.projectId,
        title,
        target: {
          routeId: 'project.alert-instance-detail',
          pathParams: {
            organizationId: context.organizationId,
            projectId: decision.projectId,
            instanceId: decision.instanceId,
          },
          query: {},
        },
      });
    }
  }
}

export interface IssueNotificationSenderInput {
  readonly projectId: string;
  readonly issueId: string;
  readonly kind: 'new_issue' | 'issue_reappeared';
}

export type IssueNotificationSender = (input: IssueNotificationSenderInput) => Promise<void>;

/**
 * Build the PLT-09 issue trigger sender: for every project admin (org managers
 * + `project_admin` members) append one `new_issue` / `issue_reappeared`
 * notification targeting `project.issue-detail`. Append-only; injected into the
 * ingestion error processor as a port so the processor stays DB-free.
 */
export function createIssueNotificationSender(pool: Pool): IssueNotificationSender {
  return async (input) => {
    const context = await resolveProjectNotificationContext(pool, {
      projectId: input.projectId,
    });
    if (context === null) return;
    const type = input.kind === 'new_issue' ? 'new_issue' : 'issue_reappeared';
    const title = input.kind === 'new_issue' ? '新问题出现' : '问题再次出现';
    for (const accountId of context.adminAccountIds) {
      await persistNotification(pool, {
        accountId,
        type,
        businessKey: `issue:${input.issueId}`,
        organizationId: context.organizationId,
        projectId: input.projectId,
        title,
        target: {
          routeId: 'project.issue-detail',
          pathParams: {
            organizationId: context.organizationId,
            projectId: input.projectId,
            issueId: input.issueId,
          },
          query: {},
        },
      });
    }
  };
}
