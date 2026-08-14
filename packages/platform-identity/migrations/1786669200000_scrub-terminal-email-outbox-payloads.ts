import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Forward-only cleanup for secrets retained by the legacy email consumer.
 * Terminal email payloads are never needed for retries and may contain an
 * address plus a bearer-like intent link. They cannot be reconstructed on
 * rollback and must stay scrubbed.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE outbox
    SET payload = '{}'::jsonb,
        claim_id = NULL,
        updated_at = now()
    WHERE aggregate_type LIKE 'email.%'
      AND status IN ('succeeded', 'dead_lettered', 'superseded')
      AND payload <> '{}'::jsonb
  `);
};

/** Intentionally irreversible: a down migration must never restore secrets. */
export const down = (_pgm: MigrationBuilder): void => undefined;
