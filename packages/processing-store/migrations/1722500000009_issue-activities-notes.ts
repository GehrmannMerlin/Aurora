import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Additive migration creating the Issue lifecycle evidence tables (accepted
 * ADR-033 decision details 5c/5d, implemented by DAT-14). `issue_activities` is
 * the immutable system activity timeline (PRD §10.6: not editable/deletable);
 * `issue_notes` are member notes with soft-delete (author or admin-sensitive).
 * Both use `ON DELETE NO ACTION`: activity/note immutability means the Issue row
 * must be retained while its evidence exists (SEC-02 defines deletion semantics).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('issue_activities', {
    id: { type: 'bigserial', primaryKey: true },
    issue_id: { type: 'bigint', notNull: true, references: 'issues' },
    project_id: { type: 'uuid', notNull: true },
    actor_account_id: { type: 'uuid' },
    activity_type: { type: 'varchar(32)', notNull: true },
    details: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('issue_activities', 'ck_issue_activities_type', {
    check:
      "activity_type IN ('status_changed','assignee_changed','priority_changed','marked_resolved','reappeared','ignored','reopened','merged','note_added','note_deleted')",
  });
  pgm.addConstraint('issue_activities', 'ck_issue_activities_details_object', {
    check: "jsonb_typeof(details) = 'object'",
  });
  pgm.createIndex('issue_activities', ['issue_id', 'created_at']);

  pgm.createTable('issue_notes', {
    id: { type: 'bigserial', primaryKey: true },
    issue_id: { type: 'bigint', notNull: true, references: 'issues' },
    project_id: { type: 'uuid', notNull: true },
    author_account_id: { type: 'uuid', notNull: true },
    content: { type: 'varchar', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
    deleted_by_account_id: { type: 'uuid' },
  });
  pgm.createIndex('issue_notes', ['issue_id', 'created_at']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('issue_notes');
  pgm.dropTable('issue_activities');
};
