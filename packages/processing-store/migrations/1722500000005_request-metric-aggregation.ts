import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Appended migration creating the request metric aggregate store: a UTC
 * one-minute aggregation bucket table and a minimal event-application
 * idempotency registry. The tables are additive and never modify the ingestion
 * Inbox schema, error_event_occurrences, or request_event_samples.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('request_metric_buckets', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    bucket_start: { type: 'timestamptz', notNull: true },
    method: { type: 'varchar(16)', notNull: true },
    outcome: { type: 'varchar(32)', notNull: true },
    status_code: { type: 'integer', notNull: true },
    observed_count: { type: 'bigint', notNull: true, default: 0 },
    failure_count: { type: 'bigint', notNull: true, default: 0 },
    slow_count: { type: 'bigint', notNull: true, default: 0 },
    duration_sum_ms: { type: 'numeric', notNull: true, default: 0 },
    duration_max_ms: { type: 'numeric', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // status_code uses a 0 sentinel for "no status code" so the bucket composite
  // key is never NULL (PostgreSQL treats NULLs as distinct in unique indexes).
  pgm.addConstraint('request_metric_buckets', 'uq_request_metric_buckets_key', {
    unique: ['project_id', 'bucket_start', 'method', 'outcome', 'status_code'],
  });
  pgm.addConstraint('request_metric_buckets', 'ck_request_metric_buckets_status_code', {
    check: 'status_code BETWEEN 0 AND 599',
  });
  pgm.addConstraint('request_metric_buckets', 'ck_request_metric_buckets_counts', {
    check: 'observed_count >= 0 AND failure_count >= 0 AND failure_count <= observed_count AND slow_count >= 0 AND slow_count <= observed_count',
  });
  pgm.addConstraint('request_metric_buckets', 'ck_request_metric_buckets_duration', {
    check: 'duration_sum_ms >= 0 AND duration_max_ms >= 0 AND duration_max_ms <= duration_sum_ms',
  });

  pgm.createTable('request_metric_event_applications', {
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'request_metric_event_applications',
    'pk_request_metric_event_applications',
    { primaryKey: ['project_id', 'event_id'] },
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('request_metric_event_applications');
  pgm.dropTable('request_metric_buckets');
};
