import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-10b platform-policy data layer migration 1: `platform_resource_policies`.
 *
 * The platform default protective resource policy (ADR-035 minimal three-tier
 * scheme A). Holds at most one row (the platform default), versioned for
 * optimistic concurrency. The "single row" invariant is enforced at the DB
 * level by the partial unique index `platform_resource_policies_singleton`
 * (on constant `true`), so a concurrent second INSERT fails with 23505 and the
 * repository maps it to a fail-closed `temporarily_unavailable` result (or
 * `already_exists` for the idempotent bootstrap).
 *
 * - `id` uuid PK (gen_random_uuid()).
 * - `version` int NOT NULL DEFAULT 1: optimistic concurrency guard.
 * - Six PRD §15.8 config fields: `default_period_quota` (numeric, events),
 *   `warning_ratio`/`hard_limit` (numeric 0-100 with ratio CHECK below),
 *   `degradation_enabled` (boolean), `high_value_retention_days` (int, days).
 * - `policy_source` CHECK IN ('system_default','platform_admin').
 * - `created_at`/`updated_at` default now(); `updated_by` FK → accounts
 *   (platform admin who last saved the policy, nullable until first save).
 *
 * Up/down fully reversible.
 */
export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_resource_policies', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    version: { type: 'int', notNull: true, default: 1 },
    default_period_quota: { type: 'numeric', notNull: true },
    warning_ratio: { type: 'numeric', notNull: true },
    hard_limit: { type: 'numeric', notNull: true },
    degradation_enabled: { type: 'boolean', notNull: true },
    high_value_retention_days: { type: 'int', notNull: true },
    policy_source: {
      type: 'varchar(24)',
      notNull: true,
      default: 'system_default',
      check: "policy_source IN ('system_default','platform_admin')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'accounts' },
  });
  pgm.addConstraint('platform_resource_policies', 'ck_policy_ratio_order', {
    check: 'warning_ratio > 0 AND warning_ratio < hard_limit AND hard_limit <= 100',
  });
  // DB-level singleton: the table holds at most ONE row. A partial unique index
  // on the constant `true` means any second INSERT fails with SQLSTATE 23505
  // regardless of concurrent transactions, closing the empty-table bootstrap /
  // set race that a uuid PK alone cannot.
  pgm.sql(
    'CREATE UNIQUE INDEX platform_resource_policies_singleton ON platform_resource_policies ((true))',
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql('DROP INDEX IF EXISTS platform_resource_policies_singleton');
  pgm.dropTable('platform_resource_policies');
};
