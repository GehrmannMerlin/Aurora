import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * DAT-18 symbolized source positions attached to error occurrences (PRD
 * §8.3.4/§8.3.8). `(occurrence_id)` is unique — the current symbolization for
 * an occurrence. `map_version` lets a reparse triggered by a map replacement
 * re-process occurrences whose symbolization came from an older map version.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('error_occurrence_symbolizations', {
    id: { type: 'bigserial', primaryKey: true },
    occurrence_id: {
      type: 'bigint',
      notNull: true,
      unique: true,
      references: 'error_event_occurrences',
    },
    project_id: { type: 'uuid', notNull: true },
    release_id: { type: 'bigint', notNull: true },
    source_map_file_id: { type: 'bigint', notNull: true },
    map_version: { type: 'integer', notNull: true },
    original_path: { type: 'varchar(2048)', notNull: true },
    resolved_file: { type: 'varchar(1024)' },
    resolved_line: { type: 'integer' },
    resolved_column: { type: 'integer' },
    function_name: { type: 'varchar(256)' },
    status: { type: 'varchar(16)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'error_occurrence_symbolizations',
    'ck_error_occurrence_symbolizations_status',
    {
      check: "status IN ('symbolized', 'not_found', 'parse_failed')",
    },
  );
  pgm.addConstraint(
    'error_occurrence_symbolizations',
    'ck_error_occurrence_symbolizations_map_version',
    {
      check: 'map_version >= 1',
    },
  );
  pgm.createIndex('error_occurrence_symbolizations', ['project_id', 'status']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('error_occurrence_symbolizations');
};
