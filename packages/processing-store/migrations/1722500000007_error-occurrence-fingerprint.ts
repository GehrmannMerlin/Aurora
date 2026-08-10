import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Additive migration adding the DAT-12 fingerprint/group-key columns to
 * `error_event_occurrences`. Never modifies the existing columns, the
 * `(project_id, event_id)` unique key, or the category/body CHECKs. The store
 * always populates `fingerprint`/`fingerprint_version` (computed by the error
 * processor or internally as a legacy-caller fallback), so both columns are
 * NOT NULL.
 *
 * Pre-production assumption: this runs while `error_event_occurrences` is empty
 * (the error processor is not yet wired to a production composition root), so a
 * bare NOT NULL column is safe. If this migration ever runs on a populated
 * table, a backfill step (add nullable → backfill from `normalized_body` →
 * SET NOT NULL) must be added first — flagged by DAT-12 leaf review N1.
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
