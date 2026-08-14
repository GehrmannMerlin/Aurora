import { describe, expect, it } from 'vitest';
import { commandResult } from '../../src/common/command.js';
import { pageResult } from '../../src/common/pagination.js';
import { auroraProblem } from '../../src/common/problem-details.js';
import { ROUTE_TARGET_IDS, routeTargetId } from '../../src/common/navigation.js';
import { sectionResult, sectionStatus } from '../../src/common/section.js';
import { str } from '../../src/common/schema.js';

describe('common contracts', () => {
  it('builds a cursor page result', () => {
    const r = pageResult(str(1, 10));
    expect(
      r.zod.safeParse({ items: ['a'], pagination: { totalCountStatus: 'unavailable' } }).success,
    ).toBe(true);
    expect(r.zod.safeParse({ items: ['a'], pagination: {} }).success).toBe(false);
  });

  it('builds a command result with idempotent status', () => {
    const r = commandResult(str(1, 10));
    expect(
      r.zod.safeParse({
        status: 'succeeded',
        data: 'x',
        resourceVersion: 'v1',
        operationId: 'op_1',
        navigationTargets: [],
      }).success,
    ).toBe(true);
    expect(
      r.zod.safeParse({
        status: 'invalid',
        data: 'x',
        resourceVersion: 'v1',
        operationId: 'op_1',
        navigationTargets: [],
      }).success,
    ).toBe(false);
  });

  it('builds an AuroraProblem with stable code', () => {
    expect(
      auroraProblem.zod.safeParse({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'x',
        code: 'not_found',
        requestId: 'r_1',
      }).success,
    ).toBe(true);
    expect(
      auroraProblem.zod.safeParse({
        type: 'about:blank',
        title: 'Bad',
        status: 404,
        detail: 'x',
        code: 'bad',
        requestId: 'r_1',
      }).success,
    ).toBe(true);
  });

  it('permits relative and absolute resend timing without accepting unknown fields', () => {
    const problem = {
      type: 'about:blank',
      title: 'Too many requests',
      status: 429,
      detail: 'Retry later.',
      code: 'rate_limited',
      requestId: 'r_1',
      retryAfter: 60,
      resendAvailableAt: '2026-08-14T01:01:00.000Z',
    };

    expect(auroraProblem.zod.safeParse(problem).success).toBe(true);
    expect(auroraProblem.zod.safeParse({ ...problem, retryAt: problem.resendAvailableAt }).success).toBe(
      false,
    );
  });

  it('freezes all 38 route target ids as a closed enum', () => {
    expect(ROUTE_TARGET_IDS).toHaveLength(38);
    expect(ROUTE_TARGET_IDS).toContain('auth.register');
    expect(ROUTE_TARGET_IDS).toContain('account.deletion-cancel');
    expect(ROUTE_TARGET_IDS).toContain('account.deletion-confirm');
    expect(ROUTE_TARGET_IDS).toContain('platform.resource-policies');
    expect(routeTargetId.zod.safeParse('auth.register').success).toBe(true);
    expect(routeTargetId.zod.safeParse('made.up.route').success).toBe(false);
  });

  it('models section status as the approved closed set', () => {
    expect(sectionStatus.zod.safeParse('unavailable').success).toBe(true);
    expect(sectionStatus.zod.safeParse('loading').success).toBe(false);
  });

  it('builds a section result union with a forbidden branch', () => {
    const sr = sectionResult(str(1, 5));
    expect(
      sr.zod.safeParse({ status: 'unavailable', reason: 'capability-not-provided' }).success,
    ).toBe(true);
    expect(sr.zod.safeParse({ status: 'available', data: 'x' }).success).toBe(true);
    expect(sr.zod.safeParse({ status: 'forbidden' }).success).toBe(true);
    expect(sr.zod.safeParse({ status: 'forbidden', data: 'secret' }).success).toBe(false);
  });
});
