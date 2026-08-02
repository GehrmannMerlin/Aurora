import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('ingestion_client_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: { type: 'uuid', notNull: true },
    key_id: { type: 'varchar(22)', notNull: true, unique: true },
    secret_digest: { type: 'bytea', notNull: true },
    status: { type: 'varchar', notNull: true },
    allow_non_browser: { type: 'boolean', notNull: true, default: false },
    expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('ingestion_client_credentials', 'ck_icc_status', {
    check: "status IN ('active','disabled','revoked')",
  });
  pgm.addConstraint('ingestion_client_credentials', 'ck_icc_digest_length', {
    check: 'octet_length(secret_digest) = 32',
  });
  pgm.createIndex('ingestion_client_credentials', 'project_id');

  pgm.createTable('ingestion_client_credential_origins', {
    credential_id: {
      type: 'uuid',
      notNull: true,
      references: 'ingestion_client_credentials',
    },
    origin: { type: 'varchar', notNull: true },
  });
  pgm.addConstraint('ingestion_client_credential_origins', 'uq_icco_cred_origin', {
    unique: ['credential_id', 'origin'],
  });

  pgm.createTable('ingestion_client_credential_environments', {
    credential_id: {
      type: 'uuid',
      notNull: true,
      references: 'ingestion_client_credentials',
    },
    environment: { type: 'varchar', notNull: true },
  });
  pgm.addConstraint('ingestion_client_credential_environments', 'uq_icce_cred_env', {
    unique: ['credential_id', 'environment'],
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('ingestion_client_credential_environments');
  pgm.dropTable('ingestion_client_credential_origins');
  pgm.dropTable('ingestion_client_credentials');
};
