import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('event_inbox', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    event_type: { type: 'varchar(64)', notNull: true },
    protocol_version: { type: 'integer', notNull: true },
    envelope: { type: 'jsonb', notNull: true },
    request_id: { type: 'varchar(256)' },
    batch_id: { type: 'varchar(256)' },
    batch_index: { type: 'integer' },
    received_at: { type: 'timestamptz', notNull: true },
    state: { type: 'varchar(24)', notNull: true, default: 'pending' },
    available_at: { type: 'timestamptz', notNull: true },
    lease_owner: { type: 'varchar(256)' },
    lease_expires_at: { type: 'timestamptz' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    processed_at: { type: 'timestamptz' },
    dead_lettered_at: { type: 'timestamptz' },
    last_error_code: { type: 'varchar(64)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('event_inbox', 'uq_event_inbox_project_event', {
    unique: ['project_id', 'event_id'],
  });
  pgm.addConstraint('event_inbox', 'ck_event_inbox_state', {
    check: "state IN ('pending','leased','retry_waiting','processed','dead_lettered')",
  });
  pgm.addConstraint('event_inbox', 'ck_event_inbox_attempt_count', {
    check: 'attempt_count >= 0',
  });
  pgm.createIndex('event_inbox', ['state', 'available_at']);
  pgm.createIndex('event_inbox', ['received_at']);
  pgm.createIndex('event_inbox', ['lease_expires_at']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('event_inbox');
};
