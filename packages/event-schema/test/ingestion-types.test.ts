import { BATCH_EVENT_LIMITS, IngestionErrorCode, IngestionReceiptState } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('ingestion types', () => {
  it('freezes exactly the approved batch limits', () => {
    expect(BATCH_EVENT_LIMITS).toEqual({
      maxEventsPerBatch: 50,
      maxEventIdLength: 128,
      maxErrorCodeLength: 64,
      maxRetryAfterMs: 86400000,
    });
  });
  it('exposes exactly the four receipt states', () => {
    expect(IngestionReceiptState).toEqual({
      Accepted: 'accepted',
      DuplicateAccepted: 'duplicate_accepted',
      PermanentlyRejected: 'permanently_rejected',
      TemporarilyFailed: 'temporarily_failed',
    });
  });
  it('exposes the approved error codes', () => {
    expect(IngestionErrorCode.UnsupportedProtocolVersion).toBe('unsupported_protocol_version');
    expect(IngestionErrorCode.InvalidSchema).toBe('invalid_schema');
    expect(IngestionErrorCode.FieldExceedsLimit).toBe('field_exceeds_limit');
    expect(IngestionErrorCode.ForbiddenField).toBe('forbidden_field');
    expect(IngestionErrorCode.InvalidEventType).toBe('invalid_event_type');
    expect(IngestionErrorCode.ProjectPermanentlyNotAllowed).toBe('project_permanently_not_allowed');
    expect(IngestionErrorCode.SourcePermanentlyNotAllowed).toBe('source_permanently_not_allowed');
    expect(IngestionErrorCode.ServiceTemporarilyUnavailable).toBe(
      'service_temporarily_unavailable',
    );
    expect(IngestionErrorCode.RateLimited).toBe('rate_limited');
    expect(IngestionErrorCode.CapacityProtected).toBe('capacity_protected');
  });
});
