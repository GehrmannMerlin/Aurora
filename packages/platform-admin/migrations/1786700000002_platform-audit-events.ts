import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-10a platform-admin data layer migration 2: `platform_audit_events`.
 *
 * Platform-level audit timeline, separate from the B7 org `security_audit_events`
 * table (ADR-034 / platform-admin-and-platform-audit spec). Written by platform
 * commands in the same transaction as the command itself; readable only by
 * platform admins; 1-year retention.
 *
 * - `actor_account_id` (uuid, NOT NULL, FK → accounts): full account id for
 *   security/compliance use (NOT masked — this is the admin-facing platform
 *   audit, unlike B7's masked timeline).
 * - `action` CHECK covers every planned value (Plan B reuses the same table;
 *   no ALTER needed).
 * - `target` (jsonb, NOT NULL): constrained payload — never carries policy
 *   bodies/keys/full directory listings.
 * - `result` CHECK: 'succeeded' | 'rejected'.
 * - `request_id` (varchar(64)): correlation id, optional.
 *
 * Up/down fully reversible.
 */
export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_audit_events', {
    event_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_account_id: { type: 'uuid', notNull: true, references: 'accounts' },
    action: {
      type: 'varchar(48)',
      notNull: true,
      check: "action IN ('admin_bootstrapped','admin_granted','admin_revoked','policy_set_default','policy_set_organization','policy_reset_organization','policy_set_project_limit','policy_clear_project_limit','audit_read')",
    },
    target: { type: 'jsonb', notNull: true },
    result: { type: 'varchar(16)', notNull: true, check: "result IN ('succeeded','rejected')" },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    request_id: { type: 'varchar(64)' },
  });
  pgm.createIndex(
    'platform_audit_events',
    [{ name: 'occurred_at', sort: 'DESC' }],
    { name: 'idx_platform_audit_events_occurred_at' },
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('platform_audit_events');
};
