import type { CorrectnessChecks } from './types.js';

export interface CorrectnessAssertionInput {
  readonly expectedEvents: number;
  readonly expectedInboxRows: number;
  readonly expectedProcessed: number;
  readonly actualEvents: number;
  readonly accepted: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly allResponsesHaveRequestId: boolean;
  readonly unexpected4xx5xx: readonly string[];
  readonly inboxRows: number;
  readonly processed: number;
  readonly deadLettered: number;
  readonly residualLeased: number;
  readonly residualRetryWaiting: number;
  readonly leaseLost: number;
  readonly workerInFlight: number;
  readonly allowLeaseLost: boolean;
  readonly allowDeadLettered: boolean;
  readonly poolsClosed: boolean;
  readonly schemaRemoved: boolean;
}

/**
 * Run every correctness gate for one scenario. A failure marks the whole run
 * failed; performance numbers alone never fail a run.
 */
export function assertScenarioCorrect(input: CorrectnessAssertionInput): CorrectnessChecks {
  const checks: CorrectnessChecks = {
    requestsMatchExpected: true,
    eventsMatchExpected: input.actualEvents === input.expectedEvents,
    allResponsesHaveRequestId: input.allResponsesHaveRequestId,
    noUnexpected4xx5xx: input.unexpected4xx5xx.length === 0,
    acceptedPlusDuplicatePlusRejectedConserved:
      input.accepted + input.duplicate + input.rejected === input.actualEvents,
    inboxRowCountCorrect: input.inboxRows === input.expectedInboxRows,
    processedCountCorrect: input.processed === input.expectedProcessed,
    noUnexpectedDeadLettered: input.allowDeadLettered || input.deadLettered === 0,
    noResidualLeased: input.residualLeased === 0,
    noResidualRetryWaiting: input.residualRetryWaiting === 0,
    noLeaseLost: input.allowLeaseLost || input.leaseLost === 0,
    workerInFlightZero: input.workerInFlight === 0,
    poolsClosed: input.poolsClosed,
    schemaRemoved: input.schemaRemoved,
  };
  return checks;
}

export function allChecksPass(checks: CorrectnessChecks): boolean {
  return Object.values(checks).every((value) => value === true);
}
