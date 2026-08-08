import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  // New processing generation marker on the Inbox row. Starts at 0; each
  // successful manual replay increments it. Non-negative.
  pgm.addColumn('event_inbox', {
    replay_generation: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('event_inbox', 'ck_event_inbox_replay_generation', {
    check: 'replay_generation >= 0',
  });

  // Minimal operation record for manual replays. Inbox operational evidence,
  // not a full platform audit log: no EventEnvelope, no credentials, no free
  // text, no user/admin foreign keys. Lifecycle follows Inbox retention.
  pgm.createTable('event_inbox_replay_operations', {
    operation_id: { type: 'varchar(128)', notNull: true },
    project_id: { type: 'uuid', notNull: true },
    inbox_id: { type: 'bigint', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    replay_generation: { type: 'integer', notNull: true },
    previous_attempt_count: { type: 'integer', notNull: true },
    previous_error_code: { type: 'varchar(64)' },
    requested_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('event_inbox_replay_operations', 'uq_replay_operations_operation_id', {
    unique: ['operation_id'],
  });
  pgm.addConstraint('event_inbox_replay_operations', 'ck_replay_operations_generation', {
    check: 'replay_generation > 0',
  });
  pgm.addConstraint('event_inbox_replay_operations', 'ck_replay_operations_attempt_count', {
    check: 'previous_attempt_count >= 0',
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('event_inbox_replay_operations');
  pgm.dropConstraint('event_inbox', 'ck_event_inbox_replay_generation');
  pgm.dropColumn('event_inbox', 'replay_generation');
};
