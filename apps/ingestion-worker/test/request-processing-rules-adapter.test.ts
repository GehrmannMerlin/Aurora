import { describe, expect, it } from 'vitest';
import {
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
  RequestProcessingRulesAdapterError,
  type CreateRequestProcessingRulesAdapterInput,
  type RequestProcessingRules,
} from '../src/request-processing-rules-adapter.js';
import type { RequestEventClassificationInput } from '../src/request-event-processor.js';

describe('request processing rules adapter', () => {
  it('exports a frozen default rules snapshot with PRD 5.1.3 default threshold', () => {
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowRequestThresholdMs).toBe(3000);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(429)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(500)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(599)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.additionalMonitoredStatusCodes.size).toBe(0);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowStatusCodes.size).toBe(0);
  });

  it('exposes a stable invalid_rules error kind', () => {
    const error = new RequestProcessingRulesAdapterError('invalid_rules', 'bad rules');
    expect(error.kind).toBe('invalid_rules');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RequestProcessingRulesAdapterError');
  });
});

function input(overrides?: Partial<RequestEventClassificationInput>): RequestEventClassificationInput {
  return { outcome: 'success', durationMs: 120, method: 'GET', ...overrides };
}

describe('createRequestProcessingRulesAdapter classify', () => {
  it('marks network failures and timeouts as failures under default rules', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'network_error' }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'timeout' }))).toMatchObject({ isFailure: true });
  });

  it('marks http_error 429 and 500–599 as failures, ordinary 4xx as non-failure', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 429 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 503 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isFailure: false });
  });

  it('never marks success or canceled as failures', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input())).toMatchObject({ isFailure: false });
    expect(await adapter.classify(input({ outcome: 'canceled' }))).toMatchObject({ isFailure: false });
  });

  it('classifies slow by default 3000ms threshold, excluding canceled', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ durationMs: 3000 }))).toMatchObject({ isSlow: true });
    expect(await adapter.classify(input({ durationMs: 2999 }))).toMatchObject({ isSlow: false });
    expect(await adapter.classify(input({ outcome: 'canceled', durationMs: 5000 }))).toMatchObject({ isSlow: false });
  });

  it('computes isAdditionalMonitoredStatus only for http_error on configured codes', async () => {
    const rules: RequestProcessingRules = {
      ...DEFAULT_REQUEST_PROCESSING_RULES,
      additionalMonitoredStatusCodes: new Set([404]),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isAdditionalMonitoredStatus: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 405 }))).toMatchObject({ isAdditionalMonitoredStatus: false });
    expect(await adapter.classify(input({ outcome: 'success' }))).toMatchObject({ isAdditionalMonitoredStatus: false });
  });

  it('applies project overrides for slow threshold, failure codes and slow codes', async () => {
    const rules: RequestProcessingRules = {
      slowRequestThresholdMs: 1000,
      failureStatusCodes: new Set([404]),
      slowStatusCodes: new Set([202]),
      additionalMonitoredStatusCodes: new Set<number>(),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules });
    expect(await adapter.classify(input({ durationMs: 1000 }))).toMatchObject({ isSlow: true });
    expect(await adapter.classify(input({ durationMs: 999 }))).toMatchObject({ isSlow: false });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 202 }))).toMatchObject({ isSlow: true });
  });

  it('allows failure and slow to be true simultaneously for a slow 5xx', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 503, durationMs: 3200 }))).toEqual({
      isFailure: true,
      isSlow: true,
      isAdditionalMonitoredStatus: false,
    });
  });

  it('is deterministic and never mutates its input', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    const original: RequestEventClassificationInput = { outcome: 'http_error', statusCode: 503, durationMs: 2500, method: 'POST' };
    const first = await adapter.classify(original);
    const second = await adapter.classify(original);
    expect(first).toEqual(second);
    expect(original).toEqual({ outcome: 'http_error', statusCode: 503, durationMs: 2500, method: 'POST' });
    for (let i = 0; i < 100; i += 1) {
      expect(await adapter.classify(original)).toEqual(first);
    }
  });
});

describe('request processing rules adapter invalid rules and freezing', () => {
  it('throws invalid_rules when rules are missing or undefined', () => {
    expect(() =>
      createRequestProcessingRulesAdapter({ rules: undefined as unknown as RequestProcessingRules }),
    ).toThrow(RequestProcessingRulesAdapterError);
    expect(() =>
      createRequestProcessingRulesAdapter(undefined as unknown as CreateRequestProcessingRulesAdapterInput),
    ).toThrow(RequestProcessingRulesAdapterError);
  });

  it('throws invalid_rules for non-positive, non-finite or non-integer thresholds', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createRequestProcessingRulesAdapter({
          rules: { ...DEFAULT_REQUEST_PROCESSING_RULES, slowRequestThresholdMs: bad },
        }),
      ).toThrow(RequestProcessingRulesAdapterError);
    }
  });

  it('throws invalid_rules for out-of-range or non-integer status codes', () => {
    for (const badSet of [new Set([99]), new Set([600]), new Set([429.5])]) {
      expect(() =>
        createRequestProcessingRulesAdapter({
          rules: { ...DEFAULT_REQUEST_PROCESSING_RULES, failureStatusCodes: badSet },
        }),
      ).toThrow(RequestProcessingRulesAdapterError);
    }
  });

  it('freezes the snapshot so later mutations of the caller object do not change classification', async () => {
    const source = {
      slowRequestThresholdMs: 1000,
      failureStatusCodes: new Set([404]),
      slowStatusCodes: new Set<number>(),
      additionalMonitoredStatusCodes: new Set<number>(),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules: source });
    expect(await adapter.classify({ outcome: 'http_error', statusCode: 404, durationMs: 500, method: 'GET' })).toMatchObject({ isFailure: true });
    source.slowRequestThresholdMs = 9999;
    source.failureStatusCodes.add(500);
    expect(await adapter.classify({ outcome: 'http_error', statusCode: 404, durationMs: 500, method: 'GET' })).toMatchObject({ isFailure: true });
    expect(await adapter.classify({ outcome: 'success', durationMs: 1000, method: 'GET' })).toMatchObject({ isSlow: true });
  });
});
