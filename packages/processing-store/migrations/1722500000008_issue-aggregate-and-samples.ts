import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Additive migration creating the Issue aggregate data model (accepted ADR-033
 * decision details 3/5/5b). `issues` is the project-scoped aggregate keyed by
 * `(project_id, fingerprint, fingerprint_version)`; `issue_event_applications`
 * is the durable `(project_id, event_id)` event-application registry that keeps
 * `occurrence_count` idempotent under Worker retry / manual replay;
 * `issue_samples` holds the bounded safe representative samples. Child tables
 * use `ON DELETE NO ACTION` FKs: activity/notes immutability (DAT-14) and
 * project-scoped deletion semantics (SEC-02) require issues to be retained.
 * `issue_activities`/`issue_notes` are implemented by DAT-14, not here.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('issues', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    fingerprint: { type: 'varchar(1024)', notNull: true },
    fingerprint_version: { type: 'integer', notNull: true },
    category: { type: 'varchar(64)', notNull: true },
    normalized_title: { type: 'varchar', notNull: true },
    first_seen_at: { type: 'timestamptz', notNull: true },
    last_seen_at: { type: 'timestamptz', notNull: true },
    occurrence_count: { type: 'bigint', notNull: true, default: 1 },
    sample_count: { type: 'integer', notNull: true, default: 0 },
    version: { type: 'integer', notNull: true, default: 1 },
    status: { type: 'varchar(16)', notNull: true, default: 'open' },
    assignee_account_id: { type: 'uuid' },
    priority: { type: 'varchar(16)' },
    resolved_at: { type: 'timestamptz' },
    resolved_version: { type: 'varchar' },
    resolved_reason: { type: 'varchar(16)' },
    ignored_until: { type: 'timestamptz' },
    merged_into_issue_id: { type: 'bigint' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('issues', 'uq_issues_project_fingerprint_version', {
    unique: ['project_id', 'fingerprint', 'fingerprint_version'],
  });
  pgm.addConstraint('issues', 'ck_issues_category', {
    check: "category IN ('javascript', 'unhandled_rejection', 'resource')",
  });
  pgm.addConstraint('issues', 'ck_issues_status', {
    check: "status IN ('open', 'in_progress', 'resolved', 'ignored')",
  });
  pgm.addConstraint('issues', 'ck_issues_priority', {
    check: "priority IS NULL OR priority IN ('urgent', 'high', 'medium', 'low')",
  });
  pgm.addConstraint('issues', 'ck_issues_resolved_reason', {
    check: "resolved_reason IS NULL OR resolved_reason IN ('by_version', 'by_time')",
  });
  pgm.addConstraint('issues', 'ck_issues_occurrence_count', {
    check: 'occurrence_count >= 1',
  });
  pgm.addConstraint('issues', 'ck_issues_sample_count', {
    check: 'sample_count >= 0 AND sample_count <= occurrence_count',
  });
  pgm.createIndex('issues', ['project_id', 'status', 'last_seen_at']);

  pgm.createTable('issue_event_applications', {
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    issue_id: { type: 'bigint', notNull: true, references: 'issues' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('issue_event_applications', 'pk_issue_event_applications', {
    primaryKey: ['project_id', 'event_id'],
  });

  pgm.createTable('issue_samples', {
    id: { type: 'bigserial', primaryKey: true },
    issue_id: { type: 'bigint', notNull: true, references: 'issues' },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    sample_body: { type: 'jsonb', notNull: true },
    sample_kind: { type: 'varchar(32)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('issue_samples', 'uq_issue_samples_project_event', {
    unique: ['project_id', 'event_id'],
  });
  pgm.addConstraint('issue_samples', 'ck_issue_samples_body_object', {
    check: "jsonb_typeof(sample_body) = 'object'",
  });
  pgm.addConstraint('issue_samples', 'ck_issue_samples_kind', {
    check:
      "sample_kind IN ('first','latest','reappeared','unique_environment','unique_release','unique_browser','unique_page','higher_severity','regular')",
  });
  pgm.createIndex('issue_samples', ['issue_id', 'occurred_at']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('issue_samples');
  pgm.dropTable('issue_event_applications');
  pgm.dropTable('issues');
};
