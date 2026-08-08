import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Appended migration creating the performance aggregate and bounded sample
 * store: a UTC one-minute aggregate bucket table, a minimal event-application
 * idempotency registry, and a bounded safe diagnostic sample table. The tables
 * are additive and never modify the ingestion Inbox schema, error/request
 * processing-store tables, or the performance event protocol.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('performance_metric_buckets', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    bucket_start: { type: 'timestamptz', notNull: true },
    metric_name: { type: 'varchar(64)', notNull: true },
    unit: { type: 'varchar(16)', notNull: true },
    observed_count: { type: 'bigint', notNull: true, default: 0 },
    value_sum: { type: 'numeric', notNull: true, default: 0 },
    value_max: { type: 'numeric', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('performance_metric_buckets', 'uq_performance_metric_buckets_key', {
    unique: ['project_id', 'bucket_start', 'metric_name', 'unit'],
  });
  pgm.addConstraint('performance_metric_buckets', 'ck_performance_metric_buckets_counts', {
    check: 'observed_count >= 0 AND value_sum >= 0 AND value_max >= 0 AND value_max <= value_sum',
  });

  pgm.createTable('performance_metric_event_applications', {
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'performance_metric_event_applications',
    'pk_performance_metric_event_applications',
    { primaryKey: ['project_id', 'event_id'] },
  );

  pgm.createTable('performance_event_samples', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    sample_body: { type: 'jsonb', notNull: true },
  });
  pgm.addConstraint('performance_event_samples', 'uq_performance_event_samples_event', {
    unique: ['project_id', 'event_id'],
  });
  pgm.addConstraint('performance_event_samples', 'ck_performance_event_samples_body', {
    check: "jsonb_typeof(sample_body) = 'object'",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('performance_event_samples');
  pgm.dropTable('performance_metric_event_applications');
  pgm.dropTable('performance_metric_buckets');
};
