import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * SEC-02 account cleanup per-store step tracking (extension of SEC-01
 * `account_cleanup_handoffs`).
 *
 * Each row is one cross-store cleanup step for one handoff, so partial-failure
 * retry and idempotent completion can be persisted: a `succeeded` step is never
 * re-run; the handoff only reaches `succeeded` when every required store step
 * has `succeeded` (account-deletion-and-data-lifecycle §8 — no partial-success
 * reported as complete).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable(
    'account_cleanup_steps',
    {
      handoff_id: { type: 'uuid', notNull: true, references: 'account_cleanup_handoffs' },
      store: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, default: 'pending' },
      error_code: { type: 'text' },
      attempt_count: { type: 'integer', notNull: true, default: 0 },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['handoff_id', 'store'] } },
  );
  pgm.addConstraint('account_cleanup_steps', 'ck_account_cleanup_steps_status', {
    check: "status IN ('pending','succeeded','failed')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('account_cleanup_steps');
};
