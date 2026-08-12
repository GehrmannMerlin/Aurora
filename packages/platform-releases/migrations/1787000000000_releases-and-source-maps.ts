import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * DAT-18 Release / Source Map data model (PRD §8, accepted implementation-detail;
 * object storage direction frozen by accepted ADR-032).
 *
 * `releases` is the project release identity (unique per version string; v1
 * created by an authorized source-map upload). `source_map_files` holds the
 * current effective map metadata per (release, normalized build path) — the
 * strict match key. Source Map content lives behind the private
 * `SourceMapObjectStoragePort`, never in this table. `source_map_reparse_tasks`
 * bounds the background reparse work (one active task per file at a time).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('releases', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    version: { type: 'varchar(256)', notNull: true },
    source: { type: 'varchar(32)', notNull: true, default: 'source_map_upload' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('releases', 'uq_releases_project_version', {
    unique: ['project_id', 'version'],
  });
  pgm.addConstraint('releases', 'ck_releases_source', {
    check: "source IN ('source_map_upload')",
  });
  pgm.createIndex('releases', ['project_id', 'created_at']);

  pgm.createTable('source_map_files', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    release_id: { type: 'bigint', notNull: true, references: 'releases' },
    build_path: { type: 'varchar(2048)', notNull: true },
    object_key: { type: 'varchar(512)', notNull: true },
    digest: { type: 'varchar(64)', notNull: true },
    build_id: { type: 'varchar(128)' },
    status: { type: 'varchar(16)', notNull: true, default: 'active' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    replaced_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('source_map_files', 'uq_source_map_files_release_build_path', {
    unique: ['release_id', 'build_path'],
  });
  pgm.addConstraint('source_map_files', 'ck_source_map_files_status', {
    check: "status IN ('active', 'replaced')",
  });
  pgm.addConstraint('source_map_files', 'ck_source_map_files_digest', {
    check: 'digest ~ \'^[0-9a-f]{64}$\'',
  });
  pgm.createIndex('source_map_files', ['project_id', 'release_id']);

  pgm.createTable('source_map_reparse_tasks', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    release_id: { type: 'bigint', notNull: true, references: 'releases' },
    source_map_file_id: { type: 'bigint', notNull: true, references: 'source_map_files' },
    status: { type: 'varchar(16)', notNull: true, default: 'queued' },
    target_count: { type: 'integer' },
    processed_count: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('source_map_reparse_tasks', 'ck_source_map_reparse_tasks_status', {
    check: "status IN ('queued', 'processing', 'completed', 'failed')",
  });
  pgm.addConstraint('source_map_reparse_tasks', 'ck_source_map_reparse_tasks_counts', {
    check: 'processed_count >= 0 AND (target_count IS NULL OR target_count >= 0)',
  });
  pgm.createIndex('source_map_reparse_tasks', ['release_id', 'source_map_file_id'], {
    name: 'uq_source_map_reparse_tasks_active',
    unique: true,
    where: "status IN ('queued', 'processing')",
  });
  pgm.createIndex('source_map_reparse_tasks', ['status', 'created_at']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('source_map_reparse_tasks');
  pgm.dropTable('source_map_files');
  pgm.dropTable('releases');
};
