import { IngestionErrorCode, IngestionReceiptState } from '../src/index.js';
import { parseIngestionEventReceipt, parseIngestionRequestReceipt } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('parseIngestionEventReceipt', () => {
  it('parses an accepted event receipt', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-batch-valid-001',
      state: IngestionReceiptState.Accepted,
      retryable: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventId).toBe('evt-batch-valid-001');
    expect(result.data.state).toBe('accepted');
    expect(result.data.retryable).toBe(false);
  });
  it('parses a permanently rejected receipt with errorCode', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-batch-invalid-001',
      state: IngestionReceiptState.PermanentlyRejected,
      errorCode: IngestionErrorCode.InvalidSchema,
      retryable: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.errorCode).toBe('invalid_schema');
  });
  it('rejects an unknown state', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-x',
      state: 'unknown_state',
      retryable: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'invalid_enum')).toBe(true);
  });
});

describe('parseIngestionRequestReceipt', () => {
  it('parses a request receipt with per-event results', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.Accepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.perEventResults).toHaveLength(1);
    expect(result.data.batchState).toBe('accepted');
  });
  it('accepts an empty perEventResults when batch-level covers all events', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.PermanentlyRejected,
      retryable: false,
      perEventResults: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.perEventResults).toHaveLength(0);
  });
  it('rejects an invalid retryAfterMs value', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.TemporarilyFailed,
      retryable: true,
      retryAfterMs: -1,
      perEventResults: [],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'invalid_number')).toBe(true);
  });
});
