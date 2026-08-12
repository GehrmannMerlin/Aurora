import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * DAT-19 alert rule / instance / evidence / transition data model (PRD §11,
 * accepted implementation-detail; no new ADR).
 *
 * `alert_rules` is the project-scoped rule config plus its current evaluation
 * projection; `alert_instances` records each triggered cycle (instances are
 * created only when the full trigger condition is satisfied; `recovered` is
 * terminal and a re-trigger creates a new instance). `alert_instance_evidence`
 * holds the single current judgment evidence (1:1, replaced on each transition);
 * `alert_instance_transitions` is the ordered business timeline (C12).
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('alert_rules', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    name: { type: 'varchar(120)' },
    metric: { type: 'varchar(32)', notNull: true },
    filters: { type: 'jsonb', notNull: true },
    window_minutes: { type: 'integer', notNull: true },
    trigger_threshold: { type: 'numeric', notNull: true },
    trigger_duration_minutes: { type: 'integer', notNull: true },
    recovery_threshold: { type: 'numeric', notNull: true },
    recovery_duration_minutes: { type: 'integer', notNull: true },
    min_sample_count: { type: 'integer' },
    cooldown_minutes: { type: 'integer', notNull: true },
    recipient_account_ids: { type: 'jsonb', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    evaluation_state: { type: 'varchar(32)', notNull: true, default: 'normal' },
    evaluation_since: { type: 'timestamptz' },
    last_evaluated_at: { type: 'timestamptz' },
    evaluation_pause_reason: { type: 'varchar(64)' },
    last_observed_value: { type: 'numeric' },
    last_notified_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_metric', {
    check:
      "metric IN ('error_count','new_issue_count','issue_reappearance_count','request_failure_rate','slow_request_count','lcp_ratio','inp_ratio','cls_ratio')",
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_window', {
    check: 'window_minutes IN (1,5,10,30,60)',
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_trigger_duration', {
    check: 'trigger_duration_minutes IN (0,1,2,5,10)',
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_cooldown', {
    check: 'cooldown_minutes IN (5,10,30,60)',
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_recovery_duration', {
    check: 'recovery_duration_minutes >= 0',
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_thresholds', {
    check: 'trigger_threshold >= 0 AND recovery_threshold >= 0 AND recovery_threshold < trigger_threshold',
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_min_sample', {
    check: 'min_sample_count IS NULL OR min_sample_count > 0',
  });
  // Proportion metrics (PRD §11.2.1) must set a minimum sample count (§11.2.7);
  // count metrics may leave it null.
  pgm.addConstraint('alert_rules', 'ck_alert_rules_ratio_samples', {
    check:
      "NOT (metric IN ('request_failure_rate','lcp_ratio','inp_ratio','cls_ratio') AND min_sample_count IS NULL)",
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_filters_object', {
    check: "jsonb_typeof(filters) = 'object'",
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_recipients_array', {
    check: "jsonb_typeof(recipient_account_ids) = 'array'",
  });
  pgm.addConstraint('alert_rules', 'ck_alert_rules_evaluation_state', {
    check: "evaluation_state IN ('normal','pending_trigger','triggered','pending_recovery','evaluation_paused')",
  });
  pgm.createIndex('alert_rules', ['project_id', 'updated_at']);

  pgm.createTable('alert_instances', {
    id: { type: 'bigserial', primaryKey: true },
    rule_id: { type: 'bigint', notNull: true, references: 'alert_rules' },
    project_id: { type: 'uuid', notNull: true },
    state: { type: 'varchar(32)', notNull: true },
    triggered_at: { type: 'timestamptz', notNull: true },
    recovery_since: { type: 'timestamptz' },
    recovered_at: { type: 'timestamptz' },
    paused_from: { type: 'varchar(32)' },
    pause_reason: { type: 'varchar(64)' },
    rule_snapshot: { type: 'jsonb', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_instances', 'ck_alert_instances_state', {
    check: "state IN ('triggered','pending_recovery','recovered','evaluation_paused')",
  });
  pgm.addConstraint('alert_instances', 'ck_alert_instances_paused_from', {
    check: "paused_from IS NULL OR paused_from IN ('triggered','pending_recovery')",
  });
  pgm.addConstraint('alert_instances', 'ck_alert_instances_snapshot', {
    check: "jsonb_typeof(rule_snapshot) = 'object'",
  });
  pgm.createIndex('alert_instances', ['project_id', 'state', 'triggered_at']);
  pgm.createIndex('alert_instances', ['rule_id', 'id']);
  // At most one active (non-recovered) instance per rule.
  pgm.createIndex('alert_instances', ['rule_id'], {
    name: 'uq_alert_instances_active_rule',
    unique: true,
    where: "state <> 'recovered'",
  });

  pgm.createTable('alert_instance_evidence', {
    id: { type: 'bigserial', primaryKey: true },
    instance_id: { type: 'bigint', notNull: true, unique: true, references: 'alert_instances' },
    evaluated_at: { type: 'timestamptz', notNull: true },
    state_after: { type: 'varchar(32)', notNull: true },
    window_start_at: { type: 'timestamptz', notNull: true },
    window_end_at: { type: 'timestamptz', notNull: true },
    observed_value: { type: 'numeric' },
    numerator: { type: 'numeric' },
    denominator: { type: 'numeric' },
    sample_count: { type: 'integer' },
    min_sample_requirement: { type: 'integer' },
    watermark_at: { type: 'timestamptz' },
    completeness: { type: 'varchar(16)', notNull: true },
    pause_reason: { type: 'varchar(64)' },
    applied_filters: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });
  pgm.addConstraint('alert_instance_evidence', 'ck_alert_evidence_completeness', {
    check: "completeness IN ('complete','insufficient','missing')",
  });
  pgm.addConstraint('alert_instance_evidence', 'ck_alert_evidence_filters', {
    check: "jsonb_typeof(applied_filters) = 'object'",
  });

  pgm.createTable('alert_instance_transitions', {
    id: { type: 'bigserial', primaryKey: true },
    instance_id: { type: 'bigint', notNull: true, references: 'alert_instances' },
    from_state: { type: 'varchar(32)', notNull: true },
    to_state: { type: 'varchar(32)', notNull: true },
    reason: { type: 'varchar(64)', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('alert_instance_transitions', ['instance_id', 'occurred_at']);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('alert_instance_transitions');
  pgm.dropTable('alert_instance_evidence');
  pgm.dropTable('alert_instances');
  pgm.dropTable('alert_rules');
};
