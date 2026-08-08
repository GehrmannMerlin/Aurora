import { describe, expect, it } from 'vitest';
import { RequestOutcome } from '@aurora/event-schema';
import {
  decideRequestSampleSelection,
  type RequestSampleSelectionDecision,
  type RequestSampleSelectionInput,
} from '../src/request-sample-selection-policy.js';

function select(
  outcome: RequestOutcome,
  overrides: Partial<
    Pick<RequestSampleSelectionInput, 'statusCode' | 'isSlow' | 'isAdditionalMonitoredStatus'>
  > = {},
): RequestSampleSelectionDecision {
  return decideRequestSampleSelection({
    outcome,
    isSlow: false,
    isAdditionalMonitoredStatus: false,
    ...overrides,
  });
}

function expectDecision(
  input: RequestSampleSelectionInput,
  expected: RequestSampleSelectionDecision,
): void {
  expect(decideRequestSampleSelection(input)).toEqual(expected);
}

describe('decideRequestSampleSelection decision matrix', () => {
  it('cancelled, not slow -> skip/cancelled', () => {
    expectDecision(
      { outcome: RequestOutcome.Canceled, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'cancelled' },
    );
  });

  it('cancelled, slow -> skip/cancelled (cancel beats slow)', () => {
    expectDecision(
      { outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'cancelled' },
    );
  });

  it('cancelled, configured -> skip/cancelled (cancel beats configured)', () => {
    expectDecision(
      { outcome: RequestOutcome.Canceled, isSlow: false, isAdditionalMonitoredStatus: true },
      { decision: 'skip', reason: 'cancelled' },
    );
  });

  it('cancelled, slow + configured -> skip/cancelled (cancel is highest priority)', () => {
    expectDecision(
      { outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: true },
      { decision: 'skip', reason: 'cancelled' },
    );
  });

  it('network_error -> store/network_failure', () => {
    expectDecision(
      { outcome: RequestOutcome.NetworkError, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'network_failure' },
    );
  });

  it('network_error, slow -> store/network_failure', () => {
    expectDecision(
      { outcome: RequestOutcome.NetworkError, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'network_failure' },
    );
  });

  it('timeout -> store/timeout', () => {
    expectDecision(
      { outcome: RequestOutcome.Timeout, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'timeout' },
    );
  });

  it('http_error 429 -> store/http_429', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 429,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'http_429' },
    );
  });

  it('http_error 429 slow -> store/http_429 (429 beats slow)', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 429,
        isSlow: true,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'http_429' },
    );
  });

  it('http_error 500 -> store/http_5xx', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 500,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'http_5xx' },
    );
  });

  it('http_error 599 -> store/http_5xx', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 599,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'http_5xx' },
    );
  });

  it('http_error 503 slow -> store/http_5xx (5xx beats slow)', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 503,
        isSlow: true,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'http_5xx' },
    );
  });

  it('http_error 404 configured -> store/configured_status', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 404,
        isSlow: false,
        isAdditionalMonitoredStatus: true,
      },
      { decision: 'store', reason: 'configured_status' },
    );
  });

  it('http_error 404 configured slow -> store/configured_status (configured beats slow)', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 404,
        isSlow: true,
        isAdditionalMonitoredStatus: true,
      },
      { decision: 'store', reason: 'configured_status' },
    );
  });

  it('http_error 404 unmonitored slow -> store/slow_request', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 404,
        isSlow: true,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'store', reason: 'slow_request' },
    );
  });

  it('success slow -> store/slow_request', () => {
    expectDecision(
      { outcome: RequestOutcome.Success, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'slow_request' },
    );
  });

  it('success 200 not slow -> skip/successful_not_slow', () => {
    expectDecision(
      {
        outcome: RequestOutcome.Success,
        statusCode: 200,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'skip', reason: 'successful_not_slow' },
    );
  });

  it('http_error 499 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 499,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'skip', reason: 'unmonitored_status' },
    );
  });

  it('http_error 400 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 400,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'skip', reason: 'unmonitored_status' },
    );
  });

  it('http_error 500 configured slow -> store/http_5xx (5xx beats configured and slow)', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 500,
        isSlow: true,
        isAdditionalMonitoredStatus: true,
      },
      { decision: 'store', reason: 'http_5xx' },
    );
  });

  it('http_error 429 configured -> store/http_429 (429 beats configured)', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 429,
        isSlow: false,
        isAdditionalMonitoredStatus: true,
      },
      { decision: 'store', reason: 'http_429' },
    );
  });

  it('http_error 200 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision(
      {
        outcome: RequestOutcome.HttpError,
        statusCode: 200,
        isSlow: false,
        isAdditionalMonitoredStatus: false,
      },
      { decision: 'skip', reason: 'unmonitored_status' },
    );
  });
});

describe('decideRequestSampleSelection determinism and purity', () => {
  const cases: readonly RequestSampleSelectionInput[] = [
    { outcome: RequestOutcome.Success, isSlow: true, isAdditionalMonitoredStatus: false },
    {
      outcome: RequestOutcome.HttpError,
      statusCode: 429,
      isSlow: false,
      isAdditionalMonitoredStatus: false,
    },
    {
      outcome: RequestOutcome.HttpError,
      statusCode: 404,
      isSlow: false,
      isAdditionalMonitoredStatus: true,
    },
    { outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: true },
    { outcome: RequestOutcome.NetworkError, isSlow: true, isAdditionalMonitoredStatus: false },
    { outcome: RequestOutcome.Timeout, isSlow: false, isAdditionalMonitoredStatus: false },
    {
      outcome: RequestOutcome.HttpError,
      statusCode: 599,
      isSlow: true,
      isAdditionalMonitoredStatus: true,
    },
  ];

  it('returns the identical result across 100 calls', () => {
    for (const input of cases) {
      const first = decideRequestSampleSelection(input);
      for (let i = 0; i < 100; i += 1) {
        expect(decideRequestSampleSelection(input)).toEqual(first);
      }
    }
  });

  it('does not modify its input', () => {
    for (const input of cases) {
      const snapshot = JSON.parse(JSON.stringify(input)) as RequestSampleSelectionInput;
      decideRequestSampleSelection(input);
      expect(input).toEqual(snapshot);
    }
  });

  it('freezes the returned decision', () => {
    const frozenCase: RequestSampleSelectionInput = {
      outcome: RequestOutcome.Success,
      isSlow: true,
      isAdditionalMonitoredStatus: false,
    };
    const result = decideRequestSampleSelection(frozenCase);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('decideRequestSampleSelection invalid input', () => {
  it('returns invalid for an unknown outcome', () => {
    const input = {
      outcome: 'bogus' as RequestOutcome,
      isSlow: false,
      isAdditionalMonitoredStatus: false,
    };
    expect(decideRequestSampleSelection(input)).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for statusCode below 100', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 99 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for statusCode above 599', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 600 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for a non-integer statusCode', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 200.5 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for a non-boolean isSlow', () => {
    expect(
      decideRequestSampleSelection({
        outcome: RequestOutcome.Success,
        isSlow: 1 as unknown as boolean,
        isAdditionalMonitoredStatus: false,
      }),
    ).toEqual({ decision: 'invalid', diagnosticCode: 'invalid_request_sample_selection_input' });
  });

  it('returns invalid for a non-boolean isAdditionalMonitoredStatus', () => {
    expect(
      decideRequestSampleSelection({
        outcome: RequestOutcome.Success,
        isSlow: false,
        isAdditionalMonitoredStatus: 'yes' as unknown as boolean,
      }),
    ).toEqual({ decision: 'invalid', diagnosticCode: 'invalid_request_sample_selection_input' });
  });

  it('covers every real RequestOutcome value with a valid decision', () => {
    for (const outcome of [
      RequestOutcome.Success,
      RequestOutcome.HttpError,
      RequestOutcome.NetworkError,
      RequestOutcome.Timeout,
      RequestOutcome.Canceled,
    ]) {
      const result = select(outcome);
      expect(result.decision === 'store' || result.decision === 'skip').toBe(true);
    }
  });
});
