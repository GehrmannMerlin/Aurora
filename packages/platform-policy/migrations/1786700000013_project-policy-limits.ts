import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-10b platform-policy data layer migration 3: `project_policy_limits`.
 *
 * Optional per-project resource limit override (ADR-035 scheme A). One row per
 * project at most; no row means the project inherits the effective
 * organization policy. Carries ONLY `resource_limit` (numeric, events, CHECK > 0)
 * — the remaining protective fields (warning ratio / hard limit / degradation /
 * retention) inherit from the organization effective policy by design.
 *
 * - `project_id` uuid PK references `projects`.
 * - `version` int NOT NULL DEFAULT 1.
 * - `resource_limit` numeric NOT NULL CHECK (resource_limit > 0).
 * - `policy_source` CHECK IN ('system_default','platform_admin').
 * - `created_at`/`updated_at` default now(); `updated_by` FK → accounts.
 *
 * Up/down fully reversible.
 */
export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('project_policy_limits', {
    project_id: { type: 'uuid', primaryKey: true, references: 'projects' },
    version: { type: 'int', notNull: true, default: 1 },
    resource_limit: { type: 'numeric', notNull: true, check: 'resource_limit > 0' },
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
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('project_policy_limits');
};
