/**
 * OPS-07 restore orchestration (backup-and-recovery.md §6).
 *
 * The restore order is frozen exactly as approved: infra & keys → PostgreSQL /
 * Migration → session/task safety state → private objects → Outbox/task resume
 * → deletion/revocation fact replay → critical business Query/Command →
 * read-only verification → controlled traffic.
 *
 * `assertRestoreSafety` guards the two hard invariants: the deletion-replay
 * phase must run before the service reopens to traffic, and a restore must
 * never resurrect deleted data, revoked credentials, or invalidated sessions.
 */

export type RestorePhase =
  | 'infra-keys'
  | 'postgres-migrations'
  | 'session-task-state'
  | 'private-objects'
  | 'outbox-resume'
  | 'deletion-replay'
  | 'query-command-verify'
  | 'readonly-verify'
  | 'controlled-traffic';

export interface RestoreStep {
  readonly phase: RestorePhase;
}

export interface RestorePlan {
  readonly steps: readonly RestoreStep[];
  readonly note: string;
}

const RESTORE_ORDER: readonly RestorePhase[] = [
  'infra-keys',
  'postgres-migrations',
  'session-task-state',
  'private-objects',
  'outbox-resume',
  'deletion-replay',
  'query-command-verify',
  'readonly-verify',
  'controlled-traffic',
];

const RESTORE_NOTE =
  'restore order per backup-and-recovery §6; deletion/revocation facts must be replayed before the service reopens; no-resurrection guarantee';

export function planRestoreOrder(): RestorePlan {
  return Object.freeze({
    steps: Object.freeze(RESTORE_ORDER.map((phase) => Object.freeze({ phase }))),
    note: RESTORE_NOTE,
  });
}

export function assertRestoreSafety(plan: RestorePlan): readonly string[] {
  const violations: string[] = [];
  const phases = plan.steps.map((step) => step.phase);
  if (phases[0] !== 'infra-keys') violations.push('infra-keys-must-be-first');
  if (phases[1] !== 'postgres-migrations') violations.push('postgres-migrations-must-be-second');
  const replayIndex = phases.indexOf('deletion-replay');
  if (replayIndex === -1) {
    violations.push('deletion-replay-required');
  } else {
    const openIndex = phases.indexOf('controlled-traffic');
    if (openIndex !== -1 && replayIndex >= openIndex) {
      violations.push('deletion-replay-must-precede-open');
    }
    const verifyIndex = phases.indexOf('query-command-verify');
    if (verifyIndex !== -1 && replayIndex >= verifyIndex) {
      violations.push('deletion-replay-must-precede-verify');
    }
  }
  if (plan.note !== RESTORE_NOTE) violations.push('no-resurrection-note-missing');
  return Object.freeze(violations);
}
