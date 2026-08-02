import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@aurora/event-schema';
import { leaseLostResult, notFoundResult, successResult } from '../src/processing-errors.js';
import type {
  ClaimAvailableInboxEventsInput,
  ClaimAvailableInboxEventsResult,
  ClaimedInboxEvent,
  IngestionInboxProcessingRepository,
  InboxLeaseMutationResult,
  MarkInboxEventDeadLetteredInput,
  MarkInboxEventProcessedInput,
  RenewInboxLeaseInput,
  ScheduleInboxEventRetryInput,
} from '../src/processing-types.js';

const envelope: EventEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-proc-001',
  eventType: 'error',
  occurredAt: 1_800_000_000_000,
  body: {},
};

describe('ingestion-inbox processing types', () => {
  it('exposes claim input with caller-provided bounds', () => {
    const input: ClaimAvailableInboxEventsInput = {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-1',
    };
    expect(input.limit).toBe(10);
  });

  it('exposes a claimed event with the required processing fields', () => {
    const claimed: ClaimedInboxEvent = {
      id: 1,
      projectId: 'project-1',
      eventId: 'evt-proc-001',
      event: envelope,
      attemptCount: 1,
      leaseId: 'uuid-lease-1',
      leaseExpiresAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(claimed.leaseId).toBe('uuid-lease-1');
    expect(claimed.event).toEqual(envelope);
  });

  it('discriminates claim results and lease mutation results', () => {
    const claimed: ClaimAvailableInboxEventsResult = { status: 'claimed', events: [] };
    expect(claimed.status).toBe('claimed');
    const empty: ClaimAvailableInboxEventsResult = { status: 'nothingToClaim' };
    expect(empty.status).toBe('nothingToClaim');
    const lost: InboxLeaseMutationResult = { status: 'lease_lost' };
    expect(lost.status).toBe('lease_lost');
  });

  it('exposes the write-back input shapes', () => {
    const renew: RenewInboxLeaseInput = { id: 1, leaseId: 'l-1', leaseDurationMs: 30_000 };
    const processed: MarkInboxEventProcessedInput = { id: 1, leaseId: 'l-1' };
    const retry: ScheduleInboxEventRetryInput = {
      id: 1,
      leaseId: 'l-1',
      availableAt: new Date('2026-08-01T01:00:00Z'),
      errorCode: 'rate_limited',
    };
    const dead: MarkInboxEventDeadLetteredInput = {
      id: 1,
      leaseId: 'l-1',
      errorCode: 'capacity_protected',
    };
    expect(renew.leaseDurationMs).toBe(30_000);
    expect(processed.leaseId).toBe('l-1');
    expect(retry.errorCode).toBe('rate_limited');
    expect(dead.errorCode).toBe('capacity_protected');
  });

  it('defines the processing repository interface with five operations', () => {
    const repo: IngestionInboxProcessingRepository = {
      claimAvailable: () => Promise.resolve({ status: 'nothingToClaim' }),
      renewLease: () => Promise.resolve(successResult()),
      markProcessed: () => Promise.resolve(successResult()),
      scheduleRetry: () => Promise.resolve(successResult()),
      markDeadLettered: () => Promise.resolve(successResult()),
    };
    expect(typeof repo.claimAvailable).toBe('function');
    expect(typeof repo.renewLease).toBe('function');
    expect(typeof repo.markProcessed).toBe('function');
    expect(typeof repo.scheduleRetry).toBe('function');
    expect(typeof repo.markDeadLettered).toBe('function');
  });

  it('returns stable lease_lost, not_found, and success results', () => {
    expect(leaseLostResult()).toEqual({ status: 'lease_lost' });
    expect(notFoundResult()).toEqual({ status: 'not_found' });
    expect(successResult()).toEqual({ status: 'success' });
  });
});
