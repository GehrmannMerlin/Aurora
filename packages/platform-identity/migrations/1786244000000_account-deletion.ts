import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * SEC-01 A5 account deletion data model (PLT-03 extension).
 *
 * Extends the existing platform-identity schema with the three authoritative
 * account-deletion pieces from spec §3.2:
 * - `account_deletion_intents`: one-time mailbox confirmation intents for the
 *   dual-factor re-check (kinds `deletion_request` / `deletion_cancel`). Only
 *   the SHA-256 token digest is stored, never the raw token (mirrors the
 *   email/password intent tables).
 * - `accounts` nullable columns carrying the authoritative deletion timeline
 *   (requested / cooling ends / terminated). `accounts.status` CHECK already
 *   allows `deletion_cooling`/`terminated` (PLT-03), so no CHECK change here.
 * - `account_cleanup_handoffs`: the persisted cleanup handoff intent consumed
 *   by the future SEC-02 worker. One active handoff per account (UNIQUE).
 *   Never routed through `outbox` (the email consumer must not see it).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('account_deletion_intents', {
    intent_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, references: 'accounts' },
    intent_kind: { type: 'text', notNull: true },
    token_digest: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('account_deletion_intents', 'ck_account_deletion_intents_kind', {
    check: "intent_kind IN ('deletion_request','deletion_cancel')",
  });
  pgm.createIndex('account_deletion_intents', ['account_id']);

  pgm.addColumn('accounts', {
    deletion_requested_at: { type: 'timestamptz' },
    deletion_cooling_ends_at: { type: 'timestamptz' },
    deletion_terminated_at: { type: 'timestamptz' },
  });

  pgm.createTable('account_cleanup_handoffs', {
    handoff_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, unique: true, references: 'accounts' },
    status: { type: 'text', notNull: true, default: 'pending' },
    required_lifecycle: { type: 'jsonb', notNull: true },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('account_cleanup_handoffs', 'ck_account_cleanup_handoffs_status', {
    check: "status IN ('pending','in_progress','succeeded','failed','dead_lettered')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('account_cleanup_handoffs');
  pgm.dropTable('account_deletion_intents');
  pgm.dropColumn('accounts', [
    'deletion_requested_at',
    'deletion_cooling_ends_at',
    'deletion_terminated_at',
  ]);
};
