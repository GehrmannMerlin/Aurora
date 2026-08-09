import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_MASKED_UNKNOWN_ACTOR,
  AUDIT_RESULT_DEFAULT,
  decodeAuditCursor,
  encodeAuditCursor,
  listAuditEvents,
  maskActor,
  normalizeAuditResult,
} from '../src/index.js';

/** A pool that must never be reached: input validation happens before any query. */
const noopPool = {
  query: () => {
    throw new Error('noop pool must not be queried');
  },
} as unknown as Pool;

describe('platform-audit cursor encoding', () => {
  it('round-trips a cursor with a microsecond timestamp and event id', () => {
    const micros = 1_786_500_123_456_789;
    const eventId = '123e4567-e89b-12d3-a456-426614174000';
    const cursor = encodeAuditCursor(micros, eventId);
    expect(cursor).toMatch(/^[0-9a-z]+\.[0-9a-f]{32}$/);
    expect(cursor.length).toBeLessThanOrEqual(64);
    const decoded = decodeAuditCursor(cursor);
    expect(decoded.occurredAtMicros).toBe(micros);
    expect(decoded.eventId).toBe(eventId);
  });

  it('encodes the event id without dashes and lower-case', () => {
    const cursor = encodeAuditCursor(1_786_500_123_456_789, '123E4567-E89B-12D3-A456-426614174000');
    expect(cursor).toMatch(/^[0-9a-z]+\.[0-9a-f]{32}$/);
    expect(cursor.split('.')[1]).toBe('123e4567e89b12d3a456426614174000');
    expect(cursor.length).toBeLessThanOrEqual(64);
  });

  it('rejects a malformed cursor as invalid_input', () => {
    for (const bad of [
      'garbage',
      '1.zz',
      '1.',
      '.123e4567e89b12d3a456426614174000',
      '1x.123e4567e89b12d3a45642661417400Z',
    ]) {
      expect(() => decodeAuditCursor(bad), bad).toThrow(
        expect.objectContaining({ kind: 'invalid_input' }),
      );
    }
  });
});

describe('platform-audit actor masking', () => {
  it('masks a uuid actor to the first 8 hex chars followed by the ellipsis', () => {
    const masked = maskActor('123e4567-e89b-12d3-a456-426614174000');
    expect(masked).toBe('123e4567…');
    expect(masked.length).toBeGreaterThanOrEqual(3);
    expect(masked).not.toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(masked).not.toContain('@');
  });

  it('returns a stable non-identifying label when no actor is recorded', () => {
    const masked = maskActor(null);
    expect(masked).toBe(AUDIT_MASKED_UNKNOWN_ACTOR);
    expect(masked.length).toBeGreaterThanOrEqual(3);
    expect(masked).not.toContain('@');
  });
});

describe('platform-audit result normalization', () => {
  it('maps a null result to the stable contract default', () => {
    expect(normalizeAuditResult(null)).toBe(AUDIT_RESULT_DEFAULT);
  });

  it('passes through every known result value', () => {
    expect(normalizeAuditResult('succeeded')).toBe('succeeded');
    expect(normalizeAuditResult('failed')).toBe('failed');
    expect(normalizeAuditResult('blocked')).toBe('blocked');
  });

  it('normalizes an unexpected value defensively to the default', () => {
    expect(normalizeAuditResult('pending')).toBe(AUDIT_RESULT_DEFAULT);
  });
});

describe('platform-audit input validation', () => {
  it('rejects an empty organization id as invalid_input before touching the database', async () => {
    await expect(listAuditEvents(noopPool, { orgId: '   ' })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });

  it('rejects an out-of-range limit as invalid_input', async () => {
    await expect(listAuditEvents(noopPool, { orgId: 'org', limit: 0 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    await expect(listAuditEvents(noopPool, { orgId: 'org', limit: 101 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    await expect(listAuditEvents(noopPool, { orgId: 'org', limit: 1.5 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });

  it('rejects malformed from/to timestamps as invalid_input', async () => {
    await expect(
      listAuditEvents(noopPool, { orgId: 'org', from: 'not-a-date' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      listAuditEvents(noopPool, { orgId: 'org', to: 'not-a-date' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('rejects a from bound after the to bound as invalid_input', async () => {
    await expect(
      listAuditEvents(noopPool, {
        orgId: 'org',
        from: '2026-01-01T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('rejects a malformed cursor as invalid_input', async () => {
    await expect(
      listAuditEvents(noopPool, { orgId: 'org', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });
});
