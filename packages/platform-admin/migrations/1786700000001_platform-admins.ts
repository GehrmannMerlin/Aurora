import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-10a platform-admin data layer migration 1: `platform_admins`.
 *
 * Explicit account-level platform admin capability (ADR-034). A platform admin
 * is a database-enforced identity capability, fully decoupled from any
 * org/project role. Both `account_id` (who holds the capability) and
 * `granted_by` (who granted it) reference `accounts`.
 *
 * Up/down fully reversible.
 */
export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_admins', {
    account_id: { type: 'uuid', primaryKey: true, references: 'accounts' },
    granted_by: { type: 'uuid', notNull: true, references: 'accounts' },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('platform_admins');
};
