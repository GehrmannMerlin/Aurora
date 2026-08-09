import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-04 platform-credentials data layer migration.
 *
 * Creates the `private_tokens` table from spec §4.5 on top of the PLT-03 tables
 * (`organizations`, `accounts`, created by the platform-identity migration that
 * this migration assumes has already run):
 * - B6 private management tokens: the server stores ONLY the SHA-256
 *   `token_digest` (never the plaintext `aurora_pt_<tokenId>_<secret>`).
 * - `scopes` is a jsonb array restricted to the fixed public allowlist by the
 *   repository (spec §7); the schema keeps it NOT NULL.
 * - `revoked_at` is terminal: once set, a token is never reactivated.
 * - `expires_at` NULL = never expires.
 *
 * Up/down fully reversible: `down` drops the table.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('private_tokens', {
    token_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations' },
    created_by: { type: 'uuid', notNull: true, references: 'accounts' },
    name: { type: 'text', notNull: true },
    token_digest: { type: 'text', notNull: true, unique: true },
    scopes: { type: 'jsonb', notNull: true },
    expires_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    last_used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // listPrivateTokens filters by organization_id; index it for the org-scoped read.
  pgm.createIndex('private_tokens', ['organization_id']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('private_tokens');
};
