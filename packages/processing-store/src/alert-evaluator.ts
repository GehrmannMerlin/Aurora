import {
  ALERT_RATIO_METRICS,
  EMPTY_ALERT_FILTERS,
  type AlertEvidenceRecord,
  type AlertInstanceAction,
  type AlertMetric,
  type AlertNotificationDecision,
  type AlertObservation,
  type AlertRuleConfig,
  type AlertRuleEvaluation,
  type AlertTransition,
  type EvaluateAlertRoundInput,
  type EvaluateAlertRoundResult,
} from './alert-evaluator-types.js';

export function isRatioMetric(metric: AlertMetric): boolean {
  return (ALERT_RATIO_METRICS as readonly string[]).includes(metric);
}

export type AlertObservationClass =
  'breached' | 'recovery_zone' | 'between' | 'insufficient_samples' | 'missing';

/**
 * Classify a trustworthy observation against the rule thresholds (PRD §11.2.4 /
 * §11.2.5 / §11.2.7). All first-version metrics are higher-is-worse.
 *
 * - `breached`         value > triggerThreshold (trigger condition met)
 * - `recovery_zone`    value < recoveryThreshold (recovery condition met)
 * - `between`          recoveryThreshold ≤ value ≤ triggerThreshold (持续异常)
 * - `insufficient_samples`  proportion metric with denominator < minSampleCount
 * - `missing`          no data → cannot judge (never recovery, never normal)
 */
export function classifyAlertObservation(
  rule: AlertRuleConfig,
  observation: AlertObservation,
): AlertObservationClass {
  if (observation.kind === 'missing') return 'missing';
  if (
    rule.isRatio &&
    observation.denominator !== undefined &&
    observation.denominator < (rule.minSampleCount ?? 0)
  ) {
    return 'insufficient_samples';
  }
  if (observation.value > rule.triggerThreshold) return 'breached';
  if (observation.value < rule.recoveryThreshold) return 'recovery_zone';
  return 'between';
}

function buildEvidence(
  rule: AlertRuleConfig,
  observation: AlertObservation,
  now: number,
  completeness: 'complete' | 'insufficient' | 'missing',
  pauseReason: string | null,
): AlertEvidenceRecord {
  return {
    evaluatedAt: now,
    windowStart: observation.windowStart,
    windowEnd: observation.windowEnd,
    observedValue: observation.kind === 'data' ? observation.value : null,
    numerator: observation.kind === 'data' ? (observation.numerator ?? null) : null,
    denominator: observation.kind === 'data' ? (observation.denominator ?? null) : null,
    sampleCount: observation.kind === 'data' ? (observation.sampleCount ?? null) : null,
    minSampleRequirement: rule.minSampleCount,
    watermark: observation.kind === 'data' ? observation.watermark : null,
    completeness,
    pauseReason,
    appliedFilters: EMPTY_ALERT_FILTERS,
  };
}

function notificationDecision(
  instanceCreated: boolean,
  recovered: boolean,
  lastNotifiedAt: number | null,
  now: number,
  cooldownMs: number,
): { notification: AlertNotificationDecision; notifyNow: boolean } {
  if (recovered) return { notification: 'recovered', notifyNow: true };
  if (instanceCreated) {
    if (lastNotifiedAt === null) return { notification: 'first_trigger', notifyNow: true };
    if (now - lastNotifiedAt >= cooldownMs) return { notification: 'retrigger', notifyNow: true };
    return { notification: 'suppressed', notifyNow: false };
  }
  return { notification: 'none', notifyNow: false };
}

function pausedResult(
  rule: AlertRuleConfig,
  observation: AlertObservation,
  ruleEval: AlertRuleEvaluation,
  instance: EvaluateAlertRoundInput['instance'],
  lastNotifiedAt: number | null,
  now: number,
  pauseReason: string,
): EvaluateAlertRoundResult {
  const evidence = buildEvidence(rule, observation, now, 'missing', pauseReason);
  const transition: AlertTransition | null =
    ruleEval.state === 'evaluation_paused'
      ? null
      : { from: ruleEval.state, to: 'evaluation_paused', reason: pauseReason, occurredAt: now };
  let instanceAction: AlertInstanceAction = { action: 'none' };
  if (instance !== null) {
    instanceAction =
      instance.state === 'evaluation_paused'
        ? { action: 'update', state: 'evaluation_paused', pauseReason }
        : {
            action: 'update',
            state: 'evaluation_paused',
            pausedFrom: instance.state,
            pauseReason,
          };
  }
  return {
    ruleEval: { state: 'evaluation_paused', since: null, lastEvaluatedAt: now, pauseReason },
    transition,
    instanceAction,
    evidence,
    notification: 'none',
    notifyNow: false,
    nextLastNotifiedAt: lastNotifiedAt ?? 0,
  };
}

/**
 * Deterministic alert rule evaluation (PRD §11.2.4—§11.2.10). Pure: no I/O, no
 * clock reads — `now` is injected so tests use a fake clock and never sleep.
 *
 * Rule evaluation states: normal → pending_trigger → triggered →
 * pending_recovery → normal (instance recovered). `evaluation_paused` is a
 * non-advancing pause: missing/insufficient data never recovers and never
 * cancels an existing trigger; continuity anchors reset after a gap.
 */
export function evaluateAlertRule(input: EvaluateAlertRoundInput): EvaluateAlertRoundResult {
  const { rule, observation, ruleEval, instance, lastNotifiedAt, now } = input;
  const cls = classifyAlertObservation(rule, observation);

  if (cls === 'missing' || cls === 'insufficient_samples') {
    const reason =
      cls === 'insufficient_samples'
        ? 'insufficient_samples'
        : observation.kind === 'missing'
          ? observation.pauseReason
          : 'no_data';
    return pausedResult(rule, observation, ruleEval, instance, lastNotifiedAt, now, reason);
  }

  const evidence = buildEvidence(rule, observation, now, 'complete', null);
  const cooldownMs = rule.cooldownMinutes * 60_000;
  const notif = (instanceCreated: boolean, recovered: boolean) =>
    notificationDecision(instanceCreated, recovered, lastNotifiedAt, now, cooldownMs);

  if (cls === 'breached') {
    if (ruleEval.state === 'pending_trigger') {
      if (now - (ruleEval.since ?? now) >= rule.triggerDurationMinutes * 60_000) {
        // Full sustained trigger condition satisfied → create the instance.
        const { notification, notifyNow } = notif(true, false);
        return {
          ruleEval: { state: 'triggered', since: now, lastEvaluatedAt: now, pauseReason: null },
          transition: {
            from: 'none',
            to: 'triggered',
            reason: 'trigger_threshold_sustained',
            occurredAt: now,
          },
          instanceAction: { action: 'create', state: 'triggered', triggeredAt: now },
          evidence,
          notification,
          notifyNow,
          nextLastNotifiedAt: notifyNow ? now : (lastNotifiedAt ?? 0),
        };
      }
      return {
        ruleEval: { ...ruleEval, lastEvaluatedAt: now, pauseReason: null },
        transition: null,
        instanceAction: { action: 'none' },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    if (ruleEval.state === 'normal' || ruleEval.state === 'evaluation_paused') {
      const resumingInstance = instance;
      if (resumingInstance !== null) {
        // Paused triggered instance resumes as triggered (持续异常), not a fresh trigger.
        return {
          ruleEval: { state: 'triggered', since: now, lastEvaluatedAt: now, pauseReason: null },
          transition: {
            from: 'evaluation_paused',
            to: 'triggered',
            reason: 'data_resumed',
            occurredAt: now,
          },
          instanceAction: {
            action: 'update',
            state: 'triggered',
            recoverySince: null,
            pausedFrom: null,
          },
          evidence,
          notification: 'none',
          notifyNow: false,
          nextLastNotifiedAt: lastNotifiedAt ?? 0,
        };
      }
      return {
        ruleEval: { state: 'pending_trigger', since: now, lastEvaluatedAt: now, pauseReason: null },
        transition: null,
        instanceAction: { action: 'none' },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    // triggered / pending_recovery → back to triggered (持续异常).
    const { notification, notifyNow } = notif(false, false);
    return {
      ruleEval: { state: 'triggered', since: now, lastEvaluatedAt: now, pauseReason: null },
      transition:
        ruleEval.state === 'pending_recovery'
          ? {
              from: 'pending_recovery',
              to: 'triggered',
              reason: 'trigger_threshold_rebreached',
              occurredAt: now,
            }
          : null,
      instanceAction:
        instance !== null
          ? { action: 'update', state: 'triggered', recoverySince: null, pausedFrom: null }
          : { action: 'none' },
      evidence,
      notification,
      notifyNow,
      nextLastNotifiedAt: notifyNow ? now : (lastNotifiedAt ?? 0),
    };
  }

  if (cls === 'recovery_zone') {
    if (ruleEval.state === 'triggered') {
      return {
        ruleEval: {
          state: 'pending_recovery',
          since: now,
          lastEvaluatedAt: now,
          pauseReason: null,
        },
        transition: {
          from: 'triggered',
          to: 'pending_recovery',
          reason: 'recovery_threshold_met',
          occurredAt: now,
        },
        instanceAction:
          instance !== null
            ? { action: 'update', state: 'pending_recovery', recoverySince: now, pausedFrom: null }
            : { action: 'none' },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    if (ruleEval.state === 'pending_recovery') {
      const recoverySince = instance?.recoverySince ?? now;
      if (now - recoverySince >= rule.recoveryDurationMinutes * 60_000) {
        const { notification, notifyNow } = notif(false, true);
        return {
          ruleEval: { state: 'normal', since: null, lastEvaluatedAt: now, pauseReason: null },
          transition: {
            from: 'pending_recovery',
            to: 'recovered',
            reason: 'recovery_duration_satisfied',
            occurredAt: now,
          },
          instanceAction: { action: 'recover', recoveredAt: now },
          evidence,
          notification,
          notifyNow,
          nextLastNotifiedAt: notifyNow ? now : (lastNotifiedAt ?? 0),
        };
      }
      return {
        ruleEval: {
          state: 'pending_recovery',
          since: ruleEval.since,
          lastEvaluatedAt: now,
          pauseReason: null,
        },
        transition: null,
        instanceAction:
          instance !== null
            ? { action: 'update', state: 'pending_recovery', recoverySince: instance.recoverySince }
            : { action: 'none' },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    if (ruleEval.state === 'evaluation_paused') {
      if (instance !== null) {
        return {
          ruleEval: {
            state: 'pending_recovery',
            since: now,
            lastEvaluatedAt: now,
            pauseReason: null,
          },
          transition: {
            from: 'evaluation_paused',
            to: 'pending_recovery',
            reason: 'data_resumed',
            occurredAt: now,
          },
          instanceAction: {
            action: 'update',
            state: 'pending_recovery',
            recoverySince: now,
            pausedFrom: null,
          },
          evidence,
          notification: 'none',
          notifyNow: false,
          nextLastNotifiedAt: lastNotifiedAt ?? 0,
        };
      }
      return {
        ruleEval: { state: 'normal', since: null, lastEvaluatedAt: now, pauseReason: null },
        transition: null,
        instanceAction: { action: 'none' },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    // normal / pending_trigger → nothing to recover.
    return {
      ruleEval: { state: 'normal', since: null, lastEvaluatedAt: now, pauseReason: null },
      transition: null,
      instanceAction: { action: 'none' },
      evidence,
      notification: 'none',
      notifyNow: false,
      nextLastNotifiedAt: lastNotifiedAt ?? 0,
    };
  }

  // between — 持续异常 (PRD §11.2.5).
  if (ruleEval.state === 'pending_trigger') {
    return {
      ruleEval: { state: 'normal', since: null, lastEvaluatedAt: now, pauseReason: null },
      transition: null,
      instanceAction: { action: 'none' },
      evidence,
      notification: 'none',
      notifyNow: false,
      nextLastNotifiedAt: lastNotifiedAt ?? 0,
    };
  }
  if (ruleEval.state === 'pending_recovery') {
    return {
      ruleEval: { state: 'triggered', since: now, lastEvaluatedAt: now, pauseReason: null },
      transition: {
        from: 'pending_recovery',
        to: 'triggered',
        reason: 'recovery_threshold_no_longer_met',
        occurredAt: now,
      },
      instanceAction:
        instance !== null
          ? { action: 'update', state: 'triggered', recoverySince: null, pausedFrom: null }
          : { action: 'none' },
      evidence,
      notification: 'none',
      notifyNow: false,
      nextLastNotifiedAt: lastNotifiedAt ?? 0,
    };
  }
  if (ruleEval.state === 'evaluation_paused') {
    if (instance !== null) {
      return {
        ruleEval: { state: 'triggered', since: now, lastEvaluatedAt: now, pauseReason: null },
        transition: {
          from: 'evaluation_paused',
          to: 'triggered',
          reason: 'data_resumed',
          occurredAt: now,
        },
        instanceAction: {
          action: 'update',
          state: 'triggered',
          recoverySince: null,
          pausedFrom: null,
        },
        evidence,
        notification: 'none',
        notifyNow: false,
        nextLastNotifiedAt: lastNotifiedAt ?? 0,
      };
    }
    return {
      ruleEval: { state: 'normal', since: null, lastEvaluatedAt: now, pauseReason: null },
      transition: null,
      instanceAction: { action: 'none' },
      evidence,
      notification: 'none',
      notifyNow: false,
      nextLastNotifiedAt: lastNotifiedAt ?? 0,
    };
  }
  // normal / triggered — keep.
  const { notification, notifyNow } = notif(false, false);
  return {
    ruleEval: {
      state: ruleEval.state,
      since: ruleEval.state === 'triggered' ? ruleEval.since : null,
      lastEvaluatedAt: now,
      pauseReason: null,
    },
    transition: null,
    instanceAction:
      instance !== null
        ? { action: 'update', state: 'triggered', recoverySince: null, pausedFrom: null }
        : { action: 'none' },
    evidence,
    notification,
    notifyNow,
    nextLastNotifiedAt: notifyNow ? now : (lastNotifiedAt ?? 0),
  };
}

export type {
  AlertEvidenceRecord,
  AlertInstanceAction,
  AlertNotificationDecision,
  AlertObservation,
  AlertRuleConfig,
  AlertRuleEvaluation,
  AlertTransition,
  EvaluateAlertRoundInput,
  EvaluateAlertRoundResult,
};
