import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-03 platform identity, authentication and invitation data model.
 *
 * All 11 tables from spec §4.1-§4.11. uuid PKs default to gen_random_uuid();
 * timestamptz columns default to now() unless noted. Intent/invitation
 * token_digest columns store only the SHA-256 digest of the one-time token,
 * never the raw token (ADR-030).
 *
 * Notes:
 * - `project_members.project_id` is a plain uuid with NO foreign key: the
 *   `projects` table does not exist yet (PLT-04 creates it). The composite PK
 *   (project_id, account_id) is the invitation-accept write target.
 * - `security_audit_events` has no foreign keys on its nullable id columns
 *   (organization_id / actor_account_id / target_account_id): identity events
 *   may reference actors or orgs that are not (yet) rows, and PLT-04 owns the
 *   org audit surface. details jsonb must never contain passwords/tokens/emails.
 * - `email` is stored normalized (lower/trim) and is also UNIQUE, matching
 *   `email_normalized` (the deterministic match key for anti-enumeration).
 */
export const up = (pgm: MigrationBuilder): void => {
  // 4.1 accounts
  pgm.createTable('accounts', {
    account_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    email_normalized: { type: 'text', notNull: true, unique: true },
    verified_at: { type: 'timestamptz' },
    security_version: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('accounts', 'ck_accounts_status', {
    check: "status IN ('active','pending_verification','deletion_cooling','terminated')",
  });

  // 4.2 account_credentials (password digest; never plaintext)
  pgm.createTable('account_credentials', {
    account_id: { type: 'uuid', primaryKey: true, references: 'accounts' },
    password_hash: { type: 'text', notNull: true },
    password_version: { type: 'integer', notNull: true, default: 1 },
    changed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4.3 email_verification_intents
  pgm.createTable('email_verification_intents', {
    intent_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, references: 'accounts' },
    token_digest: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4.4 password_reset_intents
  pgm.createTable('password_reset_intents', {
    intent_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, references: 'accounts' },
    token_digest: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4.5 organizations (personal workspace + organization; PLT-03 base only)
  pgm.createTable('organizations', {
    organization_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true },
    timezone: { type: 'text', notNull: true, default: 'UTC' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('organizations', 'ck_organizations_kind', {
    check: "kind IN ('personal','organization')",
  });

  // 4.6 organization_members (owner/admin/member; owner invariant enforced by app)
  pgm.createTable(
    'organization_members',
    {
      organization_id: { type: 'uuid', notNull: true, references: 'organizations' },
      account_id: { type: 'uuid', notNull: true, references: 'accounts' },
      role: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['organization_id', 'account_id'] } },
  );
  pgm.addConstraint('organization_members', 'ck_organization_members_role', {
    check: "role IN ('owner','admin','member')",
  });

  // 4.7 organization_invitations (accept side; partial unique pending index)
  pgm.createTable('organization_invitations', {
    invitation_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations' },
    invited_email: { type: 'text', notNull: true },
    org_role: { type: 'text', notNull: true },
    token_digest: { type: 'text', notNull: true, unique: true },
    expires_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func("now() + interval '7 days'"),
    },
    status: { type: 'text', notNull: true, default: 'pending' },
    accepted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('organization_invitations', 'ck_organization_invitations_org_role', {
    check: "org_role IN ('owner','admin','member')",
  });
  pgm.addConstraint('organization_invitations', 'ck_organization_invitations_status', {
    check: "status IN ('pending','accepted','revoked','expired')",
  });
  pgm.createIndex('organization_invitations', ['organization_id', 'invited_email'], {
    unique: true,
    where: "status = 'pending'",
    name: 'uq_organization_invitations_pending_org_email',
  });

  // 4.8 project_members (atomic invitation-accept write; no FK to projects yet)
  pgm.createTable(
    'project_members',
    {
      project_id: { type: 'uuid', notNull: true },
      account_id: { type: 'uuid', notNull: true, references: 'accounts' },
      role: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['project_id', 'account_id'] } },
  );
  pgm.addConstraint('project_members', 'ck_project_members_role', {
    check: "role IN ('project_admin','developer','read_only')",
  });

  // 4.9 security_audit_events (identity events; FK-free)
  pgm.createTable('security_audit_events', {
    event_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: { type: 'uuid' },
    actor_account_id: { type: 'uuid' },
    action: { type: 'text', notNull: true },
    target_account_id: { type: 'uuid' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });

  // 4.10 idempotency_records
  pgm.createTable('idempotency_records', {
    idempotency_key: { type: 'text', primaryKey: true },
    operation: { type: 'text', notNull: true },
    request_digest: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true },
    result_data: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('idempotency_records', 'ck_idempotency_records_status', {
    check: "status IN ('processing','succeeded','failed')",
  });

  // 4.11 outbox (ADR-032 generic outbox; FK-free)
  pgm.createTable('outbox', {
    outbox_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    aggregate_type: { type: 'text', notNull: true },
    aggregate_id: { type: 'uuid' },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('outbox', 'ck_outbox_status', {
    check: "status IN ('pending','processing','succeeded','failed','dead_lettered')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('outbox');
  pgm.dropTable('idempotency_records');
  pgm.dropTable('security_audit_events');
  pgm.dropTable('project_members');
  pgm.dropTable('organization_invitations');
  pgm.dropTable('organization_members');
  pgm.dropTable('organizations');
  pgm.dropTable('password_reset_intents');
  pgm.dropTable('email_verification_intents');
  pgm.dropTable('account_credentials');
  pgm.dropTable('accounts');
};
