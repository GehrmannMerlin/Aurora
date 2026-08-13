import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * PLT-09 in-app notifications (PRD §11.4 / UX/UI §8.30). Account-level rows for
 * the D1 notification center. `(account_id, business_key, type)` is unique so
 * the same business action produces one notification per member (PRD: 同一业务
 * 动作对同一成员只生成一条通知). `target` is a constrained Route Target.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('notifications', {
    notification_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true },
    organization_id: { type: 'uuid' },
    project_id: { type: 'uuid' },
    type: {
      type: 'varchar(32)',
      notNull: true,
      check: "type IN ('alert_triggered','alert_recovered','new_issue','issue_reappeared','issue_assigned_to_me')",
    },
    business_key: { type: 'varchar(256)', notNull: true },
    title: { type: 'varchar(256)', notNull: true },
    summary: { type: 'varchar(1024)' },
    target: { type: 'jsonb', notNull: true },
    read_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('notifications', 'account_id');
  pgm.createIndex('notifications', ['account_id', 'created_at']);
  pgm.addConstraint('notifications', 'uq_notifications_account_business', {
    unique: ['account_id', 'business_key', 'type'],
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('notifications');
};
