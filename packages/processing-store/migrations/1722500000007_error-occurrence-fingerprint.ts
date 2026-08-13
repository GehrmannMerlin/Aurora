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
 * The 2026-08-13 v1 single-host deploy first encountered a populated
 * `error_event_occurrences` (a previous preview run persisted one event), so
 * the column is added nullable, backfilled deterministically from
 * `normalized_body`, then set NOT NULL (DAT-12 leaf review N1). The backfill
 * yields a format-compatible fingerprint `v1|{type}|:legacy|{message≤512}` for
 * pre-existing rows; it is intentionally a simplified projection (no
 * high-confidence dynamic-value normalization, no stack key-frame) because the
 * full algorithm is a pure TS function. New rows are always fingerprinted by
 * `computeErrorFingerprint`, so the `:legacy` marker only ever labels rows
 * persisted before this migration ran. On a fresh database the backfill is a
 * no-op (zero rows) and the column ends up NOT NULL as originally designed.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('error_event_occurrences', {
    fingerprint: { type: 'varchar(1024)' },
    fingerprint_version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.sql(`
    UPDATE error_event_occurrences
    SET fingerprint = LEFT(
      'v1|'
        || CASE error_category
             WHEN 'javascript' THEN COALESCE(normalized_body->'error'->>'name', 'js_error')
             WHEN 'unhandled_rejection' THEN COALESCE(normalized_body->'reason'->'error'->>'name', 'rejection_error')
             WHEN 'resource' THEN COALESCE(normalized_body->'resource'->>'type', 'resource')
             ELSE 'unknown'
           END
        || '|:legacy|'
        || LEFT(
             CASE error_category
               WHEN 'javascript' THEN COALESCE(normalized_body->'error'->>'message', '')
               WHEN 'unhandled_rejection' THEN COALESCE(normalized_body->'reason'->'error'->>'message', COALESCE(normalized_body->'reason'->>'value', ''))
               WHEN 'resource' THEN COALESCE(normalized_body->'resource'->>'url', '')
               ELSE ''
             END,
             512
           ),
      1024
    )
    WHERE fingerprint IS NULL;
  `);
  pgm.alterColumn('error_event_occurrences', 'fingerprint', {
    type: 'varchar(1024)',
    notNull: true,
  });
  pgm.createIndex('error_event_occurrences', ['project_id', 'fingerprint']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('error_event_occurrences', ['project_id', 'fingerprint']);
  pgm.dropColumn('error_event_occurrences', ['fingerprint', 'fingerprint_version']);
};
