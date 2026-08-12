import type { Pool } from 'pg';
import { evaluateAlertRule } from './alert-evaluator.js';
import type { AlertRuleEvaluationState } from './alert-evaluator-types.js';
import { getActiveAlertInstance, persistAlertEvaluation } from './alert-instance-repository.js';
import { computeAlertObservation } from './alert-observation-query.js';
import { listAlertRulesForEvaluation } from './alert-rule-repository.js';
import { toAlertRuleConfig } from './alert-types.js';

export interface AlertEvaluationRoundInput {
  readonly pool: Pool;
  /** Injectable clock for tests; production passes the wall clock. */
  readonly now?: Date;
  /** Maximum rules evaluated per round (bounded, worker-configurable). */
  readonly maxRules?: number;
}

export interface AlertEvaluationRoundResult {
  readonly evaluatedRules: number;
  readonly createdInstances: number;
  readonly recoveredInstances: number;
  readonly pausedRules: number;
  readonly failedRules: number;
}

/**
 * Run one alert evaluation round: load the next rule batch, compute a
 * trustworthy observation per rule, run the deterministic evaluator with the
 * injected clock, and persist the rule evaluation projection plus any
 * instance/evidence/transition changes atomically. A single rule failure never
 * blocks the rest of the round (failures are counted, never leaked).
 */
export async function runAlertEvaluationRound(
  input: AlertEvaluationRoundInput,
): Promise<AlertEvaluationRoundResult> {
  const nowMs = input.now === undefined ? Date.now() : input.now.getTime();
  const rules = await listAlertRulesForEvaluation(input.pool, { limit: input.maxRules ?? 100 });

  let evaluatedRules = 0;
  let createdInstances = 0;
  let recoveredInstances = 0;
  let pausedRules = 0;
  let failedRules = 0;

  for (const rule of rules) {
    try {
      const config = toAlertRuleConfig(rule);
      const observation = await computeAlertObservation(input.pool, {
        projectId: rule.projectId,
        rule: config,
        now: nowMs,
      });
      const result = evaluateAlertRule({
        rule: config,
        observation,
        ruleEval: {
          state: rule.evaluationState as AlertRuleEvaluationState,
          since: rule.evaluationSince === null ? null : rule.evaluationSince.getTime(),
          lastEvaluatedAt: rule.lastEvaluatedAt?.getTime() ?? nowMs,
          pauseReason: rule.evaluationPauseReason,
        },
        instance: await getActiveAlertInstance(input.pool, { ruleId: rule.id }),
        lastNotifiedAt: rule.lastNotifiedAt === null ? null : rule.lastNotifiedAt.getTime(),
        now: nowMs,
      });
      await persistAlertEvaluation(input.pool, { rule, result });
      evaluatedRules += 1;
      if (result.instanceAction.action === 'create') createdInstances += 1;
      if (result.instanceAction.action === 'recover') recoveredInstances += 1;
      if (result.ruleEval.state === 'evaluation_paused') pausedRules += 1;
    } catch {
      // Never leak DB/stack details; the worker owns bounded diagnostic logging.
      failedRules += 1;
    }
  }

  return { evaluatedRules, createdInstances, recoveredInstances, pausedRules, failedRules };
}
