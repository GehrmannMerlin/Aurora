import { describe, expect, it } from 'vitest';
import { assertScenarioCorrect, allChecksPass } from '../src/correctness.js';

const baseInput = {
  expectedEvents: 10,
  expectedInboxRows: 10,
  expectedProcessed: 10,
  actualEvents: 10,
  accepted: 10,
  duplicate: 0,
  rejected: 0,
  allResponsesHaveRequestId: true,
  unexpected4xx5xx: [],
  inboxRows: 10,
  processed: 10,
  deadLettered: 0,
  residualLeased: 0,
  residualRetryWaiting: 0,
  leaseLost: 0,
  workerInFlight: 0,
  allowLeaseLost: false,
  allowDeadLettered: false,
  poolsClosed: true,
  schemaRemoved: true,
};

describe('correctness', () => {
  it('passes when every gate is satisfied', () => {
    const checks = assertScenarioCorrect(baseInput);
    expect(allChecksPass(checks)).toBe(true);
  });

  it('detects event-count mismatch', () => {
    const checks = assertScenarioCorrect({ ...baseInput, actualEvents: 9 });
    expect(checks.eventsMatchExpected).toBe(false);
    expect(allChecksPass(checks)).toBe(false);
  });

  it('detects non-conservation of accepted+duplicate+rejected', () => {
    const checks = assertScenarioCorrect({ ...baseInput, accepted: 8, rejected: 1 });
    expect(checks.acceptedPlusDuplicatePlusRejectedConserved).toBe(false);
  });

  it('detects residual leased or retry_waiting rows', () => {
    const leased = assertScenarioCorrect({ ...baseInput, residualLeased: 1 });
    expect(leased.noResidualLeased).toBe(false);
    const retry = assertScenarioCorrect({ ...baseInput, residualRetryWaiting: 1 });
    expect(retry.noResidualRetryWaiting).toBe(false);
  });

  it('reports lease lost as a failure unless explicitly allowed', () => {
    const failed = assertScenarioCorrect({ ...baseInput, leaseLost: 1 });
    expect(failed.noLeaseLost).toBe(false);
    const allowed = assertScenarioCorrect({ ...baseInput, leaseLost: 1, allowLeaseLost: true });
    expect(allowed.noLeaseLost).toBe(true);
  });

  it('reports unexpected dead letters unless explicitly allowed', () => {
    const failed = assertScenarioCorrect({ ...baseInput, deadLettered: 1 });
    expect(failed.noUnexpectedDeadLettered).toBe(false);
    const allowed = assertScenarioCorrect({
      ...baseInput,
      deadLettered: 1,
      allowDeadLettered: true,
    });
    expect(allowed.noUnexpectedDeadLettered).toBe(true);
  });

  it('fails when pools or schema are not cleaned up', () => {
    const noPools = assertScenarioCorrect({ ...baseInput, poolsClosed: false });
    expect(noPools.poolsClosed).toBe(false);
    const noSchema = assertScenarioCorrect({ ...baseInput, schemaRemoved: false });
    expect(noSchema.schemaRemoved).toBe(false);
  });
});
