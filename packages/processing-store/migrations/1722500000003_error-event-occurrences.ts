import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Appended migration creating the error event occurrence processing store.
 * The table is additive: it never modifies the ingestion Inbox schema.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('error_event_occurrences', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    protocol_version: { type: 'integer', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    error_category: { type: 'varchar(64)', notNull: true },
    normalized_body: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('error_event_occurrences', 'uq_error_event_occurrences_project_event', {
    unique: ['project_id', 'event_id'],
  });
  // error_category must match the event-schema ErrorCategory public constants.
  pgm.addConstraint('error_event_occurrences', 'ck_error_event_occurrences_category', {
    check: "error_category IN ('javascript', 'unhandled_rejection', 'resource')",
  });
  // normalized_body must be a JSON object (never a full envelope, array, or scalar).
  pgm.addConstraint('error_event_occurrences', 'ck_error_event_occurrences_normalized_body_object', {
    check: "jsonb_typeof(normalized_body) = 'object'",
  });
  // The stored category column and the body's category must stay consistent.
  pgm.addConstraint(
    'error_event_occurrences',
    'ck_error_event_occurrences_category_matches_body',
    { check: "error_category = normalized_body->>'category'" },
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('error_event_occurrences');
};
