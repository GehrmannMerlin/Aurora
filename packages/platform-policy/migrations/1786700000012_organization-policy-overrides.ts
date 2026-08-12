import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-10b platform-policy data layer migration 2: `organization_policy_overrides`.
 *
 * Per-organization full override of the platform default policy (ADR-035 scheme
 * A). One row per organization with an override; no row means the organization
 * inherits the platform default. `organization_id` is the PK + FK → organizations,
 * versioned for optimistic concurrency. Carries the same six PRD §15.8 config
 * fields as the platform default plus the same ratio CHECK.
 *
 * - `organization_id` uuid PK references `organizations`.
 * - `version` int NOT NULL DEFAULT 1.
 * - Five config fields (same as platform default; `resource_limit` is NOT
 *   carried here — project-level limits live in `project_policy_limits`).
 * - `policy_source` CHECK IN ('system_default','platform_admin').
 * - `created_at`/`updated_at` default now(); `updated_by` FK → accounts.
 *
 * Up/down fully reversible.
 */
export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('organization_policy_overrides', {
    organization_id: { type: 'uuid', primaryKey: true, references: 'organizations' },
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
  pgm.addConstraint('organization_policy_overrides', 'ck_policy_ratio_order', {
    check: 'warning_ratio > 0 AND warning_ratio < hard_limit AND hard_limit <= 100',
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('organization_policy_overrides');
};
