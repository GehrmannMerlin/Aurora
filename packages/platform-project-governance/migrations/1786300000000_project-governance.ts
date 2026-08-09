import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-04 platform-project-governance data layer migration.
 *
 * Creates the four project-governance tables from spec §4.1-§4.4 on top of the
 * PLT-03 tables (accounts/organizations, created by the platform-identity
 * migration that this migration assumes has already run):
 * - `projects`: B1/B2/B8 project lifecycle (active/archived/trash/deleting).
 * - `client_keys`: B2 default client key created atomically with the project;
 *   only the SHA-256 `key_digest` is persisted (never the raw secret), the
 *   `public_identifier` is the public `aurora_key_<base64url(8)>` value.
 * - `project_environments`: B2 default `production` environment (is_default).
 * - `project_onboarding`: B2 onboarding row (not_started / current_step 0).
 *
 * Index-ownership / boundary notes:
 * - `project_members.project_id` is a plain uuid with NO foreign key (PLT-03
 *   §4.8). This migration MUST NOT add an FK on it — the `projects` table is
 *   created here but the PLT-03 composite-PK write target stays FK-free by
 *   design (the FK is backfilled by a later PLT-04 migration).
 * - `recoverable_until` has no column default: the 7-day recovery window is a
 *   business rule applied by `trashProject` (now() + 7 days), not a schema
 *   default for active projects.
 */
export const up = (pgm: MigrationBuilder): void => {
  // 4.1 projects
  pgm.createTable('projects', {
    project_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations' },
    name: { type: 'text', notNull: true },
    framework_type: { type: 'text', notNull: true },
    website_url: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'active' },
    created_by: { type: 'uuid', notNull: true, references: 'accounts' },
    archived_at: { type: 'timestamptz' },
    trashed_at: { type: 'timestamptz' },
    recoverable_until: { type: 'timestamptz' },
    deletion_started_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('projects', 'ck_projects_framework_type', {
    check: "framework_type IN ('javascript','react','vue','other')",
  });
  pgm.addConstraint('projects', 'ck_projects_status', {
    check: "status IN ('active','archived','trash','deleting')",
  });
  // name is NOT NULL, 2-50 characters after trimming surrounding whitespace.
  pgm.addConstraint('projects', 'ck_projects_name_length', {
    check: 'char_length(btrim(name)) BETWEEN 2 AND 50',
  });

  // 4.2 client_keys
  pgm.createTable('client_keys', {
    client_key_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: { type: 'uuid', notNull: true, references: 'projects' },
    public_identifier: { type: 'text', notNull: true, unique: true },
    key_digest: { type: 'text', notNull: true, unique: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    allowed_origins: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    allowed_environments: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    last_used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4.3 project_environments
  pgm.createTable('project_environments', {
    environment_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: { type: 'uuid', notNull: true, references: 'projects' },
    name: { type: 'text', notNull: true },
    is_default: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4.4 project_onboarding
  pgm.createTable('project_onboarding', {
    project_id: { type: 'uuid', primaryKey: true, references: 'projects' },
    status: { type: 'text', notNull: true, default: 'not_started' },
    current_step: { type: 'integer', notNull: true, default: 0 },
    first_request_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('project_onboarding', 'ck_project_onboarding_status', {
    check: "status IN ('not_started','in_progress','completed')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  // FK-safe drop order: children of projects first.
  pgm.dropTable('project_onboarding');
  pgm.dropTable('project_environments');
  pgm.dropTable('client_keys');
  pgm.dropTable('projects');
};
