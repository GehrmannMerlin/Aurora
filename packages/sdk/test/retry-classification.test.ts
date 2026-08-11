import { describe, expect, it } from 'vitest';
import { IngestionReceiptState } from '@aurora/event-schema';
import {
  classifySdkHttpStatus,
  classifySdkReceiptState,
  classifySdkTransportReason,
} from '../src/index.js';

describe('classifySdkHttpStatus', () => {
  it.each([400, 401, 403, 413, 415])('treats HTTP %i as non-retryable', (status) => {
    expect(classifySdkHttpStatus(status).retryable).toBe(false);
  });
  it('treats HTTP 0 (transport not configured) as non-retryable', () => {
    expect(classifySdkHttpStatus(0).retryable).toBe(false);
  });
  it.each([408, 429, 500, 502, 503, 504])('treats HTTP %i as retryable', (status) => {
    expect(classifySdkHttpStatus(status).retryable).toBe(true);
  });
  it('propagates server retryAfterMs for retryable status', () => {
    expect(classifySdkHttpStatus(429, 5000)).toEqual({ retryable: true, retryAfterMs: 5000 });
  });
  it('treats unknown 2xx/3xx as non-retryable (defensive)', () => {
    expect(classifySdkHttpStatus(200).retryable).toBe(false);
    expect(classifySdkHttpStatus(302).retryable).toBe(false);
  });
});

describe('classifySdkReceiptState', () => {
  it('treats permanently_rejected as non-retryable', () => {
    expect(classifySdkReceiptState(IngestionReceiptState.PermanentlyRejected).retryable).toBe(false);
  });
  it('treats temporarily_failed as retryable and propagates retryAfterMs', () => {
    expect(classifySdkReceiptState(IngestionReceiptState.TemporarilyFailed, 2500)).toEqual({
      retryable: true,
      retryAfterMs: 2500,
    });
  });
  it.each([IngestionReceiptState.Accepted, IngestionReceiptState.DuplicateAccepted])(
    'treats %s as terminal success (no retry needed)',
    (state) => {
      expect(classifySdkReceiptState(state).retryable).toBe(false);
    },
  );
});

describe('classifySdkTransportReason', () => {
  it('treats network and timeout as retryable', () => {
    expect(classifySdkTransportReason('network').retryable).toBe(true);
    expect(classifySdkTransportReason('timeout').retryable).toBe(true);
  });
  it('propagates retryAfterMs for transport failure', () => {
    expect(classifySdkTransportReason('network', 1000)).toEqual({ retryable: true, retryAfterMs: 1000 });
  });
});
