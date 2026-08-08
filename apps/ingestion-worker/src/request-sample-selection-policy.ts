import { REQUEST_EVENT_LIMITS, RequestOutcome } from '@aurora/event-schema';

/**
 * Minimal internal facts a future Request Processor already parsed and
 * classified before calling the sample selection policy. Never carries request
 * bodies, response bodies, headers, cookies, credentials, URLs, query
 * parameters, page text, user information, the full request event JSON, or any
 * database row / table.
 */
export interface RequestSampleSelectionInput {
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly isSlow: boolean;
  readonly isAdditionalMonitoredStatus: boolean;
}

/**
 * Discriminable sample selection result. `store` means the request qualifies as
 * a bounded safe diagnostic sample; `skip` means it does not. `invalid` is a
 * stable control-flow result for a malformed input; the function never throws
 * for normal control flow.
 */
export type RequestSampleSelectionDecision =
  | {
      readonly decision: 'store';
      readonly reason:
        | 'network_failure'
        | 'timeout'
        | 'http_429'
        | 'http_5xx'
        | 'configured_status'
        | 'slow_request';
    }
  | {
      readonly decision: 'skip';
      readonly reason: 'cancelled' | 'successful_not_slow' | 'unmonitored_status';
    }
  | {
      readonly decision: 'invalid';
      readonly diagnosticCode: 'invalid_request_sample_selection_input';
    };

function isValidOutcome(value: unknown): value is RequestOutcome {
  return (
    value === RequestOutcome.Success ||
    value === RequestOutcome.HttpError ||
    value === RequestOutcome.NetworkError ||
    value === RequestOutcome.Timeout ||
    value === RequestOutcome.Canceled
  );
}

function isValidStatusCode(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= REQUEST_EVENT_LIMITS.minStatusCode &&
    value <= REQUEST_EVENT_LIMITS.maxStatusCode
  );
}

function isValidInput(input: RequestSampleSelectionInput): boolean {
  if (!isValidOutcome(input.outcome)) return false;
  if (input.statusCode !== undefined && !isValidStatusCode(input.statusCode)) return false;
  if (typeof input.isSlow !== 'boolean') return false;
  if (typeof input.isAdditionalMonitoredStatus !== 'boolean') return false;
  return true;
}

/**
 * Deterministic sample eligibility decision for one already-parsed request
 * event. Fixed precedence: cancelled → network failure → timeout → HTTP 429 →
 * HTTP 500–599 → configured status → slow request → skip. Purely categorical:
 * no randomness, no probability re-sampling, no configuration reads, no
 * threshold calculation, no database, clock, environment, network, or logging
 * access, and no input mutation.
 */
export function decideRequestSampleSelection(
  input: RequestSampleSelectionInput,
): RequestSampleSelectionDecision {
  if (!isValidInput(input)) {
    return Object.freeze({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  }

  if (input.outcome === RequestOutcome.Canceled) {
    return Object.freeze({ decision: 'skip', reason: 'cancelled' });
  }
  if (input.outcome === RequestOutcome.NetworkError) {
    return Object.freeze({ decision: 'store', reason: 'network_failure' });
  }
  if (input.outcome === RequestOutcome.Timeout) {
    return Object.freeze({ decision: 'store', reason: 'timeout' });
  }
  if (input.outcome === RequestOutcome.HttpError) {
    if (input.statusCode === 429) {
      return Object.freeze({ decision: 'store', reason: 'http_429' });
    }
    if (input.statusCode !== undefined && input.statusCode >= 500) {
      return Object.freeze({ decision: 'store', reason: 'http_5xx' });
    }
    if (input.isAdditionalMonitoredStatus) {
      return Object.freeze({ decision: 'store', reason: 'configured_status' });
    }
    if (input.isSlow) {
      return Object.freeze({ decision: 'store', reason: 'slow_request' });
    }
    return Object.freeze({ decision: 'skip', reason: 'unmonitored_status' });
  }

  // outcome === success
  if (input.isSlow) {
    return Object.freeze({ decision: 'store', reason: 'slow_request' });
  }
  return Object.freeze({ decision: 'skip', reason: 'successful_not_slow' });
}
