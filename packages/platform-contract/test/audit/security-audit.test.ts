import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIST_SECURITY_AUDIT,
  auditListSecurityAuditQuery,
  auditListSecurityAuditResponse,
} from '../../src/audit/security-audit.js';

const validResponse = {
  events: [
    {
      eventId: 'aud_123',
      action: 'member.invited',
      occurredAt: '2026-08-09T01:00:00.000Z',
      result: 'succeeded',
      actorMasked: 'ow**@example.invalid',
      targetProjectRef: { projectId: 'prj_123' },
    },
  ],
  pagination: { totalCountStatus: 'available' },
};

describe('auditListSecurityAudit contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_LIST_SECURITY_AUDIT).toBe('auditListSecurityAudit');
  });

  it('accepts a valid audit query', () => {
    expect(auditListSecurityAuditQuery.zod.safeParse({ limit: 20 }).success).toBe(true);
    expect(auditListSecurityAuditQuery.zod.safeParse({ cursor: 'c1', limit: 50 }).success).toBe(
      true,
    );
  });

  it('rejects a missing limit', () => {
    expect(auditListSecurityAuditQuery.zod.safeParse({ cursor: 'c1' }).success).toBe(false);
  });

  it('rejects an undeclared query field (closed object)', () => {
    expect(
      auditListSecurityAuditQuery.zod.safeParse({ limit: 20, from: '2026-08-01T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });

  it('accepts a valid audit response', () => {
    expect(auditListSecurityAuditResponse.zod.safeParse(validResponse).success).toBe(true);
  });

  it('rejects a response without an actor mask', () => {
    expect(
      auditListSecurityAuditResponse.zod.safeParse({
        events: [
          {
            eventId: 'aud_123',
            action: 'member.invited',
            occurredAt: '2026-08-09T01:00:00.000Z',
            result: 'succeeded',
            actor: 'owner@example.invalid',
            actorMasked: 'ow**@example.invalid',
          },
        ],
        pagination: { totalCountStatus: 'available' },
      }).success,
    ).toBe(false);
  });

  it('rejects a response leaking a full actor email', () => {
    expect(
      auditListSecurityAuditResponse.zod.safeParse({
        events: [
          {
            eventId: 'aud_123',
            action: 'member.invited',
            occurredAt: '2026-08-09T01:00:00.000Z',
            result: 'succeeded',
            actorMasked: 'ow**@example.invalid',
            actorEmail: 'owner@example.invalid',
          },
        ],
        pagination: { totalCountStatus: 'available' },
      }).success,
    ).toBe(false);
  });
});
