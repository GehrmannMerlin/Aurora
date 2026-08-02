import type { EventEnvelope } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import type { ProcessIngestionEventInput, ProcessIngestionEventResult } from '../src/processor.js';
import type { IngestionEventProcessor } from '../src/processor.js';

const validInput: ProcessIngestionEventInput = {
  inboxId: 42,
  projectId: '11111111-1111-1111-1111-111111111111',
  eventId: 'evt-1',
  event: { protocolVersion: 1 } as EventEnvelope,
  attemptCount: 1,
  leaseId: '00000000-0000-0000-0000-000000000001',
  leaseExpiresAt: new Date('2026-08-01T00:00:00Z'),
};

describe('processor port', () => {
  it('exposes the stable processing input shape only', () => {
    expect(validInput.inboxId).toBe(42);
    expect(validInput.projectId).toBe('11111111-1111-1111-1111-111111111111');
    expect(validInput.eventId).toBe('evt-1');
    expect(validInput.event).toBeDefined();
    expect(validInput.attemptCount).toBe(1);
    expect(validInput.leaseId).toBe('00000000-0000-0000-0000-000000000001');
    expect(validInput.leaseExpiresAt).toBeInstanceOf(Date);
  });

  it('distinguishes the three allowed outcomes', () => {
    const processed: ProcessIngestionEventResult = { outcome: 'processed' };
    const retry: ProcessIngestionEventResult = {
      outcome: 'retry',
      availableAt: new Date('2026-08-01T00:00:01Z'),
      errorCode: 'service_temporarily_unavailable',
    };
    const deadLetter: ProcessIngestionEventResult = {
      outcome: 'dead-letter',
      errorCode: 'invalid_schema',
    };
    expect(processed.outcome).toBe('processed');
    expect(retry.outcome).toBe('retry');
    expect(retry.errorCode).toBe('service_temporarily_unavailable');
    expect(deadLetter.outcome).toBe('dead-letter');
    expect(deadLetter.errorCode).toBe('invalid_schema');
  });

  it('requires retry and dead-letter to carry a stable error code', () => {
    const retry: ProcessIngestionEventResult = {
      outcome: 'retry',
      availableAt: new Date(),
      errorCode: 'service_temporarily_unavailable',
    };
    // Narrowing a union-typed value (not a literal) proves the discriminated shape.
    const assertRetryShape = (result: ProcessIngestionEventResult): string | Date => {
      if (result.outcome === 'retry') {
        expect(result.availableAt).toBeInstanceOf(Date);
        return result.errorCode;
      }
      throw new Error('expected retry outcome');
    };
    expect(assertRetryShape(retry)).toBe('service_temporarily_unavailable');
  });

  it('accepts a processor implementing the port contract', () => {
    const processor: IngestionEventProcessor = {
      process: (input, signal) => {
        expect(input.inboxId).toBe(42);
        expect(signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve({ outcome: 'processed' });
      },
    };
    const controller = new AbortController();
    void processor.process(validInput, controller.signal).then((result) => {
      expect(result.outcome).toBe('processed');
    });
  });
});
