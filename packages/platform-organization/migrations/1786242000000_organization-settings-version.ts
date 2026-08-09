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
 *
 * Index ownership: the pending-invitation index is created by the PLT-03
 * platform-identity migration and is NOT this migration's to own. This
 * migration's `up` only re-creates it as a defensive backfill (no-op when the
 * index is already present), and its `down` never drops it — a partial PLT-04
 * revert must not remove the unique-pending backstop that `inviteMember`'s
 * `pending_conflict` (23505) detection relies on.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns('organizations', {
    settings_version: { type: 'integer', notNull: true, default: 0 },
  });
  // PLT-03-owned backstop; ifNotExists makes this a no-op when already present.
  pgm.createIndex('organization_invitations', ['organization_id', 'invited_email'], {
    unique: true,
    where: "status = 'pending'",
    name: 'uq_organization_invitations_pending_org_email',
    ifNotExists: true,
  });
};

export const down = (pgm: MigrationBuilder): void => {
  // Do NOT drop uq_organization_invitations_pending_org_email: it is owned by
  // the PLT-03 platform-identity migration and must survive this migration's
  // revert (see index-ownership note above). Only this migration's own column
  // is removed.
  pgm.dropColumns('organizations', ['settings_version']);
};
