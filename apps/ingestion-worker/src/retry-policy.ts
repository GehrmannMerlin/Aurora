export interface DecideRetryDispositionInput {
  readonly attemptCount: number;
  readonly maxProcessingAttempts: number;
  readonly availableAt: Date;
  readonly errorCode: string;
}

export type RetryDisposition =
  | {
      readonly status: 'schedule-retry';
      readonly availableAt: Date;
      readonly errorCode: string;
    }
  | {
      readonly status: 'dead-letter';
      readonly errorCode: 'retry_budget_exhausted';
    }
  | {
      readonly status: 'invalid';
      readonly diagnosticCode: 'processor_retry_result_invalid';
    };

function isValidInput(input: DecideRetryDispositionInput): boolean {
  if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount <= 0) return false;
  if (!Number.isSafeInteger(input.maxProcessingAttempts) || input.maxProcessingAttempts <= 0) {
    return false;
  }
  if (!(input.availableAt instanceof Date) || Number.isNaN(input.availableAt.getTime())) {
    return false;
  }
  if (typeof input.errorCode !== 'string' || input.errorCode === '') return false;
  return true;
}

/**
 * Decide whether a processor retry result should be scheduled again or
 * automatically dead-lettered once the retry budget is exhausted. Pure: no
 * database, environment, or clock access; never mutates the input; never
 * throws for normal control flow.
 */
export function decideRetryDisposition(input: DecideRetryDispositionInput): RetryDisposition {
  if (!isValidInput(input)) {
    return { status: 'invalid', diagnosticCode: 'processor_retry_result_invalid' };
  }
  if (input.attemptCount < input.maxProcessingAttempts) {
    return {
      status: 'schedule-retry',
      availableAt: input.availableAt,
      errorCode: input.errorCode,
    };
  }
  return { status: 'dead-letter', errorCode: 'retry_budget_exhausted' };
}
