import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Appended migration creating the request event safe sample processing store.
 * A sample is a bounded diagnostic projection, NOT a complete request
 * occurrence history. The table is additive: it never modifies the ingestion
 * Inbox schema or the error_event_occurrences table.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('request_event_samples', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    protocol_version: { type: 'integer', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    sample_body: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('request_event_samples', 'uq_request_event_samples_project_event', {
    unique: ['project_id', 'event_id'],
  });
  // sample_body must be a JSON object (never a full envelope, array, or scalar).
  pgm.addConstraint('request_event_samples', 'ck_request_event_samples_sample_body_object', {
    check: "jsonb_typeof(sample_body) = 'object'",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('request_event_samples');
};
