import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-04 platform-organization data layer migration.
 *
 * Extends the PLT-03 tables (created by the platform-identity migration, which
 * this migration assumes has already run):
 * - `organizations.settings_version` (integer NOT NULL DEFAULT 0): optimistic
 *   concurrency version for B4 organization timezone updates.
 * - ensures the `organization_invitations` partial unique index
 *   `uq_organization_invitations_pending_org_email` on (organization_id,
 *   invited_email) WHERE status = 'pending' exists (created by platform-identity;
 *   re-created only if a prior schema predates it).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns('organizations', {
    settings_version: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.createIndex('organization_invitations', ['organization_id', 'invited_email'], {
    unique: true,
    where: "status = 'pending'",
    name: 'uq_organization_invitations_pending_org_email',
    ifNotExists: true,
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('organization_invitations', ['organization_id', 'invited_email'], {
    name: 'uq_organization_invitations_pending_org_email',
    ifExists: true,
  });
  pgm.dropColumns('organizations', ['settings_version']);
};
