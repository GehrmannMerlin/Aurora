import { describe, expect, it } from 'vitest';
import { evaluateAlertRule, classifyAlertObservation } from '../src/alert-evaluator.js';
import type {
  AlertObservation,
  AlertRuleConfig,
  AlertRuleEvaluation,
  ActiveAlertInstance,
} from '../src/alert-evaluator-types.js';

const NOW = 1_752_000_000_000; // fixed fake clock (no sleep anywhere)
const MINUTE = 60_000;

function countRule(overrides: Partial<AlertRuleConfig> = {}): AlertRuleConfig {
  return {
    metric: 'error_count',
    windowMinutes: 5,
    triggerThreshold: 100,
    triggerDurationMinutes: 2,
    recoveryThreshold: 60,
    recoveryDurationMinutes: 2,
    minSampleCount: null,
    cooldownMinutes: 10,
    isRatio: false,
    ...overrides,
  };
}

function ratioRule(overrides: Partial<AlertRuleConfig> = {}): AlertRuleConfig {
  return {
    ...countRule(),
    metric: 'request_failure_rate',
    windowMinutes: 5,
    triggerThreshold: 20,
    recoveryThreshold: 10,
    minSampleCount: 50,
    isRatio: true,
    ...overrides,
  };
}

function dataObservation(
  overrides: Partial<Extract<AlertObservation, { kind: 'data' }>> = {},
): Extract<AlertObservation, { kind: 'data' }> {
  return {
    kind: 'data',
    value: 0,
    numerator: 0,
    denominator: 0,
    sampleCount: 0,
    windowStart: NOW - 5 * MINUTE,
    windowEnd: NOW,
    watermark: NOW,
    ...overrides,
  };
}

function missingObservation(pauseReason = 'no_data_in_window'): AlertObservation {
  return { kind: 'missing', pauseReason, windowStart: NOW - 5 * MINUTE, windowEnd: NOW };
}

function evaluate(
  rule: AlertRuleConfig,
  observation: AlertObservation,
  ruleEval: AlertRuleEvaluation = {
    state: 'normal',
    since: null,
    lastEvaluatedAt: NOW - 5 * MINUTE,
    pauseReason: null,
  },
  instance: ActiveAlertInstance | null = null,
  lastNotifiedAt: number | null = null,
  now = NOW,
) {
  return evaluateAlertRule({ rule, observation, ruleEval, instance, lastNotifiedAt, now });
}

describe('classifyAlertObservation', () => {
  it('classifies breach / recovery-zone / between for higher-is-worse', () => {
    const rule = countRule();
    expect(classifyAlertObservation(rule, dataObservation({ value: 150 }))).toBe('breached');
    expect(classifyAlertObservation(rule, dataObservation({ value: 50 }))).toBe('recovery_zone');
    expect(classifyAlertObservation(rule, dataObservation({ value: 80 }))).toBe('between');
  });

  it('treats proportion metrics with insufficient samples as paused (PRD §11.2.7)', () => {
    const rule = ratioRule();
    expect(
      classifyAlertObservation(
        rule,
        dataObservation({ value: 40, denominator: 10, sampleCount: 10 }),
      ),
    ).toBe('insufficient_samples');
    expect(
      classifyAlertObservation(
        rule,
        dataObservation({ value: 40, denominator: 50, sampleCount: 50 }),
      ),
    ).toBe('breached');
  });

  it('treats missing data as missing (never normal, never recovery)', () => {
    expect(classifyAlertObservation(countRule(), missingObservation())).toBe('missing');
  });
});

describe('evaluateAlertRule — trigger path', () => {
  it('stays normal below the trigger threshold', () => {
    const r = evaluate(countRule(), dataObservation({ value: 10 }));
    expect(r.ruleEval.state).toBe('normal');
    expect(r.instanceAction.action).toBe('none');
  });

  it('enters pending_trigger on first breach, no instance yet', () => {
    const r = evaluate(countRule(), dataObservation({ value: 150 }));
    expect(r.ruleEval.state).toBe('pending_trigger');
    expect(r.ruleEval.since).toBe(NOW);
    expect(r.instanceAction.action).toBe('none');
    expect(r.notification).toBe('none');
  });

  it('cancels pending_trigger when the metric falls between thresholds (PRD §11.2.4)', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 1 * MINUTE,
      lastEvaluatedAt: NOW - 1 * MINUTE,
      pauseReason: null,
    };
    const r = evaluate(countRule(), dataObservation({ value: 80 }), pending);
    expect(r.ruleEval.state).toBe('normal');
    expect(r.ruleEval.since).toBeNull();
  });

  it('creates an instance only after the trigger duration is continuously met', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 2 * MINUTE - 1,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(countRule(), dataObservation({ value: 150 }), pending);
    expect(r.ruleEval.state).toBe('triggered');
    expect(r.instanceAction).toEqual({ action: 'create', state: 'triggered', triggeredAt: NOW });
    expect(r.transition).toEqual({
      from: 'none',
      to: 'triggered',
      reason: 'trigger_threshold_sustained',
      occurredAt: NOW,
    });
    expect(r.notification).toBe('first_trigger');
    expect(r.notifyNow).toBe(true);
  });

  it('does not create an instance before the duration completes', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 1 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(countRule(), dataObservation({ value: 150 }), pending);
    expect(r.ruleEval.state).toBe('pending_trigger');
    expect(r.instanceAction.action).toBe('none');
  });

  it('suppresses the repeat-trigger notification inside the cooldown window (PRD §11.2.6)', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 3 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(
      countRule(),
      dataObservation({ value: 150 }),
      pending,
      null,
      NOW - 5 * MINUTE, // notified 5 minutes ago → within 10-minute cooldown
    );
    expect(r.ruleEval.state).toBe('triggered');
    expect(r.instanceAction.action).toBe('create');
    expect(r.notification).toBe('suppressed');
    expect(r.notifyNow).toBe(false);
  });

  it('notifies a retrigger after the cooldown window has elapsed', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 3 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(
      countRule(),
      dataObservation({ value: 150 }),
      pending,
      null,
      NOW - 30 * MINUTE, // notified 30 minutes ago → outside 10-minute cooldown
    );
    expect(r.notification).toBe('retrigger');
    expect(r.notifyNow).toBe(true);
  });
});

describe('evaluateAlertRule — recovery path', () => {
  const triggeredEval: AlertRuleEvaluation = {
    state: 'triggered',
    since: NOW - 30 * MINUTE,
    lastEvaluatedAt: NOW - 1,
    pauseReason: null,
  };
  const activeInstance: ActiveAlertInstance = {
    state: 'triggered',
    triggeredAt: NOW - 30 * MINUTE,
    recoverySince: null,
    pausedFrom: null,
  };

  it('enters pending_recovery when the metric drops below the recovery threshold', () => {
    const r = evaluate(countRule(), dataObservation({ value: 50 }), triggeredEval, activeInstance);
    expect(r.ruleEval.state).toBe('pending_recovery');
    expect(r.instanceAction).toEqual({
      action: 'update',
      state: 'pending_recovery',
      recoverySince: NOW,
      pausedFrom: null,
    });
    expect(r.transition?.reason).toBe('recovery_threshold_met');
  });

  it('recovers after the recovery duration is continuously met', () => {
    const pendingRecoveryInstance: ActiveAlertInstance = {
      state: 'pending_recovery',
      triggeredAt: NOW - 30 * MINUTE,
      recoverySince: NOW - 2 * MINUTE - 1,
      pausedFrom: null,
    };
    const pendingRecoveryEval: AlertRuleEvaluation = {
      state: 'pending_recovery',
      since: NOW - 2 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(
      countRule(),
      dataObservation({ value: 50 }),
      pendingRecoveryEval,
      pendingRecoveryInstance,
    );
    expect(r.ruleEval.state).toBe('normal');
    expect(r.instanceAction).toEqual({ action: 'recover', recoveredAt: NOW });
    expect(r.notification).toBe('recovered');
    expect(r.notifyNow).toBe(true);
  });

  it('keeps pending_recovery until the recovery duration elapses', () => {
    const pendingRecoveryInstance: ActiveAlertInstance = {
      state: 'pending_recovery',
      triggeredAt: NOW - 30 * MINUTE,
      recoverySince: NOW - 1 * MINUTE,
      pausedFrom: null,
    };
    const pendingRecoveryEval: AlertRuleEvaluation = {
      state: 'pending_recovery',
      since: NOW - 1 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(
      countRule(),
      dataObservation({ value: 50 }),
      pendingRecoveryEval,
      pendingRecoveryInstance,
    );
    expect(r.ruleEval.state).toBe('pending_recovery');
    expect(r.instanceAction.action).toBe('update');
    expect(r.notification).toBe('none');
  });

  it('keeps 持续异常 (triggered) when the value sits between thresholds (PRD §11.2.5)', () => {
    const r = evaluate(countRule(), dataObservation({ value: 80 }), triggeredEval, activeInstance);
    expect(r.ruleEval.state).toBe('triggered');
    expect(r.instanceAction).toEqual({
      action: 'update',
      state: 'triggered',
      recoverySince: null,
      pausedFrom: null,
    });
  });

  it('returns to triggered when recovery condition is no longer met', () => {
    const pendingRecoveryInstance: ActiveAlertInstance = {
      state: 'pending_recovery',
      triggeredAt: NOW - 30 * MINUTE,
      recoverySince: NOW - 1 * MINUTE,
      pausedFrom: null,
    };
    const pendingRecoveryEval: AlertRuleEvaluation = {
      state: 'pending_recovery',
      since: NOW - 1 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(
      countRule(),
      dataObservation({ value: 80 }),
      pendingRecoveryEval,
      pendingRecoveryInstance,
    );
    expect(r.ruleEval.state).toBe('triggered');
    expect(r.transition?.reason).toBe('recovery_threshold_no_longer_met');
  });
});

describe('evaluateAlertRule — missing data never recovers (PRD §11.2.10)', () => {
  const triggeredEval: AlertRuleEvaluation = {
    state: 'triggered',
    since: NOW - 30 * MINUTE,
    lastEvaluatedAt: NOW - 1,
    pauseReason: null,
  };
  const activeInstance: ActiveAlertInstance = {
    state: 'triggered',
    triggeredAt: NOW - 30 * MINUTE,
    recoverySince: null,
    pausedFrom: null,
  };

  it('pauses a triggered instance on missing data instead of recovering', () => {
    const r = evaluate(
      countRule(),
      missingObservation('no_data_in_window'),
      triggeredEval,
      activeInstance,
    );
    expect(r.ruleEval.state).toBe('evaluation_paused');
    expect(r.ruleEval.pauseReason).toBe('no_data_in_window');
    expect(r.instanceAction).toEqual({
      action: 'update',
      state: 'evaluation_paused',
      pausedFrom: 'triggered',
      pauseReason: 'no_data_in_window',
    });
    expect(r.transition?.reason).toBe('no_data_in_window');
    // Never a recovery / normal / cancelled state from missing data.
    expect(r.notification).toBe('none');
  });

  it('pauses a pending_trigger rule on missing data (wait is suspended, not cancelled)', () => {
    const pending: AlertRuleEvaluation = {
      state: 'pending_trigger',
      since: NOW - 1 * MINUTE,
      lastEvaluatedAt: NOW - 1,
      pauseReason: null,
    };
    const r = evaluate(countRule(), missingObservation('data_receiving_anomaly'), pending);
    expect(r.ruleEval.state).toBe('evaluation_paused');
    expect(r.ruleEval.since).toBeNull(); // continuity broken
  });

  it('pauses on insufficient samples and does not judge the ratio', () => {
    const rule = ratioRule();
    const r = evaluate(rule, dataObservation({ value: 40, denominator: 5, sampleCount: 5 }));
    expect(r.ruleEval.state).toBe('evaluation_paused');
    expect(r.ruleEval.pauseReason).toBe('insufficient_samples');
    expect(r.evidence.completeness).toBe('missing');
  });

  it('resumes a paused triggered instance as triggered on fresh data (continuity reset)', () => {
    const pausedEval: AlertRuleEvaluation = {
      state: 'evaluation_paused',
      since: null,
      lastEvaluatedAt: NOW - 1,
      pauseReason: 'no_data_in_window',
    };
    const pausedInstance: ActiveAlertInstance = {
      state: 'evaluation_paused',
      triggeredAt: NOW - 30 * MINUTE,
      recoverySince: null,
      pausedFrom: 'triggered',
    };
    const r = evaluate(countRule(), dataObservation({ value: 150 }), pausedEval, pausedInstance);
    expect(r.ruleEval.state).toBe('triggered');
    expect(r.instanceAction).toEqual({
      action: 'update',
      state: 'triggered',
      recoverySince: null,
      pausedFrom: null,
    });
    expect(r.transition?.reason).toBe('data_resumed');
  });

  it('resets trigger continuity after a pause (fresh pending_trigger, not a sustained one)', () => {
    const pausedEval: AlertRuleEvaluation = {
      state: 'evaluation_paused',
      since: null,
      lastEvaluatedAt: NOW - 1,
      pauseReason: 'no_data_in_window',
    };
    const r = evaluate(countRule(), dataObservation({ value: 150 }), pausedEval, null);
    expect(r.ruleEval.state).toBe('pending_trigger');
    expect(r.ruleEval.since).toBe(NOW);
  });

  it('reports pause reasons distinctly from recovery states', () => {
    const r = evaluate(
      countRule(),
      missingObservation('project_archived'),
      { state: 'triggered', since: NOW - 30 * MINUTE, lastEvaluatedAt: NOW - 1, pauseReason: null },
      activeInstance,
    );
    expect(r.ruleEval.pauseReason).toBe('project_archived');
    expect(r.evidence.pauseReason).toBe('project_archived');
  });
});

describe('evaluateAlertRule — evidence integrity', () => {
  it('builds complete evidence with ratio numerator/denominator for proportion metrics', () => {
    const rule = ratioRule();
    const r = evaluate(
      rule,
      dataObservation({ value: 25, numerator: 25, denominator: 100, sampleCount: 100 }),
    );
    expect(r.evidence.observedValue).toBe(25);
    expect(r.evidence.numerator).toBe(25);
    expect(r.evidence.denominator).toBe(100);
    expect(r.evidence.minSampleRequirement).toBe(50);
    expect(r.evidence.completeness).toBe('complete');
    expect(r.evidence.windowStart).toBe(NOW - 5 * MINUTE);
    expect(r.evidence.windowEnd).toBe(NOW);
  });

  it('uses the injected clock and never touches the wall clock', () => {
    const r = evaluate(
      countRule(),
      dataObservation({ value: 10 }),
      undefined,
      null,
      null,
      NOW + 1234,
    );
    expect(r.evidence.evaluatedAt).toBe(NOW + 1234);
    expect(r.ruleEval.lastEvaluatedAt).toBe(NOW + 1234);
  });
});
