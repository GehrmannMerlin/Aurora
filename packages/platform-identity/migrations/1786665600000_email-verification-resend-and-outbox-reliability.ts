import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Email-verification resend state and reliable, fenced Outbox delivery.
 *
 * `superseded` permanently retires unsent verification messages after a newer
 * link is accepted. `claim_id` fences stale workers after processing timeout
 * recovery. Diagnostic fields contain stable codes/identifiers only; provider
 * error bodies are never persisted.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint('outbox', 'ck_outbox_status');
  pgm.addColumns('outbox', {
    claim_id: { type: 'uuid' },
    last_error_code: { type: 'text' },
    provider_request_id: { type: 'text' },
  });
  pgm.addConstraint('outbox', 'ck_outbox_status', {
    check:
      "status IN ('pending','processing','succeeded','failed','dead_lettered','superseded')",
  });
  pgm.createIndex('outbox', ['status', 'available_at', 'outbox_id'], {
    name: 'outbox_claimable_idx',
  });
  pgm.createIndex('outbox', ['aggregate_id', 'aggregate_type', 'created_at'], {
    name: 'outbox_email_resend_window_idx',
  });
};

/**
 * Rollback is valid only before any `superseded` row exists. Deployment
 * rollback must not run this down migration after the new state is in use.
 */
export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('outbox', ['aggregate_id', 'aggregate_type', 'created_at'], {
    name: 'outbox_email_resend_window_idx',
  });
  pgm.dropIndex('outbox', ['status', 'available_at', 'outbox_id'], {
    name: 'outbox_claimable_idx',
  });
  pgm.dropConstraint('outbox', 'ck_outbox_status');
  pgm.addConstraint('outbox', 'ck_outbox_status', {
    check: "status IN ('pending','processing','succeeded','failed','dead_lettered')",
  });
  pgm.dropColumns('outbox', ['claim_id', 'last_error_code', 'provider_request_id']);
};
