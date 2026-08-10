import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Additive migration adding the DAT-12 fingerprint/group-key columns to
 * `error_event_occurrences`. Never modifies the existing columns, the
 * `(project_id, event_id)` unique key, or the category/body CHECKs. The store
 * always populates `fingerprint`/`fingerprint_version` (computed by the error
 * processor or internally as a legacy-caller fallback), so both columns are
 * NOT NULL.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('error_event_occurrences', {
    fingerprint: { type: 'varchar(1024)', notNull: true },
    fingerprint_version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.createIndex('error_event_occurrences', ['project_id', 'fingerprint']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('error_event_occurrences', ['project_id', 'fingerprint']);
  pgm.dropColumn('error_event_occurrences', ['fingerprint', 'fingerprint_version']);
};
